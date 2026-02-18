import { prisma } from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function POST(
    request: Request,
    { params }: { params: Promise<{ meetingId: string }> }
) {
    try {
        const { userId } = await auth()
        if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

        const { meetingId } = await params
        const { botScheduled } = await request.json()

        const user = await prisma.user.findUnique({
            where: { clerkId: userId }
        })

        if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })

        const meeting = await prisma.meeting.findUnique({
            where: {
                id: meetingId,
                createdById: user.id // ✅ Changed
            }
        })

        if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 })

        await prisma.meeting.update({
            where: { id: meetingId },
            data: { botScheduled }
        })

        if (botScheduled) {
            if (!meeting.meetingUrl) {
                return NextResponse.json({ error: "No meeting URL" }, { status: 400 })
            }

            const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URI}/api/webhooks/meetingbaas`
            const apiKey = process.env.MEETING_BAAS_API_KEY

            try {
                const response = await fetch("https://api.meetingbaas.com/bots", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "x-meeting-baas-api-key": apiKey!,
                    },
                    body: JSON.stringify({
                        meeting_url: meeting.meetingUrl,
                        bot_name: "MeetingBot",
                        recording_mode: "speaker_view",
                        // ✅ Fix: botImageUrl might not exist on User schema anymore?
                        // Use user.image or a default
                        bot_image: user.image || "https://i.pravatar.cc/150?u=MeetingBot", 
                        entry_message: "Hi, I'm recording this meeting.",
                        webhook_url: webhookUrl,
                    }),
                })

                if (!response.ok) throw new Error("Bot API failed")
                const botData = await response.json()

                await prisma.meeting.update({
                    where: { id: meetingId },
                    data: {
                        botId: botData.bot_id,
                        botSent: true,
                        botJoinedAt: new Date()
                    }
                })

            } catch (error) {
                return NextResponse.json({ error: "Failed to spawn bot" }, { status: 500 })
            }
        }

        return NextResponse.json({ success: true, botScheduled })

    } catch (error) {
        return NextResponse.json({ error: "Failed" }, { status: 500 })
    }
}