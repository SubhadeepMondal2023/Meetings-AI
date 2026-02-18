import { NextRequest, NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/dist/nextjs";
import { processMeetingTranscript, generateRiskAnalysis, generateSentimentArc, generateSpeakerProfiles } from "@/lib/ai-processor";
import { addToKnowledgeGraph } from "@/lib/graph";
import { prisma } from "@/lib/db";
import { processTranscript } from "@/lib/rag";
import { sendMeetingSummaryEmail } from "@/lib/email-service-free";

// This function processes the heavy job
async function handler(req: NextRequest) {
    console.log("👷 Worker Started: Processing Meeting...");
    const body = await req.json();
    const { meetingId, transcript, botId } = body;

    try {
        const meeting = await prisma.meeting.findUnique({
            where: { id: meetingId },
            // ✅ FIX 1: Change 'user' to 'createdBy'
            include: { createdBy: true }
        });

        if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

        // 1. Generate Summary & Action Items
        const processed = await processMeetingTranscript(transcript);

        // 2. Send Email
        await sendMeetingSummaryEmail({
            // ✅ FIX 2: Change 'meeting.user' to 'meeting.createdBy'
            userEmail: meeting.createdBy.email!,
            userName: meeting.createdBy.name || 'User',
            meetingTitle: meeting.title,
            summary: processed.summary,
            actionItems: processed.actionItems,
            meetingId: meeting.id,
            meetingDate: meeting.startTime.toLocaleDateString()
        });

        // 3. Update DB with Summary
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