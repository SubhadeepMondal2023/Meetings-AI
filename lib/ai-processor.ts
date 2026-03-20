/**
 * ENHANCED AI PROCESSOR FOR MEETING TRANSCRIPT ANALYSIS
 * Migrated: Gemini → Groq (llama-3.3-70b-versatile)
 */

import Groq from "groq-sdk"
import { prisma } from "@/lib/db"

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type ExecutiveSummary = {
  context: string
  decisions: string
  outlook: string
}

type ActionItem = {
  id: number
  text: string
}

type ProcessedMeetingTranscript = {
  summary: string
  actionItems: ActionItem[]
}

type RiskAnalysisResult = {
  html: string
  criticalRisks: string[]
  blindSpots: string[]
  confidenceScore: number
}

type SentimentDataPoint = {
  timestamp: number
  [speakerName: string]: number | undefined
}

type SpeakerProfile = {
  role: string
  sentiment: "Positive" | "Neutral" | "Negative"
  trait: string
  feedback: string
}

type SpeakerProfiles = {
  [speakerName: string]: SpeakerProfile
}

// ============================================================================
// INITIALIZATION
// ============================================================================

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! })

const MODEL = "llama-3.3-70b-versatile"

const CONFIG = {
  SENTIMENT_BATCH_SIZE: 5,
  SENTIMENT_WINDOW_SIZE: 30,
  TRANSCRIPT_MAX_LENGTH: 20000,
  SENTIMENT_MAX_LENGTH: 15000,
  TEMPERATURE: {
    SUMMARY: 0.3,
    RISK: 0.7,
    SENTIMENT: 0.2,
    PROFILES: 0.5,
  },
} as const

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function normalizeTranscript(transcript: unknown): string {
  if (typeof transcript === "string") return transcript.trim()
  if (Array.isArray(transcript)) {
    return transcript
      .map((item: unknown) => {
        const itemObj = item as Record<string, unknown>
        const text =
          Array.isArray(itemObj.words) && itemObj.words.length > 0
            ? (itemObj.words as unknown[])
                .map((w: unknown) => String((w as Record<string, unknown>).word ?? ""))
                .join(" ")
            : String(itemObj.text ?? "[speaking]")
        return `${String(itemObj.speaker ?? "Speaker")}: ${text}`
      })
      .join("\n")
  }
  if (transcript && typeof transcript === "object" && "text" in transcript) {
    return String((transcript as Record<string, unknown>).text).trim()
  }
  throw new Error("INVALID_TRANSCRIPT_FORMAT")
}

function validateTranscriptContent(text: string): { valid: boolean; error?: string } {
  if (!text || text.length === 0) return { valid: false, error: "EMPTY_TRANSCRIPT" }
  if (text.length > CONFIG.TRANSCRIPT_MAX_LENGTH)
    return { valid: false, error: `TRANSCRIPT_TOO_LONG: ${text.length}/${CONFIG.TRANSCRIPT_MAX_LENGTH}` }
  const meaningfulChars = text.replace(/[^a-zA-Z0-9\s]/g, "").trim()
  if (meaningfulChars.length < 20) return { valid: false, error: "INSUFFICIENT_CONTENT" }
  return { valid: true }
}

function truncateTranscript(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  const truncated = text.substring(0, maxLength)
  const lastNewline = truncated.lastIndexOf("\n")
  return lastNewline > maxLength * 0.8 ? truncated.substring(0, lastNewline) : truncated
}

function parseGroqJSON<T extends Record<string, unknown>>(
  content: string | null,
  expectedFields?: (keyof T)[]
): T {
  if (!content) throw new Error("EMPTY_RESPONSE")
  const clean = content.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim()
  let parsed: T
  try {
    parsed = JSON.parse(clean) as T
  } catch (error) {
    throw new Error(`JSON_PARSE_ERROR: ${error instanceof Error ? error.message : "Unknown"}`)
  }
  if (expectedFields) {
    const missing = expectedFields.filter((f) => !(f in parsed))
    if (missing.length > 0) throw new Error(`MISSING_FIELDS: ${missing.join(", ")}`)
  }
  return parsed
}

function estimateMeetingDuration(transcript: unknown[]): number {
  if (!Array.isArray(transcript) || transcript.length === 0) return 0
  let maxDuration = 0
  for (const segment of transcript) {
    const seg = segment as Record<string, unknown>
    let segmentEnd = 0
    if (Array.isArray(seg.words) && seg.words.length > 0) {
      const lastWord = seg.words[seg.words.length - 1] as Record<string, unknown>
      segmentEnd = (lastWord?.end as number) ?? 0
    } else if (typeof seg.end_time === "number") {
      segmentEnd = seg.end_time
    } else if (typeof seg.end === "number") {
      segmentEnd = seg.end
    }
    maxDuration = Math.max(maxDuration, segmentEnd)
  }
  return maxDuration
}

// ============================================================================
// LAYER 1: EXECUTIVE SUMMARY
// ============================================================================

export async function generateExecutiveSummary(transcript: unknown): Promise<ExecutiveSummary> {
  try {
    const transcriptText = normalizeTranscript(transcript)
    const validation = validateTranscriptContent(transcriptText)
    if (!validation.valid) throw new Error(validation.error)

    const truncated = truncateTranscript(transcriptText, CONFIG.TRANSCRIPT_MAX_LENGTH)

    const response = await groq.chat.completions.create({
      model: MODEL,
      temperature: CONFIG.TEMPERATURE.SUMMARY,
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a business analyst specializing in meeting summarization.
Extract exactly 3 components. Return ONLY valid JSON:
{
  "context": "1-2 sentences about meeting topic, attendees, purpose",
  "decisions": "2-3 sentences of KEY decisions made",
  "outlook": "1-2 sentences about next steps, timeline, implications"
}`,
        },
        { role: "user", content: truncated },
      ],
    })

    return parseGroqJSON<ExecutiveSummary>(
      response.choices[0]?.message?.content,
      ["context", "decisions", "outlook"]
    )
  } catch (error) {
    console.error("❌ Executive Summary Failed:", error)
    return {
      context: "Unable to generate summary.",
      decisions: "Unable to extract decisions.",
      outlook: "Unable to determine next steps.",
    }
  }
}

// ============================================================================
// LAYER 2: PROCESSED MEETING (SUMMARY + ACTION ITEMS)
// ============================================================================

export async function processMeetingTranscript(transcript: unknown): Promise<ProcessedMeetingTranscript> {
  try {
    const transcriptText = normalizeTranscript(transcript)
    const validation = validateTranscriptContent(transcriptText)
    if (!validation.valid) throw new Error(validation.error)

    const truncated = truncateTranscript(transcriptText, CONFIG.TRANSCRIPT_MAX_LENGTH)

    const response = await groq.chat.completions.create({
      model: MODEL,
      temperature: CONFIG.TEMPERATURE.SUMMARY,
      max_tokens: 800,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a meeting analysis expert.
Analyze the transcript and return ONLY valid JSON:
{
  "summary": "2-3 sentence summary of the meeting",
  "actionItems": [
    { "id": 1, "text": "Action item description" }
  ]
}`,
        },
        { role: "user", content: truncated },
      ],
    })

    return parseGroqJSON<ProcessedMeetingTranscript>(
      response.choices[0]?.message?.content,
      ["summary", "actionItems"]
    )
  } catch (error) {
    console.error("❌ Meeting Processing Failed:", error)
    return { summary: "Unable to process transcript.", actionItems: [] }
  }
}

// ============================================================================
// LAYER 3: RISK ANALYSIS
// ============================================================================

export async function generateRiskAnalysis(
  transcript: unknown,
  meetingId: string
): Promise<RiskAnalysisResult | null> {
  try {
    const transcriptText = normalizeTranscript(transcript)
    const validation = validateTranscriptContent(transcriptText)
    if (!validation.valid) {
      console.warn("⚠️ Risk analysis skipped:", validation.error)
      return null
    }

    const truncated = truncateTranscript(transcriptText, CONFIG.TRANSCRIPT_MAX_LENGTH)

    const response = await groq.chat.completions.create({
      model: MODEL,
      temperature: CONFIG.TEMPERATURE.RISK,
      max_tokens: 1500,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a risk analysis expert.
Analyze the meeting for risks. Return ONLY valid JSON:
{
  "html": "<div>HTML formatted risk report</div>",
  "criticalRisks": ["risk1", "risk2"],
  "blindSpots": ["blindspot1"],
  "confidenceScore": 75
}`,
        },
        { role: "user", content: truncated },
      ],
    })

    const parsed = parseGroqJSON<RiskAnalysisResult>(
      response.choices[0]?.message?.content,
      ["html", "criticalRisks", "blindSpots", "confidenceScore"]
    )

    try {
      await prisma.meeting.update({
        where: { id: meetingId },
        data: { riskAnalysis: JSON.stringify(parsed) },
      })
    } catch (dbError) {
      console.warn("⚠️ Failed to save risk analysis:", dbError)
    }

    return parsed
  } catch (error) {
    console.error("❌ Risk Analysis Failed:", error)
    return null
  }
}

// ============================================================================
// LAYER 4: SENTIMENT ARC
// ============================================================================

export async function generateSentimentArc(
  transcript: unknown,
  meetingId: string
): Promise<SentimentDataPoint[] | null> {
  try {
    if (!transcript || !Array.isArray(transcript)) {
      console.warn("⚠️ Sentiment analysis skipped: requires array format")
      return null
    }

    const duration = estimateMeetingDuration(transcript)
    if (duration === 0) {
      console.warn("⚠️ Could not determine meeting duration")
      return null
    }

    const windows = createSentimentWindows(transcript, duration, CONFIG.SENTIMENT_WINDOW_SIZE)
    if (windows.length === 0) return null

    const sentimentData = await processSentimentBatches(windows, CONFIG.SENTIMENT_BATCH_SIZE)

    if (sentimentData.length > 0) {
      try {
        await prisma.meeting.update({
          where: { id: meetingId },
          data: { sentimentData: sentimentData as any },
        })
      } catch (dbError) {
        console.warn("⚠️ Failed to save sentiment data:", dbError)
      }
    }

    return sentimentData
  } catch (error) {
    console.error("❌ Sentiment Arc Failed:", error)
    return null
  }
}

function createSentimentWindows(
  transcript: unknown[],
  duration: number,
  windowSize: number
): Array<{ timestamp: number; text: string }> {
  const windows: Array<{ timestamp: number; text: string }> = []

  for (let t = 0; t < duration; t += windowSize) {
    const windowEnd = t + windowSize
    const segmentsInWindow = transcript.filter((item) => {
      const itemObj = item as Record<string, unknown>
      let segmentStart = 0
      if (Array.isArray(itemObj.words) && itemObj.words.length > 0) {
        const firstWord = itemObj.words[0] as Record<string, unknown>
        segmentStart = (firstWord?.start as number) ?? 0
      } else if (typeof itemObj.offset === "number") {
        segmentStart = itemObj.offset
      } else if (typeof itemObj.start_time === "number") {
        segmentStart = itemObj.start_time
      }
      return segmentStart >= t && segmentStart < windowEnd
    })

    if (segmentsInWindow.length === 0) continue

    const textPayload = segmentsInWindow
      .map((s) => {
        const seg = s as Record<string, unknown>
        const text =
          Array.isArray(seg.words) && seg.words.length > 0
            ? (seg.words as unknown[]).map((w) => String((w as Record<string, unknown>).word ?? "")).join(" ")
            : String(seg.text ?? "")
        return text ? `${String(seg.speaker)}: ${text}` : `${String(seg.speaker)}: [speaking]`
      })
      .join("\n")

    windows.push({ timestamp: t, text: textPayload })
  }

  return windows
}

async function processSentimentBatches(
  windows: Array<{ timestamp: number; text: string }>,
  batchSize: number
): Promise<SentimentDataPoint[]> {
  const sentimentData: SentimentDataPoint[] = []

  for (let i = 0; i < windows.length; i += batchSize) {
    const batch = windows.slice(i, i + batchSize)
    try {
      const response = await groq.chat.completions.create({
        model: MODEL,
        temperature: CONFIG.TEMPERATURE.SENTIMENT,
        max_tokens: 600,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Analyze sentiment per speaker per timestamp.
Scores: -1.0 = Negative, 0.0 = Neutral, 1.0 = Positive
Return JSON keyed by timestamp: { "60": { "Alice": -0.8, "Bob": 0.5 } }`,
          },
          { role: "user", content: JSON.stringify(batch) },
        ],
      })

      const batchResults = parseGroqJSON<Record<string, Record<string, number>>>(
        response.choices[0]?.message?.content
      )

      batch.forEach((window) => {
        const scores = batchResults[window.timestamp] ?? {}
        sentimentData.push({ timestamp: window.timestamp, ...scores })
      })
    } catch (err) {
      console.error(`⚠️ Sentiment batch failed:`, err)
    }
  }

  return sentimentData
}

// ============================================================================
// LAYER 5: SPEAKER PROFILES
// ============================================================================

export async function generateSpeakerProfiles(
  transcript: unknown,
  meetingId: string
): Promise<SpeakerProfiles | null> {
  try {
    const transcriptText = normalizeTranscript(transcript)
    const validation = validateTranscriptContent(transcriptText)
    if (!validation.valid) {
      console.warn("⚠️ Speaker profiles skipped:", validation.error)
      return null
    }

    const truncated = truncateTranscript(transcriptText, CONFIG.TRANSCRIPT_MAX_LENGTH)

    const response = await groq.chat.completions.create({
      model: MODEL,
      temperature: CONFIG.TEMPERATURE.PROFILES,
      max_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Generate behavioral profiles for each speaker.
Return JSON: { "Alice": { "role": "Leader", "sentiment": "Positive", "trait": "Visionary", "feedback": "One sentence." } }
sentiment must be exactly: "Positive" | "Neutral" | "Negative"`,
        },
        { role: "user", content: truncated },
      ],
    })

    const profiles = parseGroqJSON<SpeakerProfiles>(response.choices[0]?.message?.content)

    let validCount = 0
    for (const [speaker, profile] of Object.entries(profiles)) {
      if (profile.role && profile.sentiment && profile.trait && profile.feedback) {
        validCount++
      } else {
        console.warn(`⚠️ Incomplete profile for: ${speaker}`)
      }
    }

    if (validCount === 0) throw new Error("NO_VALID_SPEAKER_PROFILES")

    try {
      await prisma.meeting.update({
        where: { id: meetingId },
        data: { speakerProfiles: profiles as any },
      })
    } catch (dbError) {
      console.warn("⚠️ Failed to save profiles:", dbError)
    }

    return profiles
  } catch (error) {
    console.error("❌ Speaker Profiles Failed:", error)
    return null
  }
}
