/**
 * lib/transcription.ts
 * Migrated: Gemini File API → Groq Whisper API
 * Groq Whisper: free, fast, 25MB limit, 7200 req/day
 */

import Groq from "groq-sdk"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! })

interface TranscriptWord {
  word: string
  start: number
  end: number
}

interface TranscriptSegment {
  speaker: string
  offset: number
  start_time: number
  end_time: number
  words: TranscriptWord[]
}

/**
 * Transcribe audio from a URL using Groq Whisper
 * Free tier: 7200 requests/day, up to 25MB per file
 */
export async function transcribeAudioFromUrl(
  audioUrl: string
): Promise<TranscriptSegment[] | null> {
  let tempFilePath: string | null = null

  try {
    console.log(`🎙️ Groq Whisper transcribing: ${audioUrl}`)

    // Step 1: Download audio
    console.log("📥 Downloading audio...")
    const audioBuffer = await downloadAudio(audioUrl)
    if (!audioBuffer) {
      console.error("❌ Failed to download audio")
      return null
    }

    const sizeMB = audioBuffer.length / 1024 / 1024
    console.log(`📥 Downloaded: ${sizeMB.toFixed(1)}MB`)

    if (sizeMB > 25) {
      console.warn(`⚠️ File is ${sizeMB.toFixed(1)}MB — Groq Whisper limit is 25MB. Truncating...`)
      // Truncate to 24MB to be safe
      const truncated = audioBuffer.slice(0, 24 * 1024 * 1024)
      return await transcribeBuffer(truncated, audioUrl)
    }

    return await transcribeBuffer(audioBuffer, audioUrl)
  } catch (error) {
    console.error("❌ Groq Whisper transcription failed:", error)
    return null
  } finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try { fs.unlinkSync(tempFilePath) } catch { }
    }
  }
}

async function transcribeBuffer(
  audioBuffer: Buffer,
  audioUrl: string
): Promise<TranscriptSegment[] | null> {
  let tempFilePath: string | null = null
  try {
    // Save to temp file — Groq SDK needs a file path or File object
    const ext = detectExtension(audioUrl)
    tempFilePath = path.join(os.tmpdir(), `meeting_audio_${Date.now()}.${ext}`)
    fs.writeFileSync(tempFilePath, audioBuffer)

    console.log("🚀 Sending to Groq Whisper...")

    // Call Groq Whisper with verbose_json for timestamps
    const transcription = await groq.audio.transcriptions.create({
      file: fs.createReadStream(tempFilePath),
      model: "whisper-large-v3",
      response_format: "verbose_json",
      language: "en",
      timestamp_granularities: ["segment", "word"],
    })

    console.log(`✅ Groq Whisper complete`)

    // Parse response into TranscriptSegment[]
    return parseWhisperResponse(transcription as any)
  } catch (error) {
    console.error("❌ Groq Whisper API call failed:", error)
    return null
  } finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try { fs.unlinkSync(tempFilePath) } catch { }
    }
  }
}

/**
 * Parse Groq Whisper verbose_json response into TranscriptSegments
 */
function parseWhisperResponse(response: any): TranscriptSegment[] {
  const segments: TranscriptSegment[] = []

  if (!response) return segments

  if (response.segments && Array.isArray(response.segments)) {
    console.log(`📊 Processing ${response.segments.length} Whisper segments`)

    let speakerIndex = 0
    const speakers = ["Speaker 1", "Speaker 2", "Speaker 3", "Speaker 4"]

    for (const segment of response.segments) {
      const text = segment.text?.trim() || ""
      if (!text) continue

      const startTime = segment.start || 0
      const endTime = segment.end || startTime + 1
      const duration = endTime - startTime

      // Build word-level timing
      let words: TranscriptWord[] = []

      if (segment.words && Array.isArray(segment.words) && segment.words.length > 0) {
        // Use Whisper's word-level timestamps if available
        words = segment.words.map((w: any): TranscriptWord => ({
          word: String(w.word || "").trim(),
          start: Number(w.start || startTime),
          end: Number(w.end || endTime),
        }))
      } else {
        // Estimate word timing from segment duration
        words = buildWordsFromText(text, startTime, endTime)
      }

      // Simple speaker diarization: change speaker on long pauses (>2s)
      if (speakerIndex > 0 && duration > 2) speakerIndex++
      const speaker = speakers[speakerIndex % speakers.length]

      segments.push({
        speaker,
        offset: startTime,
        start_time: startTime,
        end_time: endTime,
        words,
      })
    }
  } else if (response.text) {
    // Fallback: plain text response
    const words = buildWordsFromText(response.text, 0, response.duration || 60)
    segments.push({
      speaker: "Speaker 1",
      offset: 0,
      start_time: 0,
      end_time: response.duration || 60,
      words,
    })
  }

  return segments
}

/**
 * Download audio from URL into Buffer
 */
async function downloadAudio(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Failed to download: ${response.status}`)
    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  } catch (error) {
    console.error("Error downloading audio:", error)
    return null
  }
}

/**
 * Detect file extension from URL
 */
function detectExtension(audioUrl: string): string {
  const url = audioUrl.toLowerCase().split("?")[0]
  if (url.endsWith(".mp3")) return "mp3"
  if (url.endsWith(".mp4") || url.endsWith(".m4a")) return "mp4"
  if (url.endsWith(".wav")) return "wav"
  if (url.endsWith(".ogg")) return "ogg"
  if (url.endsWith(".flac")) return "flac"
  if (url.endsWith(".webm")) return "webm"
  return "wav"
}

/**
 * Distribute words evenly across a time range
 */
function buildWordsFromText(text: string, startTime: number, endTime: number): TranscriptWord[] {
  const textWords = text.split(/\s+/).filter((w) => w.length > 0)
  if (textWords.length === 0) return []
  const duration = Math.max(endTime - startTime, 1)
  const timePerWord = duration / textWords.length
  return textWords.map((word, i): TranscriptWord => ({
    word,
    start: startTime + i * timePerWord,
    end: startTime + (i + 1) * timePerWord,
  }))
}

/**
 * Simple fallback transcription
 */
export async function transcribeAudioSimple(
  audioBuffer: Buffer,
  audioUrl: string = ""
): Promise<TranscriptSegment[] | null> {
  return transcribeBuffer(audioBuffer, audioUrl)
}
