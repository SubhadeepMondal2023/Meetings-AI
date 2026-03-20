import { prisma } from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function POST(
    request: Request,
    { params }: { params: Promise<{ meetingId: string }> }
) {
    try {
        const { meetingId } = await params
        const body = await request.json()
        const { botScheduled } = body

        // ✅ Allow QStash scheduled calls (no user auth needed)
        const isQStashCall = request.headers.get("upstash-signature") !== null

        let meeting = null

        if (isQStashCall) {
            // QStash call — find meeting directly without user auth
            meeting = await prisma.meeting.findUnique({
                where: { id: meetingId },
                include: { createdBy: true }
            })

            if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 })

            // ✅ Respect manual disable — if user turned off bot, skip
            if (!meeting.botScheduled) {
                console.log(`⏭️ Bot skipped for meeting ${meetingId} — manually disabled`)
                return NextResponse.json({ success: true, skipped: true })
            }

        } else {
            // Manual user call — require auth
            const { userId } = await auth()
            if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 })

            const user = await prisma.user.findUnique({
                where: { clerkId: userId }
            })

            if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })

            meeting = await prisma.meeting.findUnique({
                where: { id: meetingId, createdById: user.id },
                include: { createdBy: true }
            })

            if (!meeting) return NextResponse.json({ error: "Meeting not found" }, { status: 404 })

            await prisma.meeting.update({
                where: { id: meetingId },
                data: { botScheduled }
            })

            // If manually disabling — just update flag and return
            if (!botScheduled) {
                return NextResponse.json({ success: true, botScheduled: false })
            }
        }

        // ✅ Send bot to meeting
        if (!meeting.meetingUrl) {
            return NextResponse.json({ error: "No meeting URL" }, { status: 400 })
        }

        // Don't send bot twice
        if (meeting.botSent) {
            console.log(`⏭️ Bot already sent for meeting ${meetingId}`)
            return NextResponse.json({ success: true, alreadySent: true })
        }

        const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URI}/api/webhooks/meetingbaas`
        const apiKey = process.env.MEETING_BAAS_API_KEY

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
                bot_image: meeting.createdBy?.image || "https://img.freepik.com/free-vector/chatbot-chat-message-vectorart_78370-4104.jpg?semt=ais_hybrid&w=740&q=80",
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

        console.log(`🤖 Bot sent for meeting: ${meeting.title}`)
        return NextResponse.json({ success: true, botScheduled: true })

    } catch (error) {
        console.error("bot-toggle error:", error)
        return NextResponse.json({ error: "Failed" }, { status: 500 })
    }
}