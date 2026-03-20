import { NextRequest, NextResponse } from "next/server"
import { PrismaClient } from "@prisma/client"
import { Client } from "@upstash/qstash"
import { normalizeTranscript, validateTranscript } from "@/lib/transcript-parser"
import { transcribeAudioFromUrl } from "@/lib/transcription"

// Isolated Prisma client for webhook — doesn't share pool with rest of app
const webhookPrisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
  log: ["error"]
})

const client = new Client({ token: process.env.QSTASH_TOKEN! })

const processedBots = new Set<string>()

export async function POST(request: NextRequest) {
  try {
    const bodyText = await request.text()
    const webhook = JSON.parse(bodyText)
    const webhookData = webhook.data || {}
    const botId = webhookData.bot_id || webhook.bot_id

    const isCompletionEvent =
      webhook.event === "complete" ||
      webhook.event === "meeting.ended" ||
      webhook.event === "bot_data" ||
      webhookData.transcript ||
      webhookData.audio ||
      webhookData.mp4

    if (!botId || !isCompletionEvent) {
      return NextResponse.json({ success: true, ignored: true })
    }

    if (processedBots.has(botId)) {
      console.log(`⚠️ Duplicate webhook for bot ${botId} — ignoring`)
      return NextResponse.json({ success: true, deduplicated: true })
    }

    processedBots.add(botId)
    setTimeout(() => processedBots.delete(botId), 5 * 60 * 1000)

    processWebhook(botId, webhookData).catch(err =>
      console.error("❌ Background processing failed:", err)
    )

    return NextResponse.json({ success: true, message: "Processing started" })

  } catch (error) {
    console.error("Webhook error:", error)
    return NextResponse.json({ success: true })
  }
}

async function processWebhook(botId: string, webhookData: any) {
  try {
    console.log(`🔔 Processing data for Bot ID: ${botId}`)

    const meeting = await webhookPrisma.meeting.findFirst({
      where: { botId },
      include: { createdBy: true }
    })

    if (!meeting) {
      console.error("❌ Meeting not found for bot id:", botId)
      return
    }
    await webhookPrisma.$disconnect()
    let parsedTranscript: any = meeting.transcript

    const transcriptHasContent =
      webhookData.transcript &&
      Array.isArray(webhookData.transcript) &&
      webhookData.transcript.some((seg: any) => seg.words && seg.words.length > 0)

    if ((!webhookData.transcript || !transcriptHasContent) && webhookData.audio) {
      console.log(`🎙️ No transcript content. Transcribing audio with Groq Whisper...`)
      try {
        const transcribedSegments = await transcribeAudioFromUrl(webhookData.audio)
        if (transcribedSegments && transcribedSegments.length > 0) {
          if (webhookData.transcript && Array.isArray(webhookData.transcript) && webhookData.transcript.length > 0) {
            const merged = mergeTranscriptWithSpeakers(webhookData.transcript, transcribedSegments)
            parsedTranscript = merged.length > 0 ? merged : transcribedSegments
          } else {
            parsedTranscript = transcribedSegments
          }
          console.log(`✅ Audio transcribed: ${transcribedSegments.length} segments`)
        }
      } catch (err) {
        console.error("❌ Transcription failed:", err)
      }
    } else if (webhookData.transcript && transcriptHasContent) {
      try {
        let rawTranscript = webhookData.transcript
        if (typeof webhookData.transcript === "string") {
          rawTranscript = JSON.parse(webhookData.transcript)
        }
        const normalized = normalizeTranscript(rawTranscript)
        if (normalized && validateTranscript(normalized)) {
          parsedTranscript = normalized
          console.log(`✅ Transcript normalized: ${normalized.length} segments`)
        } else {
          parsedTranscript = rawTranscript
        }
      } catch (e) {
        parsedTranscript = webhookData.transcript
      }
    }

    console.log("📝 Transcript type:", typeof parsedTranscript, "Is null:", parsedTranscript === null)
    await webhookPrisma.$connect()
    await webhookPrisma.meeting.update({
      where: { id: meeting.id },
      data: {
        meetingEnded: true,
        transcriptReady: true,
        transcript: parsedTranscript,
        recordingUrl: webhookData.mp4 || meeting.recordingUrl,
        speakers: webhookData.speakers || meeting.speakers
      }
    })

    const updatedMeeting = await webhookPrisma.meeting.findUnique({
      where: { id: meeting.id }
    })

    if (!updatedMeeting?.transcript) {
      console.log(`⏳ Transcript not ready for meeting ${meeting.id}`)
      return
    }

    console.log(`📝 Transcript ready (${JSON.stringify(updatedMeeting.transcript).length} bytes). Queuing...`)

    const appUrl = process.env.NEXT_PUBLIC_APP_URI
    const response = await client.publishJSON({
      url: `${appUrl}/api/queue/process-meeting`,
      body: {
        meetingId: meeting.id,
        transcript: updatedMeeting.transcript,
        botId,
        meetingTitle: meeting.title
      },
      retries: 0
    })

    console.log(`📨 Job queued (Msg ID: ${response.messageId}) for Meeting: ${meeting.title}`)

  } finally {
    await webhookPrisma.$disconnect()
  }
}

function mergeTranscriptWithSpeakers(originalSegments: any[], transcribedSegments: any[]): any[] {
  if (!transcribedSegments || transcribedSegments.length === 0) return originalSegments

  const fullText = transcribedSegments
    .map((seg: any) => seg.words?.map((w: any) => w.word).join(" ") || "")
    .join(" ").trim()

  if (!fullText) return originalSegments

  const words = fullText.split(/\s+/).filter((w: string) => w.length > 0)
  let wordIndex = 0
  const merged: any[] = []

  for (const originalSeg of originalSegments) {
    const speaker = originalSeg.speaker || "Unknown"
    const offset = originalSeg.offset || originalSeg.start_time || 0
    const startTime = originalSeg.start_time || offset
    const endTime = originalSeg.end_time || startTime + 1
    const duration = endTime - startTime
    const estimatedWords = Math.max(1, Math.round(duration * 2))
    const segmentTextWords = words.slice(wordIndex, wordIndex + estimatedWords)
    const segmentWords: any[] = []

    if (segmentTextWords.length > 0) {
      const timePerWord = duration / Math.max(1, segmentTextWords.length)
      let currentTime = startTime
      for (const word of segmentTextWords) {
        segmentWords.push({ word, start: currentTime, end: currentTime + timePerWord })
        currentTime += timePerWord
      }
      wordIndex += estimatedWords
    }

    merged.push({ speaker, offset, start_time: startTime, end_time: endTime, words: segmentWords })
  }

  console.log(`✅ Merged ${merged.length} segments`)
  return merged
}