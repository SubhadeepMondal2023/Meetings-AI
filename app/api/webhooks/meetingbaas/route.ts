import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { Client } from "@upstash/qstash";
import { normalizeTranscript, validateTranscript } from "@/lib/transcript-parser";
import { transcribeAudioFromUrl } from "@/lib/transcription";

// Initialize Queue Client
const client = new Client({ token: process.env.QSTASH_TOKEN! });

/**
 * Merge transcribed text with original speaker names and timing from MeetingBaas
 * MeetingBaas provides speaker names and timing, but Whisper transcription provides the text
 */
function mergeTranscriptWithSpeakers(
    originalSegments: any[],
    transcribedSegments: any[]
): any[] {
    if (!transcribedSegments || transcribedSegments.length === 0) return originalSegments;
    
    const merged: any[] = [];
    
    // Build a single text from all transcribed segments
    const fullText = transcribedSegments
        .map((seg: any) => seg.words?.map((w: any) => w.word).join(" ") || "")
        .join(" ")
        .trim();
    
    // If no text was transcribed, return original segments as-is
    if (!fullText) {
        console.warn("⚠️ No text content in transcribed segments, keeping original speakers");
        return originalSegments;
    }
    
    // Split the full text into chunks roughly matching original segment durations
    const words = fullText.split(/\s+/).filter((w: string) => w.length > 0);
    let wordIndex = 0;
    
    for (const originalSeg of originalSegments) {
        const speaker = originalSeg.speaker || "Unknown";
        const offset = originalSeg.offset || originalSeg.start_time || 0;
        const startTime = originalSeg.start_time || offset;
        const endTime = originalSeg.end_time || startTime + 1;
        const duration = endTime - startTime;
        
        // Estimate how many words should be in this segment based on duration ratio
        // Assume ~2 words per second on average
        const estimatedWords = Math.max(1, Math.round(duration * 2));
        
        // Collect words for this segment
        const segmentWords: any[] = [];
        const segmentTextWords = words.slice(wordIndex, wordIndex + estimatedWords);
        
        if (segmentTextWords.length > 0) {
            // Distribute the segment duration across the words
            const wordsPerSecond = Math.max(1, segmentTextWords.length);
            const timePerWord = duration / wordsPerSecond;
            let currentTime = startTime;
            
            for (const word of segmentTextWords) {
                segmentWords.push({
                    word,
                    start: currentTime,
                    end: currentTime + timePerWord,
                });
                currentTime += timePerWord;
            }
            
            wordIndex += estimatedWords;
        }
        
        merged.push({
            speaker,
            offset,
            start_time: startTime,
            end_time: endTime,
            words: segmentWords,
        });
    }
    
    console.log(`✅ Merged ${merged.length} segments with original speaker names`);
    return merged;
}

export async function POST(request: NextRequest) {
    try {
        const bodyText = await request.text();
        const webhook = JSON.parse(bodyText);
        
        // 🔍 DEBUG: Print exactly what MeetingBaas is sending
        console.log("🔥 [WEBHOOK EVENT DETECTED]:", webhook.event);
        console.log("🔥 [WEBHOOK DATA - FULL]:", JSON.stringify(webhook.data, null, 2));
        if (webhook.data?.transcript && Array.isArray(webhook.data.transcript)) {
            console.log("🔥 [TRANSCRIPT STRUCTURE - FIRST SEGMENT]:", JSON.stringify(webhook.data.transcript[0], null, 2));
        }
        
        // Extract Data safely
        const webhookData = webhook.data || {};
        const botId = webhookData.bot_id || webhook.bot_id;

        // ✅ THE FIX: Process the meeting if we have a bot_id, REGARDLESS of the event name,
        // as long as it contains transcript/video data or says it's complete.
        const isCompletionEvent = 
            webhook.event === 'complete' || 
            webhook.event === 'meeting.ended' || 
            webhook.event === 'bot.status_change' ||
            webhook.event === 'bot_data' ||
            webhookData.transcript || 
            webhookData.mp4;

        if (botId && isCompletionEvent) {
            console.log(`🔔 Processing data for Bot ID: ${botId}`);

            const meeting = await prisma.meeting.findFirst({
                where: { botId: botId },
                include: { createdBy: true }
            });

            if (!meeting) {
                console.error('❌ Meeting not found in DB for bot id:', botId);
                return NextResponse.json({ error: 'meeting not found' }, { status: 200 });
            }

                        
            // Parse and normalize transcript
            let parsedTranscript = meeting.transcript;
            
            // Check if transcript exists but is empty (words arrays are empty)
            const transcriptHasContent = webhookData.transcript && 
                Array.isArray(webhookData.transcript) &&
                webhookData.transcript.some((seg: any) => seg.words && seg.words.length > 0);
            
            // If no transcript OR transcript is empty, try to transcribe the audio
            if ((!webhookData.transcript || !transcriptHasContent) && webhookData.audio) {
                console.log(`🎙️ No transcript content. Attempting to transcribe audio from: ${webhookData.audio}`);
                const audioUrl = webhookData.audio;
                
                try {
                    const transcribedSegments = await transcribeAudioFromUrl(audioUrl);
                    if (transcribedSegments && transcribedSegments.length > 0) {
                        // If we have original segments from MeetingBaas, merge speaker info with transcribed text
                        if (webhookData.transcript && Array.isArray(webhookData.transcript)) {
                            console.log(`🔀 Merging speaker names from MeetingBaas with transcribed text...`);
                            parsedTranscript = mergeTranscriptWithSpeakers(webhookData.transcript, transcribedSegments);
                        } else {
                            parsedTranscript = transcribedSegments;
                        }
                        console.log(`✅ Audio transcribed successfully: ${transcribedSegments.length} segments`);
                    } else {
                        console.warn("⚠️ Audio transcription returned no segments");
                    }
                } catch (transcriptionError) {
                    console.error("❌ Failed to transcribe audio:", transcriptionError);
                    // Continue anyway, will process with empty transcript
                }
            } else if (webhookData.transcript && transcriptHasContent) {
                // Process provided transcript
                try {
                    // First, try to parse if it's a JSON string
                    let rawTranscript = webhookData.transcript;
                    if (typeof webhookData.transcript === 'string') {
                        rawTranscript = JSON.parse(webhookData.transcript);
                    }

                    // Normalize to expected format
                    const normalized = normalizeTranscript(rawTranscript);
                    if (normalized && validateTranscript(normalized)) {
                        parsedTranscript = normalized;
                        console.log(`✅ Transcript normalized: ${normalized.length} segments`);
                    } else {
                        console.warn("⚠️ Transcript normalization resulted in invalid format");
                        parsedTranscript = rawTranscript;
                    }
                } catch (e) {
                    console.warn("Could not parse transcript:", e);
                    parsedTranscript = webhookData.transcript;
                }
            }
            
            console.log("📝 Transcript type:", typeof parsedTranscript, "Is null:", parsedTranscript === null);
            
            await prisma.meeting.update({
                where: { id: meeting.id },
                data: {
                    meetingEnded: true,
                    transcriptReady: true,
                    transcript: parsedTranscript as any,  // ✅ Add "as any"
                    recordingUrl: webhookData.mp4 || meeting.recordingUrl,
                    speakers: webhookData.speakers as any || meeting.speakers  // ✅ Add "as any"
                }
            });

            // Dispatch to QStash Queue for AI Summary
            const appUrl = process.env.NEXT_PUBLIC_APP_URI; 
            try {
                // Fetch the updated meeting to get the transcript that was just saved
                const updatedMeeting = await prisma.meeting.findUnique({
                    where: { id: meeting.id }
                });

                // ⚠️ CRITICAL FIX: Check if transcript actually exists
                // If MeetingBaaS hasn't generated it yet, don't queue the job
                if (!updatedMeeting?.transcript) {
                    console.log(`⏳ Transcript not ready yet for meeting ${meeting.id}. Skipping queue job until transcript is available.`);
                    return NextResponse.json({ success: true, message: 'Meeting updated. Waiting for transcript generation...' });
                }

                console.log(`📝 Transcript ready (${JSON.stringify(updatedMeeting.transcript).length} bytes). Queuing AI processing...`);

                const response = await client.publishJSON({
                    url: `${appUrl}/api/queue/process-meeting`,
                    body: {
                        meetingId: meeting.id,
                        transcript: updatedMeeting.transcript,
                        botId: botId,
                        meetingTitle: meeting.title 
                    },
                    retries: 0
                });
                console.log(`📨 Job sent to Queue (Msg ID: ${response.messageId}) for Meeting: ${meeting.title}`);
            } catch (queueError) {
                console.error("❌ Failed to queue job:", queueError);
            }

            return NextResponse.json({ success: true, message: 'Processed successfully' });
        }

        // Acknowledge other random webhook pings (like bot joining, bot leaving)
        return NextResponse.json({ success: true, ignored: true });

    } catch (error) {
        console.error('Webhook error:', error);
        return NextResponse.json({ error: 'Internal Error' }, { status: 500 });
    }
}