const { PrismaClient } = require("@prisma/client")

const prisma = new PrismaClient()

exports.handler = async (event) => {
    try {
        console.log("🚀 [Scheduler] Started...")
        console.log("🕒 [Scheduler] Server Time (UTC):", new Date().toISOString())

        // 1. Sync Calendars
        console.log("📅 [Step 1] Syncing Calendars...")
        await syncAllUserCalendars()

        // 2. Schedule Bots
        console.log("🤖 [Step 2] Scheduling Bots...")
        await scheduleBotsForUpcomingMeetings()

        // 3. Reset Limits
        console.log("🔄 [Step 3] Checking Chat Limits...")
        await resetDailyChatUsage()

        return {
            statusCode: 200,
            body: JSON.stringify({ 
                message: 'Scheduler finished', 
                timestamp: new Date().toISOString() 
            })
        }

    } catch (error) {
        console.error('❌ [CRITICAL ERROR] Scheduler Failed:', error)
        return {
            statusCode: 500,
            body: JSON.stringify({ 
                error: 'Internal Server Error', 
                details: error.message
            })
        }
    } finally {
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
    console.log(`👤 [Sync] Processing user: ${user.email || user.id}`)
    try {
        let accessToken = user.googleAccessToken
        const now = new Date()
        
        // Refresh token if needed
        const tokenExpiry = new Date(user.googleTokenExpiry)
        if (tokenExpiry <= new Date(now.getTime() + 10 * 60 * 1000)) {
            console.log(`🔄 [Sync] Refreshing token...`)
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
        console.log(`📊 [Sync] Fetched ${events.length} events from Google`)

        for (const event of events) {
            if (event.status === 'cancelled') {
                await prisma.meeting.deleteMany({ where: { calendarEventId: event.id } })
                continue
            }
            await processCalendarEvent(user, event)
        }
    } catch (error) {
        console.error(`❌ [Sync] Error for ${user.email}:`, error.message)
    }
}

async function processCalendarEvent(user, event) {
    const meetingUrl = event.hangoutLink || event.conferenceData?.entryPoints?.[0]?.uri
    
    if (!meetingUrl || !event.start?.dateTime) {
        return
    }

    const eventData = {
        calendarEventId: event.id,
        createdById: user.id, 
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
        // LOOK AHEAD 20 MINUTES (Increased buffer)
        const checkWindow = new Date(now.getTime() + 20 * 60 * 1000)

        console.log(`🔍 [Schedule] Checking window: ${now.toISOString()} -> ${checkWindow.toISOString()}`)

        const upcomingMeetings = await prisma.meeting.findMany({
            where: {
                startTime: { gte: now, lte: checkWindow },
                botScheduled: true,
                botSent: false,
                meetingUrl: { not: null },
                meetingEnded: false
            },
            include: { createdBy: true } 
        })

        console.log(`🎯 [Schedule] Found ${upcomingMeetings.length} eligible meetings`)

        for (const meeting of upcomingMeetings) {
            const user = meeting.createdBy;
            
            console.log(`🚀 [Schedule] Attempting: "${meeting.title}" for ${user.email}`)

            const canSchedule = await canUserScheduleMeeting(user)
            
            if (!canSchedule.allowed) {
                console.warn(`⛔ [Schedule] Denied: ${canSchedule.reason}`)
                await prisma.meeting.update({
                    where: { id: meeting.id },
                    data: { botSent: true, botJoinedAt: new Date() }
                })
                continue
            }

            console.log(`✅ [Schedule] Deploying bot...`)
            const botResponse = await deployBotToMeeting(meeting, user)

            // CRITICAL FIX: Log the entire response to debug
            console.log("🔍 [DEBUG] Bot Response:", JSON.stringify(botResponse));

            if (botResponse.success && botResponse.bot_id) {
                console.log(`🎉 [Schedule] SUCCESS! Bot ID: ${botResponse.bot_id}`)
                
                // SAVE THE BOT ID TO DATABASE
                await prisma.meeting.update({
                    where: { id: meeting.id },
                    data: { 
                        botSent: true, 
                        botId: botResponse.bot_id, // This MUST be saved
                        botJoinedAt: new Date() 
                    }
                })
                
                await prisma.user.update({
                    where: { id: user.id },
                    data: { meetingsThisMonth: { increment: 1 } }
                })
            } else {
                console.error(`💀 [Schedule] FAILED. ID Missing or Error: ${botResponse.error}`)
            }
        }
    } catch (error) {
        console.error('❌ [Schedule] Global Error:', error)
    }
}

async function deployBotToMeeting(meeting, user) {
    try {
        const requestBody = {
            meeting_url: meeting.meetingUrl,
            bot_name: user.botName || 'Meeting Bot',
            reserved: false,
            recording_mode: 'speaker_view',
            speech_to_text: { provider: 'Default' },
            webhook_url: process.env.WEBHOOK_URL,
            extra: {
                meeting_id: meeting.id,
                user_id: user.id
            }
        }

        if (user.botImageUrl) requestBody.bot_image = user.botImageUrl

        const response = await fetch('https://api.meetingbaas.com/v2/bots', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-meeting-baas-api-key': process.env.MEETING_BAAS_API_KEY
            },
            body: JSON.stringify(requestBody)
        })

        const rawText = await response.text();
        console.log("🔍 [DEBUG] Raw API Response:", rawText);

        if (!response.ok) {
            return { success: false, error: `HTTP ${response.status}: ${rawText}` }
        }

        const json = JSON.parse(rawText);
        
        // ✅ FIX: Check inside 'data' object correctly
        const finalBotId = json.bot_id || (json.data && json.data.bot_id) || json.id;

        if (!finalBotId) {
             return { success: false, error: "Bot ID not found in response" }
        }

        return { success: true, bot_id: finalBotId }
    } catch (error) {
        return { success: false, error: error.message }
    }
}

async function canUserScheduleMeeting(user) {
    const PLAN_LIMITS = { free: { meetings: 5 }, starter: { meetings: 10 }, pro: { meetings: 30 }, premium: { meetings: -1 } }
    const currentPlan = user.currentPlan || 'free'
    const limits = PLAN_LIMITS[currentPlan] || PLAN_LIMITS.free
    const usage = user.meetingsThisMonth || 0

    if (user.subscriptionStatus !== 'active' && currentPlan !== 'free') return { allowed: false, reason: `Inactive Subscription` }
    if (limits.meetings !== -1 && usage >= limits.meetings) return { allowed: false, reason: `Limit Reached` }
    return { allowed: true }
}

async function refreshGoogleToken(user) {
    try {
        if (!user.googleRefreshToken) return null
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
        if (!tokens.access_token) return null
        
        await prisma.user.update({
            where: { id: user.id },
            data: {
                googleAccessToken: tokens.access_token,
                googleTokenExpiry: new Date(Date.now() + tokens.expires_in * 1000)
            }
        })
        return tokens.access_token
    } catch (e) { return null }
}

async function resetDailyChatUsage() {
    try {
        await prisma.user.updateMany({
            where: { subscriptionStatus: 'active' },
            data: { chatMessagesToday: 0 }
        })
    } catch (error) { console.error(error) }
}