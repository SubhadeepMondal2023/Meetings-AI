const { PrismaClient } = require("@prisma/client")

const prisma = new PrismaClient()

exports.handler = async (event) => {
    try {
        console.log("🚀 [Scheduler] Started...")
        console.log("🕒 [Scheduler] Server Time (UTC):", new Date().toISOString())

        // 1. Sync Calendars (Fetch from Google, save to DB)
        console.log("📅 [Step 1] Syncing Calendars...")
        await syncAllUserCalendars()

        // 2. Schedule Bots (Check DB for upcoming meetings, send Bot)
        console.log("🤖 [Step 2] Scheduling Bots...")
        await scheduleBotsForUpcomingMeetings()

        // 3. Reset Daily Chat Limits
        console.log("🔄 [Step 3] Checking Chat Limits...")
        const result = await prisma.user.updateMany({
            where: { subscriptionStatus: 'active' },
            data: { chatMessagesToday: 0 }
        })

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: 'Scheduler completed successfully',
                usersReset: result.count,
                timestamp: new Date().toISOString()
            })
        }

    } catch (error) {
        console.error('❌ [CRITICAL ERROR] Scheduler Failed:', error)

        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Internal Server Error',
                details: error.message,
                timestamp: new Date().toISOString()
            })
        }
    } finally {
        // Important: Close DB connection so Lambda doesn't hang
        await prisma.$disconnect()
    }
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

async function syncAllUserCalendars() {
    try {
        const users = await prisma.user.findMany({
            where: {
                calendarConnected: true,
                googleAccessToken: { not: null }
            }
        })

        console.log(`🔎 [Sync] Found ${users.length} users with connected calendars`)

        for (const user of users) {
            try {
                await syncUserCalendar(user)
            } catch (error) {
                console.error(`❌ [Sync] Failed for user ${user.id}:`, error.message)
            }
        }
    } catch (error) {
        console.error('❌ [Sync] Global Error:', error)
    }
}

async function syncUserCalendar(user) {
    try {
        let accessToken = user.googleAccessToken
        const now = new Date()
        
        // Refresh token if needed
        const tokenExpiry = new Date(user.googleTokenExpiry)
        if (tokenExpiry <= new Date(now.getTime() + 10 * 60 * 1000)) {
            console.log(`🔄 [Sync] Refreshing token for ${user.clerkId}...`)
            accessToken = await refreshGoogleToken(user)
            if (!accessToken) return 
        }

        const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
        
        const response = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
            `timeMin=${now.toISOString()}&` +
            `timeMax=${sevenDaysLater.toISOString()}&` +
            `singleEvents=true&orderBy=startTime`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
        )

        if (!response.ok) {
            if (response.status === 401) {
                console.log(`🔐 [Sync] Unauthorized, disconnecting calendar`)
                await prisma.user.update({ where: { id: user.id }, data: { calendarConnected: false } })
            }
            return
        }

        const data = await response.json()
        const events = data.items || []

        console.log(`📊 [Sync] Fetched ${events.length} events for user ${user.clerkId}`)

        for (const event of events) {
            if (event.status === 'cancelled') {
                await prisma.meeting.deleteMany({ where: { calendarEventId: event.id } })
                continue
            }
            await processCalendarEvent(user, event)
        }
    } catch (error) {
        console.error(`❌ [Sync] Error for ${user.clerkId}:`, error.message)
    }
}

async function refreshGoogleToken(user) {
    try {
        if (!user.googleRefreshToken) {
            await prisma.user.update({
                where: { id: user.id },
                data: { calendarConnected: false, googleAccessToken: null }
            })
            return null
        }

        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                refresh_token: user.googleRefreshToken,
                grant_type: 'refresh_token'
            })
        })

        const tokens = await response.json()

        if (!tokens.access_token) {
            await prisma.user.update({
                where: { id: user.id },
                data: { calendarConnected: false }
            })
            return null
        }

        await prisma.user.update({
            where: { id: user.id },
            data: {
                googleAccessToken: tokens.access_token,
                googleTokenExpiry: new Date(Date.now() + tokens.expires_in * 1000)
            }
        })
        return tokens.access_token
    } catch (error) {
        console.error(`❌ Token refresh error:`, error)
        return null
    }
}

async function processCalendarEvent(user, event) {
    const meetingUrl = event.hangoutLink || event.conferenceData?.entryPoints?.[0]?.uri
    
    if (!meetingUrl || !event.start?.dateTime) return

    const eventData = {
        calendarEventId: event.id,
        userId: user.id, // ✅ Correct for your schema
        title: event.summary || 'Untitled Meeting',
        description: event.description || null,
        meetingUrl: meetingUrl,
        startTime: new Date(event.start.dateTime),
        endTime: new Date(event.end.dateTime),
        attendees: event.attendees ? JSON.stringify(event.attendees.map(a => a.email)) : null,
        isFromCalendar: true,
        botScheduled: true 
    }

    try {
        const existing = await prisma.meeting.findUnique({ where: { calendarEventId: event.id } })

        if (existing) {
            await prisma.meeting.update({
                where: { calendarEventId: event.id },
                data: {
                    title: eventData.title,
                    meetingUrl: eventData.meetingUrl,
                    startTime: eventData.startTime,
                    endTime: eventData.endTime
                }
            })
        } else {
            console.log(`✨ [Sync] Created DB Entry: "${eventData.title}"`)
            await prisma.meeting.create({ data: eventData })
        }
    } catch (error) {
        console.error(`❌ [Sync] DB Error:`, error.message)
    }
}

async function scheduleBotsForUpcomingMeetings() {
    try {
        const now = new Date()
        const checkWindow = new Date(now.getTime() + 15 * 60 * 1000) // Increased to 15m to be safe

        console.log(`🔍 [Schedule] Checking window: ${now.toISOString()} -> ${checkWindow.toISOString()}`)

        const upcomingMeetings = await prisma.meeting.findMany({
            where: {
                startTime: { gte: now, lte: checkWindow },
                botScheduled: true,
                botSent: false,
                meetingUrl: { not: null },
                meetingEnded: false
            },
            include: { user: true } 
        })

        console.log(`🎯 [Schedule] Found ${upcomingMeetings.length} eligible meetings`)

        for (const meeting of upcomingMeetings) {
            console.log(`\n---------------------------------------------------`)
            console.log(`🚀 [Schedule] Attempting: "${meeting.title}" for ${meeting.user.email}`)

            const canSchedule = await canUserScheduleMeeting(meeting.user)
            
            if (!canSchedule.allowed) {
                console.warn(`⛔ [Schedule] Denied: ${canSchedule.reason}`)
                // Mark as sent so we don't retry forever
                await prisma.meeting.update({
                    where: { id: meeting.id },
                    data: { botSent: true, botJoinedAt: new Date() } 
                })
                continue
            }

            console.log(`✅ [Schedule] User eligible. Deploying bot...`)
            const botResponse = await deployBotToMeeting(meeting)

            if (botResponse.success) {
                console.log(`🎉 [Schedule] SUCCESS! Bot ID: ${botResponse.bot_id}`)
                await prisma.meeting.update({
                    where: { id: meeting.id },
                    data: { botSent: true, botId: botResponse.bot_id, botJoinedAt: new Date() }
                })
                await prisma.user.update({
                    where: { id: meeting.userId },
                    data: { meetingsThisMonth: { increment: 1 } }
                })
            } else {
                console.error(`💀 [Schedule] FAILED: ${botResponse.error}`)
            }
        }
    } catch (error) {
        console.error('❌ [Schedule] Global Error:', error)
    }
}

async function deployBotToMeeting(meeting) {
    try {
        const requestBody = {
            meeting_url: meeting.meetingUrl,
            bot_name: meeting.user.botName || 'Meeting Bot',
            reserved: false,
            recording_mode: 'speaker_view',
            speech_to_text: { provider: 'Default' },
            webhook_url: process.env.WEBHOOK_URL,
            extra: {
                meeting_id: meeting.id,
                user_id: meeting.userId // ✅ Correct for your schema
            }
        }

        if (meeting.user.botImageUrl) requestBody.bot_image = meeting.user.botImageUrl

        console.log(`📡 [Deploy] Sending payload to MeetingBaas...`)

        const response = await fetch('https://api.meetingbaas.com/bots', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-meeting-baas-api-key': process.env.MEETING_BAAS_API_KEY
            },
            body: JSON.stringify(requestBody)
        })

        if (!response.ok) {
            const error = await response.text()
            return { success: false, error: `HTTP ${response.status}: ${error}` }
        }

        const data = await response.json()
        return { success: true, bot_id: data.bot_id }
    } catch (error) {
        return { success: false, error: error.message }
    }
}

async function canUserScheduleMeeting(user) {
    // NOTE: You set Free meetings to 0. 
    // This means Free users will NEVER get a bot.
    const PLAN_LIMITS = { free: { meetings: 0 }, starter: { meetings: 10 }, pro: { meetings: 30 }, premium: { meetings: -1 } }
    
    const currentPlan = user.currentPlan || 'free'
    const limits = PLAN_LIMITS[currentPlan] || PLAN_LIMITS.free
    const usage = user.meetingsThisMonth || 0

    if (currentPlan === 'free') return { allowed: false, reason: 'Free plan users cannot use bot feature' }
    if (user.subscriptionStatus !== 'active') return { allowed: false, reason: `Subscription is ${user.subscriptionStatus}` }
    if (limits.meetings !== -1 && usage >= limits.meetings) return { allowed: false, reason: `Limit Reached (${usage}/${limits.meetings})` }

    return { allowed: true }
}