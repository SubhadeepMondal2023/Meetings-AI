import { prisma } from "@/lib/db";
import { chatWithAllMeetings } from "@/lib/rag";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getCachedResponse, setCachedResponse } from "@/lib/cache"; // 👈 Import Cache Utils

export async function POST(request: NextRequest) {
    try {
        const { question, userId: slackUserId } = await request.json()

        if (!question) {
            return NextResponse.json({ error: 'missing question' }, { status: 400 })
        }

        // ---------------------------------------------------------
        // 1. AUTHENTICATION & USER ID RESOLUTION
        // ---------------------------------------------------------
        let targetUserId = slackUserId

        if (!slackUserId) {
            const { userId: clerkUserId } = await auth()
            if (!clerkUserId) {
                return NextResponse.json({ error: 'not logged in' }, { status: 401 })
            }
            targetUserId = clerkUserId
        } else {
            const user = await prisma.user.findUnique({
                where: { id: slackUserId },
                select: { clerkId: true }
            })

            if (!user) {
                return NextResponse.json({ error: 'user not found' }, { status: 404 })
            }
            targetUserId = user.clerkId
        }

        // ---------------------------------------------------------
        // 2. ⚡ REDIS CACHE CHECK (The Optimization)
        // ---------------------------------------------------------
        // Check if we already answered this specific question for this user
        const cachedAnswer = await getCachedResponse(question, targetUserId);

        if (cachedAnswer) {
            console.log("⚡ HIT: Serving from Redis Cache (0ms latency)");
            return NextResponse.json({
                answer: cachedAnswer,
                // We return empty sources for cached hits to save bandwidth, 
                // or you can cache sources too if you modify the cache lib
                sources: [], 
                isCached: true
            });
        }

        console.log("🐢 MISS: Calling OpenAI/Pinecone/Neo4j...");

        // ---------------------------------------------------------
        // 3. EXPENSIVE AI OPERATION (Graph + Vector)
        // ---------------------------------------------------------
        const response = await chatWithAllMeetings(targetUserId, question)

        // ---------------------------------------------------------
        // 4. 💾 SAVE TO CACHE
        // ---------------------------------------------------------
        // Save the result for 1 hour so the next request is instant
        // We use 'waitUntil' if available to not block the response, otherwise await is fine
        await setCachedResponse(question, response.answer, targetUserId);

        return NextResponse.json(response)

    } catch (error) {
        console.error('error in chat:', error)
        return NextResponse.json({
            error: 'failed to process question',
            answer: "I encountered an error while searching your meetings. please try again."
        }, { status: 500 })
    }
}