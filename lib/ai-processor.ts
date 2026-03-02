/**
 * ENHANCED AI PROCESSOR FOR MEETING TRANSCRIPT ANALYSIS
 * 
 * This module implements 5 analysis layers with production-grade error handling,
 * type safety, and performance optimization.
 */

import OpenAI from "openai";
import { prisma } from "@/lib/db";

// ============================================================================
// TYPE IMPORTS - PROPERLY IMPORTED
// ============================================================================

type ExecutiveSummary = {
  context: string;
  decisions: string;
  outlook: string;
};

type ActionItem = {
  id: number;
  text: string;
};

type ProcessedMeetingTranscript = {
  summary: string;
  actionItems: ActionItem[];
};

type RiskAnalysisResult = {
  html: string;
  criticalRisks: string[];
  blindSpots: string[];
  confidenceScore: number;
};

type SentimentDataPoint = {
  timestamp: number;
  [speakerName: string]: number | undefined;
};

type SpeakerProfile = {
  role: string;
  sentiment: "Positive" | "Neutral" | "Negative";
  trait: string;
  feedback: string;
};

type SpeakerProfiles = {
  [speakerName: string]: SpeakerProfile;
};

// ============================================================================
// INITIALIZATION & CONFIGURATION
// ============================================================================

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000,
  maxRetries: 3,
});

const CONFIG = {
  MODEL: "gpt-4o-mini" as const,
  SENTIMENT_BATCH_SIZE: 5,
  SENTIMENT_WINDOW_SIZE: 30, // seconds
  TRANSCRIPT_MAX_LENGTH: 20000,
  SENTIMENT_MAX_LENGTH: 15000,
  TEMPERATURE: {
    SUMMARY: 0.3,
    RISK: 0.7,
    SENTIMENT: 0.2,
    PROFILES: 0.5,
  } as const,
} as const;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Safely normalizes any transcript input format to a standard string
 */
function normalizeTranscript(transcript: unknown): string {
  if (typeof transcript === "string") {
    return transcript.trim();
  }

  if (Array.isArray(transcript)) {
    return transcript
      .map((item: unknown) => {
        const itemObj = item as Record<string, unknown>;
        const text =
          Array.isArray(itemObj.words) && itemObj.words.length > 0
            ? (itemObj.words as unknown[])
                .map((w: unknown) => {
                  const word = w as Record<string, unknown>;
                  return String(word.word ?? "");
                })
                .join(" ")
            : String(itemObj.text ?? "[speaking]");
        return `${String(itemObj.speaker ?? "Speaker")}: ${text}`;
      })
      .join("\n");
  }

  if (
    transcript &&
    typeof transcript === "object" &&
    "text" in transcript
  ) {
    return String((transcript as Record<string, unknown>).text).trim();
  }

  throw new Error("INVALID_TRANSCRIPT_FORMAT");
}

/**
 * Validates transcript content quality and length
 */
function validateTranscriptContent(text: string): {
  valid: boolean;
  error?: string;
} {
  if (!text || text.length === 0) {
    return { valid: false, error: "EMPTY_TRANSCRIPT" };
  }

  if (text.length > CONFIG.TRANSCRIPT_MAX_LENGTH) {
    return {
      valid: false,
      error: `TRANSCRIPT_TOO_LONG: ${text.length}/${CONFIG.TRANSCRIPT_MAX_LENGTH}`,
    };
  }

  // Check for meaningful content (not just whitespace/special chars)
  const meaningfulChars = text.replace(/[^a-zA-Z0-9\s]/g, "").trim();
  if (meaningfulChars.length < 20) {
    return { valid: false, error: "INSUFFICIENT_CONTENT" };
  }

  return { valid: true };
}

/**
 * Intelligently truncates transcript at speaker boundaries
 */
function truncateTranscript(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  const truncated = text.substring(0, maxLength);
  const lastNewline = truncated.lastIndexOf("\n");

  if (lastNewline > maxLength * 0.8) {
    return truncated.substring(0, lastNewline);
  }

  return truncated;
}

/**
 * Parses OpenAI JSON response with error handling
 */
function parseOpenAIResponse<T extends Record<string, unknown>>(
  content: string | null,
  expectedFields?: (keyof T)[]
): T {
  if (!content) {
    throw new Error("EMPTY_RESPONSE");
  }

  let parsed: T;
  try {
    parsed = JSON.parse(content) as T;
  } catch (error) {
    throw new Error(
      `JSON_PARSE_ERROR: ${error instanceof Error ? error.message : "Unknown"}`
    );
  }

  // Validate expected fields exist
  if (expectedFields) {
    const missing = expectedFields.filter((field) => !(field in parsed));
    if (missing.length > 0) {
      throw new Error(`MISSING_FIELDS: ${missing.join(", ")}`);
    }
  }

  return parsed;
}

/**
 * Calculates meeting duration from transcript array
 */
function estimateMeetingDuration(transcript: unknown[]): number {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return 0;
  }

  let maxDuration = 0;

  for (const segment of transcript) {
    const seg = segment as Record<string, unknown>;
    let segmentEnd = 0;

    // Strategy 1: Use last word's end time
    if (Array.isArray(seg.words) && seg.words.length > 0) {
      const lastWord = seg.words[seg.words.length - 1] as Record<
        string,
        unknown
      >;
      segmentEnd = (lastWord?.end as number) ?? 0;
    }
    // Strategy 2: Use segment-level end_time
    else if (typeof seg.end_time === "number") {
      segmentEnd = seg.end_time;
    }
    // Strategy 3: Use segment end property
    else if (typeof seg.end === "number") {
      segmentEnd = seg.end;
    }

    maxDuration = Math.max(maxDuration, segmentEnd);
  }

  return maxDuration;
}

// ============================================================================
// LAYER 1: EXECUTIVE SUMMARY
// ============================================================================

export async function generateExecutiveSummary(
  transcript: unknown
): Promise<ExecutiveSummary> {
  try {
    const transcriptText = normalizeTranscript(transcript);
    const validation = validateTranscriptContent(transcriptText);

    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const truncated = truncateTranscript(
      transcriptText,
      CONFIG.TRANSCRIPT_MAX_LENGTH
    );

    const completion = await openai.chat.completions.create({
      model: CONFIG.MODEL,
      temperature: CONFIG.TEMPERATURE.SUMMARY,
      max_tokens: 500,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a business analyst specializing in meeting summarization.
Extract exactly 3 components from the meeting transcript:

1. **context**: 1-2 sentences about the meeting topic, attendees, and purpose
2. **decisions**: 2-3 sentences of KEY decisions made during the meeting
3. **outlook**: 1-2 sentences about next steps, timeline, and implications

Return ONLY valid JSON with these exact fields:
{
  "context": "...",
  "decisions": "...",
  "outlook": "..."
}`,
        },
        {
          role: "user",
          content: truncated,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    const parsed = parseOpenAIResponse<ExecutiveSummary>(content, [
      "context",
      "decisions",
      "outlook",
    ]);

    return parsed;
  } catch (error) {
    console.error("❌ Executive Summary Failed:", error);
    throw error;
  }
}

// ============================================================================
// LAYER 2: PROCESS MEETING TRANSCRIPT
// ============================================================================

export async function processMeetingTranscript(
  transcript: unknown
): Promise<ProcessedMeetingTranscript> {
  try {
    const transcriptText = normalizeTranscript(transcript);
    const validation = validateTranscriptContent(transcriptText);

    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const truncated = truncateTranscript(
      transcriptText,
      CONFIG.TRANSCRIPT_MAX_LENGTH
    );

    const completion = await openai.chat.completions.create({
      model: CONFIG.MODEL,
      temperature: CONFIG.TEMPERATURE.SUMMARY,
      max_tokens: 800,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an AI assistant that analyzes meeting transcripts.

Extract:
1. **summary**: A 2-3 sentence summary of key discussion points and decisions
2. **actionItems**: A list of 3-10 specific, actionable tasks with clear ownership

Return ONLY JSON:
{
  "summary": "...",
  "actionItems": ["Task 1 - Owner", "Task 2 - Owner"]
}`,
        },
        {
          role: "user",
          content: `Meeting Transcript:\n\n${truncated}`,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    const parsed = parseOpenAIResponse<{
      summary: string;
      actionItems: string[];
    }>(content, ["summary", "actionItems"]);

    // Validate action items are array of strings
    if (!Array.isArray(parsed.actionItems)) {
      throw new Error("ACTION_ITEMS_NOT_ARRAY");
    }

    const actionItems: ActionItem[] = parsed.actionItems
      .filter((item): item is string => typeof item === "string")
      .map((text, index) => ({
        id: index + 1,
        text,
      }));

    return {
      summary: parsed.summary,
      actionItems,
    };
  } catch (error) {
    console.error("❌ Meeting Transcript Processing Failed:", error);
    throw error;
  }
}

// ============================================================================
// LAYER 3: RISK ANALYSIS (DEVIL'S ADVOCATE)
// ============================================================================

export async function generateRiskAnalysis(
  transcript: unknown,
  meetingId: string
): Promise<RiskAnalysisResult | null> {
  try {
    if (!transcript) {
      console.warn("⚠️ Risk analysis skipped: No transcript provided");
      return null;
    }

    const transcriptText = normalizeTranscript(transcript);
    const truncated = truncateTranscript(
      transcriptText,
      CONFIG.SENTIMENT_MAX_LENGTH
    );

    const completion = await openai.chat.completions.create({
      model: CONFIG.MODEL,
      temperature: CONFIG.TEMPERATURE.RISK,
      max_tokens: 1200,
      messages: [
        {
          role: "system",
          content: `You are "The Devil's Advocate", a ruthless Senior Risk Analyst.
Your job is to identify flaws, missed details, and potential disasters.

Identify:
1. 🛑 CRITICAL RISKS (3-5 items)
2. 🙈 BLIND SPOTS (2-4 items)
3. 📊 CONFIDENCE SCORE (0-100%)

Return ONLY valid HTML.`,
        },
        {
          role: "user",
          content: truncated,
        },
      ],
    });

    const html = completion.choices[0]?.message?.content || "";

    if (!html || html.length === 0) {
      throw new Error("EMPTY_RISK_ANALYSIS");
    }

    // Save to database with error handling
    try {
      await prisma.meeting.update({
        where: { id: meetingId },
        data: { riskAnalysis: html },
      });
    } catch (dbError) {
      console.warn("⚠️ Failed to save risk analysis:", dbError);
    }

    // Extract structured data
    const criticalRisks = extractListItems(html, "Critical Risks");
    const blindSpots = extractListItems(html, "Blind Spots");
    const confidenceScore = extractConfidenceScore(html);

    return {
      html,
      criticalRisks,
      blindSpots,
      confidenceScore,
    };
  } catch (error) {
    console.error("❌ Risk Analysis Failed:", error);
    return null;
  }
}

/**
 * Extracts list items from HTML
 */
function extractListItems(html: string, sectionName: string): string[] {
  try {
    const regex = new RegExp(
      `${sectionName}[\\s\\S]*?<ul>([\\s\\S]*?)</ul>`,
      "i"
    );
    const match = html.match(regex);

    if (!match) return [];

    const items: string[] = [];
    const liRegex = /<li>([^<]+)<\/li>/g;
    let liMatch;

    while ((liMatch = liRegex.exec(match[1])) !== null) {
      const item = liMatch[1].trim();
      if (item) items.push(item);
    }

    return items;
  } catch (error) {
    console.warn("Failed to extract list items:", error);
    return [];
  }
}

/**
 * Extracts confidence score from HTML
 */
function extractConfidenceScore(html: string): number {
  try {
    const scoreRegex = /Confidence Score[:\s]+<span[^>]*>(\d+)%?<\/span>/i;
    const match = html.match(scoreRegex);

    if (match && match[1]) {
      const score = parseInt(match[1], 10);
      return Math.min(Math.max(score, 0), 100);
    }

    return 50;
  } catch (error) {
    console.warn("Failed to extract confidence score:", error);
    return 50;
  }
}

// ============================================================================
// LAYER 4: EMOTIONAL ARC (MULTI-SPEAKER SENTIMENT ANALYSIS)
// ============================================================================

export async function generateSentimentArc(
  transcript: unknown,
  meetingId: string
): Promise<SentimentDataPoint[] | null> {
  try {
    if (!transcript) {
      console.warn("⚠️ Sentiment analysis skipped: No transcript provided");
      return null;
    }

    if (!Array.isArray(transcript)) {
      console.warn("⚠️ Sentiment analysis requires array format");
      return null;
    }

    const duration = estimateMeetingDuration(transcript);
    if (duration === 0) {
      console.warn("⚠️ Could not determine meeting duration");
      return null;
    }

    console.log(`📊 Analyzing sentiment: ${duration}s duration`);

    const windows = createSentimentWindows(
      transcript,
      duration,
      CONFIG.SENTIMENT_WINDOW_SIZE
    );

    if (windows.length === 0) {
      console.warn("⚠️ No speech segments found");
      return null;
    }

    console.log(`📊 Created ${windows.length} sentiment windows`);

    const sentimentData = await processSentimentBatches(
      windows,
      CONFIG.SENTIMENT_BATCH_SIZE
    );

    if (sentimentData.length > 0) {
      try {
        await prisma.meeting.update({
          where: { id: meetingId },
          data: { sentimentData: sentimentData as any },
        });
      } catch (dbError) {
        console.warn("⚠️ Failed to save sentiment data:", dbError);
      }
    }

    return sentimentData;
  } catch (error) {
    console.error("❌ Sentiment Arc Failed:", error);
    return null;
  }
}

/**
 * Creates time-windowed segments
 */
function createSentimentWindows(
  transcript: unknown[],
  duration: number,
  windowSize: number
): Array<{ timestamp: number; text: string }> {
  const windows: Array<{ timestamp: number; text: string }> = [];

  for (let t = 0; t < duration; t += windowSize) {
    const windowEnd = t + windowSize;

    const segmentsInWindow = transcript.filter((item) => {
      const itemObj = item as Record<string, unknown>;
      let segmentStart = 0;

      if (Array.isArray(itemObj.words) && itemObj.words.length > 0) {
        const firstWord = itemObj.words[0] as Record<string, unknown>;
        segmentStart = (firstWord?.start as number) ?? 0;
      } else if (typeof itemObj.offset === "number") {
        segmentStart = itemObj.offset;
      } else if (typeof itemObj.start_time === "number") {
        segmentStart = itemObj.start_time;
      }

      return segmentStart >= t && segmentStart < windowEnd;
    });

    if (segmentsInWindow.length === 0) continue;

    const textPayload = segmentsInWindow
      .map((s) => {
        const seg = s as Record<string, unknown>;
        const text =
          Array.isArray(seg.words) && seg.words.length > 0
            ? (seg.words as unknown[])
                .map((w: unknown) => {
                  const word = w as Record<string, unknown>;
                  return String(word.word ?? "");
                })
                .join(" ")
            : String(seg.text ?? "");
        return text
          ? `${String(seg.speaker)}: ${text}`
          : `${String(seg.speaker)}: [speaking]`;
      })
      .join("\n");

    windows.push({ timestamp: t, text: textPayload });
  }

  return windows;
}

/**
 * Processes sentiment windows in batches
 */
async function processSentimentBatches(
  windows: Array<{ timestamp: number; text: string }>,
  batchSize: number
): Promise<SentimentDataPoint[]> {
  const sentimentData: SentimentDataPoint[] = [];

  for (let i = 0; i < windows.length; i += batchSize) {
    const batch = windows.slice(i, i + batchSize);

    try {
      const completion = await openai.chat.completions.create({
        model: CONFIG.MODEL,
        temperature: CONFIG.TEMPERATURE.SENTIMENT,
        max_tokens: 600,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `Analyze sentiment for each speaker:
- -1.0 = Negative/Angry
- 0.0 = Neutral
- 1.0 = Positive/Happy

Return JSON keyed by timestamp: { "60": { "Alice": -0.8, "Bob": 0.5 } }`,
          },
          {
            role: "user",
            content: JSON.stringify(batch),
          },
        ],
      });

      const batchResults = parseOpenAIResponse<
        Record<string, Record<string, number>>
      >(completion.choices[0]?.message?.content);

      batch.forEach((window) => {
        const scores = batchResults[window.timestamp] ?? {};
        sentimentData.push({
          timestamp: window.timestamp,
          ...scores,
        });
      });

      console.log(
        `✅ Processed batch ${Math.ceil(i / batchSize)}/${Math.ceil(windows.length / batchSize)}`
      );
    } catch (err) {
      console.error(`⚠️ Batch failed:`, err);
    }
  }

  return sentimentData;
}

// ============================================================================
// LAYER 5: SPEAKER PROFILES (BEHAVIORAL PROFILING)
// ============================================================================

export async function generateSpeakerProfiles(
  transcript: unknown,
  meetingId: string
): Promise<SpeakerProfiles | null> {
  try {
    const transcriptText = normalizeTranscript(transcript);
    const validation = validateTranscriptContent(transcriptText);

    if (!validation.valid) {
      console.warn("⚠️ Speaker profiles skipped:", validation.error);
      return null;
    }

    const truncated = truncateTranscript(
      transcriptText,
      CONFIG.TRANSCRIPT_MAX_LENGTH
    );

    const completion = await openai.chat.completions.create({
      model: CONFIG.MODEL,
      temperature: CONFIG.TEMPERATURE.PROFILES,
      max_tokens: 1200,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Analyze meeting transcript and generate behavioral profiles.

For each speaker, determine:
1. **role**: Leader, Critic, Supporter, etc.
2. **sentiment**: "Positive" | "Neutral" | "Negative"
3. **trait**: One adjective (Assertive, Collaborative, etc.)
4. **feedback**: One sentence of feedback

Return JSON: { "Alice": { "role": "Leader", "sentiment": "Positive", "trait": "Visionary", "feedback": "..." } }`,
        },
        {
          role: "user",
          content: truncated,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    const profiles = parseOpenAIResponse<SpeakerProfiles>(content);

    // Validate
    let validCount = 0;
    for (const [speaker, profile] of Object.entries(profiles)) {
      if (profile.role && profile.sentiment && profile.trait && profile.feedback) {
        validCount++;
      } else {
        console.warn(`⚠️ Incomplete profile for: ${speaker}`);
      }
    }

    if (validCount === 0) {
      throw new Error("NO_VALID_SPEAKER_PROFILES");
    }

    // Save
    try {
      await prisma.meeting.update({
        where: { id: meetingId },
        data: { speakerProfiles: profiles as any },
      });
    } catch (dbError) {
      console.warn("⚠️ Failed to save profiles:", dbError);
    }

    return profiles;
  } catch (error) {
    console.error("❌ Speaker Profiles Failed:", error);
    return null;
  }
}