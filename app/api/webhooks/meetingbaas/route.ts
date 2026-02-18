import { prisma } from "@/lib/db";
import { incrementMeetingUsage } from "@/lib/usage";
import { NextRequest, NextResponse } from "next/server";
import { Client } from "@upstash/qstash";

// Initialize Queue Client
const client = new Client({ token: process.env.QSTASH_TOKEN! });

export async function POST(request: NextRequest) {
    try {
        const bodyText = await request.text();
        const webhook = JSON.parse(bodyText);
        
        // 🔍 DEBUG: Print exactly what MeetingBaas is sending
        console.log("🔥 [WEBHOOK EVENT DETECTED]:", webhook.event);
        
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

            // Update Database
            await incrementMeetingUsage(meeting.createdById);
            
            await prisma.meeting.update({
                where: { id: meeting.id },
                data: {
                    meetingEnded: true,
                    transcriptReady: true,
                    transcript: webhookData.transcript || meeting.transcript, 
                    recordingUrl: webhookData.mp4 || meeting.recordingUrl,
                    speakers: webhookData.speakers || meeting.speakers
                }
            });

            // Dispatch to QStash Queue for AI Summary
            const appUrl = process.env.NEXT_PUBLIC_APP_URI; 
            try {
                const response = await client.publishJSON({
                    url: `${appUrl}/api/queue/process-meeting`,
                    body: {
                        meetingId: meeting.id,
                        transcript: webhookData.transcript,
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