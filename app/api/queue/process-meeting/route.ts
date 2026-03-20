import { NextRequest, NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/dist/nextjs";
import { processMeetingTranscript } from "@/lib/ai-processor";
import { addToKnowledgeGraph } from "@/lib/graph";
import { prisma } from "@/lib/db";
import { processTranscript } from "@/lib/rag";

async function handler(req: NextRequest) {
    console.log("👷 Worker Started: Processing Meeting...");
    const body = await req.json();
    const { meetingId, transcript } = body;

    console.log("📝 Received transcript type:", typeof transcript, "Is null:", transcript === null, "Is undefined:", transcript === undefined);

    try {
        const meeting = await prisma.meeting.findUnique({
            where: { id: meetingId },
            include: { createdBy: true }
        });

        if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });

        const processed = await processMeetingTranscript(transcript);

        await prisma.meeting.update({
            where: { id: meetingId },
            data: { 
                summary: processed.summary, 
                actionItems: processed.actionItems, 
                processed: true, 
                processedAt: new Date() 
            }
        });

        const transcriptText = Array.isArray(transcript)
            ? transcript.map((seg: any) => {
                const text = seg.words?.map((w: any) => w.word).join(" ") || seg.text || ""
                return `${seg.speaker || "Speaker"}: ${text}`
            }).join("\n")
            : String(transcript)

        // Run sequentially to avoid connection pool exhaustion
        await processTranscript(meetingId, meeting.createdById, transcriptText, meeting.title)
            .catch(e => console.error("❌ processTranscript failed:", e))

        await addToKnowledgeGraph(transcript, meetingId, meeting.title)
            .catch(e => console.error("❌ addToKnowledgeGraph failed:", e))

        console.log(`✅ Worker Finished: Meeting ${meetingId} fully processed.`);
        return NextResponse.json({ success: true });

    } catch (error) {
        console.error("❌ Worker Failed:", error);
        return NextResponse.json({ error: "Processing failed" }, { status: 500 });
    }
}

export const POST = verifySignatureAppRouter(handler);