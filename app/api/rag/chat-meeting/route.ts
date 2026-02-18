import { chatWithMeeting } from "@/lib/rag";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getCachedResponse, setCachedResponse } from "@/lib/cache"; // 👈 Import

export async function POST(request: NextRequest) {
    const { userId } = await auth()

    if (!userId) {
        return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
    }

    const { meetingId, question } = await request.json()

    if (!meetingId || !question) {
        return NextResponse.json({ error: 'Missing meetingId or question' }, { status: 400 })
    }

    try {
        // 1. Create a unique cache key that includes the MeetingID
        // We append meetingId to the question so the cache is specific to THIS meeting
        const uniqueCacheKey = `${meetingId}::${question}`;
        
        const cachedAnswer = await getCachedResponse(uniqueCacheKey, userId);

        if (cachedAnswer) {
            console.log("⚡ HIT: Serving Meeting Chat from Cache");
            return NextResponse.json({
                answer: cachedAnswer,
                sources: [],
                isCached: true
            });
        }

        // 2. Expensive Operation
        const response = await chatWithMeeting(userId, meetingId, question)

        // 3. Save to Cache
        await setCachedResponse(uniqueCacheKey, response.answer, userId);

        return NextResponse.json(response)
    } catch (error) {
        console.error('Error in chat:', error)
        return NextResponse.json({ error: 'Failed to process question' }, { status: 500 })
    }
}