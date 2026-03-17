import { NextRequest, NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/dist/nextjs";
import { processMeetingTranscript, generateRiskAnalysis, generateSentimentArc, generateSpeakerProfiles } from "@/lib/ai-processor";
import { addToKnowledgeGraph } from "@/lib/graph";
import { prisma } from "@/lib/db";
import { processTranscript } from "@/lib/rag";
import { enrichTranscript } from "@/lib/entity-extractor";

// This function processes the heavy job
async function handler(req: NextRequest) {
    console.log("👷 Worker Started: Processing Meeting...");
    const body = await req.json();
    const { meetingId, transcript } = body;

    // Log transcript info for debugging
    console.log("📝 Received transcript type:", typeof transcript, "Is null:", transcript === null, "Is undefined:", transcript === undefined);

    try {
        const meeting = await prisma.meeting.findUnique({
            where: { id: meetingId },
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
        
        // ✅ FIX: processMeetingTranscript BEFORE enrichment
        const processed = await processMeetingTranscript(transcript);

        // ✅ FIX: enrichTranscript for graph extraction

        // ✅ FIX: Update DB with processed data
        await prisma.meeting.update({
            where: { id: meetingId },
            data: { 
                summary: processed.summary, 
                actionItems: processed.actionItems, 
                processed: true, 
                processedAt: new Date() 
            }
        });

        // ✅ FIX: Use enriched.enriched for graph extraction
        await Promise.allSettled([
            processTranscript(meetingId, meeting.createdById, JSON.stringify(transcript), meeting.title),
            generateRiskAnalysis(transcript, meetingId),
            addToKnowledgeGraph(transcript, meetingId, meeting.title),
            generateSentimentArc(transcript, meetingId),
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