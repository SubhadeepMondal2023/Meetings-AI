import OpenAI from "openai";
import { prisma } from "@/lib/db";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// ---------------------------------------------------------
// ✅ PROCESS MEETING TRANSCRIPT → Summary + Action Items
// ---------------------------------------------------------
export async function processMeetingTranscript(transcript: any) {
  try {
    let transcriptText = "";

    // Normalize transcript format
    if (Array.isArray(transcript)) {
      transcriptText = transcript
        .map(
          (item: any) =>
            `${item.speaker || "Speaker"}: ${item.words
              .map((w: any) => w.word)
              .join(" ")}`
        )
        .join("\n");
    } else if (typeof transcript === "string") {
      transcriptText = transcript;
    } else if (transcript.text) {
      transcriptText = transcript.text;
    }

    if (!transcriptText.trim().length) {
      throw new Error("No transcript content found");
    }

    // Call OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an AI assistant that analyzes meeting transcripts and provides concise summaries and action items.

          Provide:
          1. A 2–3 sentence summary of key discussion points & decisions.
          2. A list of action items.

          Return ONLY JSON:
          {
              "summary": "...",
              "actionItems": ["...", "..."]
          }`,
        },
        {
          role: "user",
          content: `Analyze this meeting:\n\n${transcriptText}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 1000,
      response_format: { type: "json_object" }, // Enforce JSON
    });

    const response = completion.choices[0].message?.content;
    if (!response) throw new Error("Empty response from OpenAI");

    const parsed = JSON.parse(response);

    const actionItems = Array.isArray(parsed.actionItems)
      ? parsed.actionItems.map((text: string, index: number) => ({
          id: index + 1,
          text,
        }))
      : [];

    return {
      summary: parsed.summary || "Summary could not be generated",
      actionItems,
    };
  } catch (error) {
    console.error("Error processing transcript:", error);
    return {
      summary:
        "Meeting transcript processed successfully. Please check the full transcript for details.",
      actionItems: [],
    };
  }
}

// ---------------------------------------------------------
// ✅ DEVIL'S ADVOCATE — RISK ANALYSIS (HTML OUTPUT)
// ---------------------------------------------------------
export async function generateRiskAnalysis(
  transcript: any,
  meetingId: string
) {
  try {
    let transcriptText = "";

    // Normalize transcript format
    if (Array.isArray(transcript)) {
      transcriptText = transcript
        .map(
          (item: any) =>
            `${item.speaker || "Speaker"}: ${item.words
              .map((w: any) => w.word)
              .join(" ")}`
        )
        .join("\n");
    } else if (typeof transcript === "string") {
      transcriptText = transcript;
    } else if (transcript.text) {
      transcriptText = transcript.text;
    }

    // Limit transcript length for cost safety
    const truncatedTranscript = transcriptText.substring(0, 15000);

    // OpenAI Call
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content: `You are "The Devil's Advocate", a ruthless Senior Risk Analyst.
          Do NOT summarize. Do NOT be polite. Your job is to find flaws.

          Identify:
          1. 🛑 Critical Risks
          2. 🙈 Blind Spots
          3. 📉 Confidence Score (0–100%)

          Return ONLY valid HTML using:
          <div>, <h3>, <ul>, <li>, <strong>, <p>, <span class="text-red-500">`,
        },
        { role: "user", content: truncatedTranscript },
      ],
    });

    const analysis =
      completion.choices[0].message?.content || "Risk analysis failed.";

    // Save to database
    await prisma.meeting.update({
      where: { id: meetingId },
      data: { riskAnalysis: analysis },
    });

    return analysis;
  } catch (error) {
    console.error("Error generating risk analysis:", error);
    return null;
  }
}

// ---------------------------------------------------------
// 📈 UPGRADE: MULTI-SPEAKER SENTIMENT ANALYSIS
// ---------------------------------------------------------
export async function generateSentimentArc(transcript: any, meetingId: string) {
  try {
    if (!Array.isArray(transcript)) return null;

    // 1. Determine Meeting Duration & Window Size
    // We'll analyze in 30-second chunks for high resolution
    const lastSegment = transcript[transcript.length - 1];
    const duration = lastSegment?.words
      ? lastSegment.words[lastSegment.words.length - 1].end_time
      : 0;
    const windowSize = 30;
    const windows = [];

    // 2. Slice Transcript into Time Windows
    for (let t = 0; t < duration; t += windowSize) {
      const windowEnd = t + windowSize;

      // Get all words spoken in this timeframe
      const segmentsInWindow = transcript.filter((item: any) => {
        const start = item.words[0]?.start_time || 0;
        return start >= t && start < windowEnd;
      });

      // If silence, skip or push empty
      if (segmentsInWindow.length === 0) continue;

      // Format: "SpeakerName: Text..."
      const textPayload = segmentsInWindow
        .map(
          (s: any) =>
            `${s.speaker}: ${s.words.map((w: any) => w.word).join(" ")}`
        )
        .join("\n");

      windows.push({ timestamp: t, text: textPayload });
    }

    // 3. Batch Process with OpenAI (5 windows at a time to save API calls)
    const sentimentData: any[] = [];
    const batchSize = 5;

    for (let i = 0; i < windows.length; i += batchSize) {
      const batch = windows.slice(i, i + batchSize);

      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini", // Fast & Cheap
          messages: [
            {
              role: "system",
              content: `You are an emotional intelligence AI. Analyze the dialogue segment.
              For EACH speaker, determine their sentiment score (-1.0 = Negative/Angry, 0.0 = Neutral, 1.0 = Positive/Happy).
              
              Return ONLY a JSON Object keyed by timestamp.
              Example Input: 
              [{ "timestamp": 60, "text": "Tarif: This code is broken! \n Subhadeep: I can fix it." }]
              
              Example Output:
              {
                "60": { "Tarif": -0.8, "Subhadeep": 0.4 }
              }`,
            },
            { role: "user", content: JSON.stringify(batch) },
          ],
          response_format: { type: "json_object" },
        });

        const batchResults = JSON.parse(
          completion.choices[0].message.content || "{}"
        );

        // Merge results back into our timeline
        batch.forEach((window) => {
          const scores = batchResults[window.timestamp] || {};
          // Format for Recharts: { timestamp: 60, Tarif: -0.8, Subhadeep: 0.4 }
          sentimentData.push({
            timestamp: window.timestamp,
            ...scores,
          });
        });
      } catch (err) {
        console.error("Batch sentiment failed", err);
      }
    }

    // 4. Save to Database
    if (sentimentData.length > 0) {
      await prisma.meeting.update({
        where: { id: meetingId },
        data: { sentimentData },
      });
    }

    return sentimentData;
  } catch (error) {
    console.error("Sentiment Arc Error:", error);
    return null;
  }
}

// ---------------------------------------------------------
// 🧠 BEHAVIORAL PROFILING AGENT (Psychometric Analysis)
// ---------------------------------------------------------
export async function generateSpeakerProfiles(
  transcript: any,
  meetingId: string
) {
  try {
    let transcriptText = "";

    if (Array.isArray(transcript)) {
      transcriptText = transcript
        .map(
          (item: any) =>
            `${item.speaker || "Speaker"}: ${item.words
              .map((w: any) => w.word)
              .join(" ")}`
        )
        .join("\n");
    } else if (typeof transcript === "string") {
      transcriptText = transcript;
    }

    const truncatedTranscript = transcriptText.substring(0, 20000);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are an expert Organizational Psychologist. 
                    Analyze the meeting transcript and generate a behavioral profile for every unique speaker.

                    For each speaker, determine:
                    1. **Role**: What role did they play? (e.g., Leader, Critic, Mediator)
                    2. **Sentiment**: Overall emotional tone (Positive, Neutral, Negative).
                    3. **Key Trait**: One specific adjective describing their style.
                    4. **Feedback**: One sentence of feedback.

                    Return a JSON Object where keys are speaker names.
                    Example:
                    {
                        "Tarif": { "role": "Leader", "sentiment": "Positive", "trait": "Visionary", "feedback": "Good energy." }
                    }`,
        },
        {
          role: "user",
          content: truncatedTranscript,
        },
      ],
      temperature: 0.5,
      response_format: { type: "json_object" },
    });

    const profiles = JSON.parse(completion.choices[0].message.content || "{}");

    await prisma.meeting.update({
      where: { id: meetingId },
      data: { speakerProfiles: profiles },
    });

    return profiles;
  } catch (error) {
    console.error("Error generating speaker profiles:", error);
    return null;
  }
}