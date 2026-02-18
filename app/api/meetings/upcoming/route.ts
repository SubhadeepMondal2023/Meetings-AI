import { auth, clerkClient } from "@clerk/nextjs/server"
import { prisma } from "@/lib/db"
import { NextResponse } from "next/server"
import { google } from "googleapis"

export async function GET() {
    try {
        const { userId } = await auth()
        if (!userId) {
            return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
        }

        // 1. Find User
        const user = await prisma.user.findUnique({
            where: { clerkId: userId }
        })

        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 404 })
        }

        let isCalendarConnected = user.calendarConnected;

        // --- SYNC LOGIC ---
        try {
            const client = await clerkClient()
            // Fix: Use 'google' (Fixes deprecation)
            const oauthTokens = await client.users.getUserOauthAccessToken(userId, 'google')
            
            if (oauthTokens.data.length > 0) {
                const accessToken = oauthTokens.data[0].token
                const oauth2Client = new google.auth.OAuth2()
                oauth2Client.setCredentials({ access_token: accessToken })
                const calendar = google.calendar({ version: 'v3', auth: oauth2Client })

                const now = new Date()
                const nextWeek = new Date()
                nextWeek.setDate(now.getDate() + 7)

                const response = await calendar.events.list({
                    calendarId: 'primary',
                    timeMin: now.toISOString(),
                    timeMax: nextWeek.toISOString(),
                    singleEvents: true,
                    orderBy: 'startTime'
                })

                const googleEvents = response.data.items || []

                for (const event of googleEvents) {
                    if (event.start?.dateTime && event.end?.dateTime) {
                        const meetingUrl = event.hangoutLink || 
                            event.location || 
                            event.description?.match(/https?:\/\/[^\s]+/)?.[0] || 
                            ""

                        await prisma.meeting.upsert({
                            where: { calendarEventId: event.id! },
                            update: {
                                title: event.summary || "Untitled Meeting",
                                startTime: new Date(event.start.dateTime),
                                endTime: new Date(event.end.dateTime),
                                meetingUrl: meetingUrl,
                            },
                            create: {
                                // ✅ FIXED: Use 'createdById' relation instead of 'userId'
                                createdById: user.id, 
                                title: event.summary || "Untitled Meeting",
                                description: event.description || "",
                                startTime: new Date(event.start.dateTime),
                                endTime: new Date(event.end.dateTime),
                                meetingUrl: meetingUrl,
                                calendarEventId: event.id!,
                                isFromCalendar: true,
                                botScheduled: true 
                            }
                        })
                    }
                }
                
                if (!user.calendarConnected) {
                    await prisma.user.update({ where: { id: user.id }, data: { calendarConnected: true } });
                    isCalendarConnected = true;
                }
            }
        } catch (error) {
            console.log("⚠️ Calendar Sync Issue:", error);
            if (user.calendarConnected) {
                await prisma.user.update({ where: { id: user.id }, data: { calendarConnected: false } });
                isCalendarConnected = false;
            }
        }

        // --- FETCH FROM DB ---
        const now = new Date()
        const upcomingMeetings = await prisma.meeting.findMany({
            where: {
                createdById: user.id, // ✅ FIXED: Changed from userId to createdById
                startTime: { gte: now },
                meetingEnded: false 
            },
            orderBy: { startTime: 'asc' },
            take: 10
        })

        const events = upcomingMeetings.map(meeting => ({
            id: meeting.calendarEventId || meeting.id,
            meetingId: meeting.id, 
            summary: meeting.title,
            start: { dateTime: meeting.startTime.toISOString() },
            end: { dateTime: meeting.endTime.toISOString() },
            hangoutLink: meeting.meetingUrl,
            botScheduled: meeting.botScheduled
        }))

        return NextResponse.json({
            events,
            connected: isCalendarConnected,
            source: 'synced-database'
        })

    } catch (error) {
        console.error('Error fetching meetings:', error)
        return NextResponse.json({ error: "Failed to sync meetings" }, { status: 500 })
    }
}