import { NextRequest, NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/dist/nextjs";
import { processMeetingTranscript, generateRiskAnalysis, generateSentimentArc, generateSpeakerProfiles } from "@/lib/ai-processor";
import { addToKnowledgeGraph } from "@/lib/graph";
import { prisma } from "@/lib/db";
import { processTranscript } from "@/lib/rag";

// This function processes the heavy job
async function handler(req: NextRequest) {
    console.log("👷 Worker Started: Processing Meeting...");
    const body = await req.json();
    const { meetingId, transcript, botId } = body;

    // Log transcript info for debugging
    console.log("📝 Received transcript type:", typeof transcript, "Is null:", transcript === null, "Is undefined:", transcript === undefined);

    try {
        const meeting = await prisma.meeting.findUnique({
            where: { id: meetingId },
            // ✅ FIX 1: Change 'user' to 'createdBy'
            include: { createdBy: true }
        });

        if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

        // 1. Generate Summary & Action Items
        console.log("📋 Transcript structure:", {
            type: typeof transcript,
            isArray: Array.isArray(transcript),
            firstItem: Array.isArray(transcript) ? transcript[0] : null,
            sampleLength: JSON.stringify(transcript).length
        });
        
        const processed = await processMeetingTranscript(transcript);;

        // Update DB with Summary
        await prisma.meeting.update({
            where: { id: meetingId },
            data: {
                summary: processed.summary,
                actionItems: processed.actionItems,
                processed: true,
                processedAt: new Date(),
            }
        });

        // 4. PARALLEL: Run all advanced AI tasks
        await Promise.allSettled([
            // ✅ FIX 3: Change 'meeting.userId' to 'meeting.createdById'
            processTranscript(meetingId, meeting.createdById, JSON.stringify(transcript), meeting.title),
            
            // 😈 Risk Analysis
            generateRiskAnalysis(transcript, meetingId),
            
            // 🕸️ Graph Extraction
            addToKnowledgeGraph(transcript, meetingId, meeting.title),
            
            // 📈 Sentiment Arc
            generateSentimentArc(transcript, meetingId),
            
            // 🧠 Behavioral Profiling
            generateSpeakerProfiles(transcript, meetingId)
        ]);

        console.log(`✅ Worker Finished: Meeting ${meetingId} fully processed.`);
        return NextResponse.json({ success: true });

    } catch (error) {
        console.error("❌ Worker Failed:", error);
        return NextResponse.json({ error: "Processing failed" }, { status: 500 });
    }
}

// Security: Verify that the request actually came from QStash
export const POST = verifySignatureAppRouter(handler);