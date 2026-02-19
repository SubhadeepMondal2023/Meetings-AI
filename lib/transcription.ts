import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

interface TranscriptSegment {
  speaker: string;
  offset: number;
  start_time: number;
  end_time: number;
  words: TranscriptWord[];
}

/**
 * Transcribe audio from a URL using OpenAI's Whisper API
 * Returns transcript with timestamps and speaker information
 */
export async function transcribeAudioFromUrl(
  audioUrl: string
): Promise<TranscriptSegment[] | null> {
  try {
    console.log(`🎙️ Starting transcription for: ${audioUrl}`);

    // Download audio from URL
    const audioBuffer = await downloadAudio(audioUrl);
    if (!audioBuffer) {
      console.error("❌ Failed to download audio");
      return null;
    }

    console.log(`📥 Downloaded audio: ${audioBuffer.length} bytes`);

    // Transcribe using Whisper with timestamps
    const transcript = await transcribeWithWhisper(audioBuffer);

    if (!transcript || transcript.length === 0) {
      console.warn("⚠️ Whisper returned empty transcript");
      return null;
    }

    console.log(`✅ Transcription complete: ${transcript.length} segments`);
    return transcript;
  } catch (error) {
    console.error("❌ Transcription error:", error);
    return null;
  }
}

/**
 * Download audio file from URL
 */
async function downloadAudio(url: string): Promise<Buffer | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error("Error downloading audio:", error);
    return null;
  }
}

/**
 * Compress audio file if it exceeds the OpenAI size limit (25MB)
 */
async function compressAudioIfNeeded(audioBuffer: Buffer): Promise<Buffer> {
  const MAX_SIZE = 25 * 1024 * 1024; // 25MB
  
  if (audioBuffer.length <= MAX_SIZE) {
    console.log(`✅ Audio size OK: ${(audioBuffer.length / 1024 / 1024).toFixed(1)}MB (under 25MB limit)`);
    return audioBuffer;
  }

  console.log(`⚠️ Audio too large: ${(audioBuffer.length / 1024 / 1024).toFixed(1)}MB, compressing...`);
  
  try {
    // Write buffer to temp file
    const tempDir = "/tmp";
    const inputFile = path.join(tempDir, `audio_${Date.now()}.wav`);
    const outputFile = path.join(tempDir, `audio_${Date.now()}_compressed.mp3`);
    
    fs.writeFileSync(inputFile, audioBuffer);
    
    // Use ffmpeg to compress: reduce bitrate to 64kbps (mono) or 96kbps (stereo)
    // This typically reduces file size by 80-90%
    try {
      execSync(`ffmpeg -i "${inputFile}" -q:a 9 "${outputFile}"`, { stdio: 'ignore' });
    } catch {
      // ffmpeg not available - try with -acodec libmp3lame as fallback
      execSync(`ffmpeg -i "${inputFile}" -codec:a libmp3lame -b:a 64k "${outputFile}"`, { stdio: 'ignore' });
    }
    
    const compressedBuffer = fs.readFileSync(outputFile);
    console.log(`✅ Compressed from ${(audioBuffer.length / 1024 / 1024).toFixed(1)}MB to ${(compressedBuffer.length / 1024 / 1024).toFixed(1)}MB`);
    
    // Cleanup temp files
    fs.unlinkSync(inputFile);
    fs.unlinkSync(outputFile);
    
    return compressedBuffer;
  } catch (error) {
    console.error("❌ Compression failed, using original buffer:", error);
    return audioBuffer;
  }
}

/**
 * Transcribe audio using OpenAI's Whisper API with timestamps
 */
async function transcribeWithWhisper(
  audioBuffer: Buffer
): Promise<TranscriptSegment[] | null> {
  try {
    // Compress audio if needed (OpenAI max is 25MB)
    const processedBuffer = await compressAudioIfNeeded(audioBuffer);

    // Create a File object for OpenAI SDK
    // OpenAI's Node.js SDK expects a File object, not Blob
    const file = new File([processedBuffer], "audio.wav", { type: "audio/wav" });

    // Call Whisper API
    const response = await openai.audio.transcriptions.create({
      file: file,
      model: "whisper-1",
      language: "en",
      response_format: "verbose_json",
    });

    console.log("🎯 Whisper response type:", typeof response);

    // Parse response into segments
    return parseWhisperResponse(response as any);
  } catch (error) {
    console.error("Error calling Whisper API:", error);
    // Fallback to simple transcription without timestamps
    const simpleText = await transcribeAudioSimple(audioBuffer);
    if (simpleText) {
      return [
        {
          speaker: "Speaker",
          offset: 0,
          start_time: 0,
          end_time: 1,
          words: simpleText
            .split(/\s+/)
            .map((word, i) => ({
              word,
              start: i * 0.5,
              end: (i + 1) * 0.5,
            })),
        },
      ];
    }
    return null;
  }
}

/**
 * Parse Whisper's verbose_json output into our transcript format
 */
function parseWhisperResponse(response: any): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];

  // Handle both verbose_json and regular response formats
  if (!response) {
    console.warn("Empty Whisper response");
    return [];
  }

  // Check if this is verbose_json format with segments
  if (response.segments && Array.isArray(response.segments)) {
    console.log(`📊 Processing ${response.segments.length} segments from Whisper`);

    let speakerIndex = 0;
    const speakers = ["Speaker 1", "Speaker 2"];

    for (const segment of response.segments) {
      const text = segment.text?.trim() || "";
      if (!text) continue;

      const startTime = segment.start || 0;
      const endTime = segment.end || startTime + 1;

      // Convert text to words with timing
      const words: TranscriptWord[] = [];
      const textWords = text.split(/\s+/);
      const segmentDuration = endTime - startTime;
      const timePerWord = segmentDuration / Math.max(textWords.length, 1);

      let currentTime = startTime;
      for (const word of textWords) {
        if (word.length > 0) {
          words.push({
            word,
            start: currentTime,
            end: currentTime + timePerWord,
          });
          currentTime += timePerWord;
        }
      }

      // Alternate speakers
      const speaker = speakers[speakerIndex % 2];
      if (segmentDuration > 5) speakerIndex++; // Change speaker on longer pauses

      segments.push({
        speaker,
        offset: startTime,
        start_time: startTime,
        end_time: endTime,
        words,
      });
    }
  } else if (typeof response === 'string') {
    // Handle simple text response
    console.log("📝 Processing simple text response from Whisper");
    const words: TranscriptWord[] = [];
    const textWords = (response as string).split(/\s+/);

    textWords.forEach((word, i) => {
      words.push({
        word,
        start: i * 0.5,
        end: (i + 1) * 0.5,
      });
    });

    segments.push({
      speaker: "Speaker",
      offset: 0,
      start_time: 0,
      end_time: textWords.length * 0.5,
      words,
    });
  } else if (response.text) {
    // Handle response with text property
    console.log("📝 Processing response with text property");
    const words: TranscriptWord[] = [];
    const textWords = (response.text as string).split(/\s+/);

    textWords.forEach((word, i) => {
      words.push({
        word,
        start: i * 0.5,
        end: (i + 1) * 0.5,
      });
    });

    segments.push({
      speaker: "Speaker",
      offset: 0,
      start_time: 0,
      end_time: textWords.length * 0.5,
      words,
    });
  }

  return segments;
}

/**
 * Alternative: Use verbose_json format with fallback
 */
export async function transcribeAudioSimple(
  audioBuffer: Buffer
): Promise<string | null> {
  try {
    // Compress audio if needed
    const processedBuffer = await compressAudioIfNeeded(audioBuffer);
    
    const file = new File([processedBuffer], "audio.wav", { type: "audio/wav" });

    const response = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      language: "en",
    });

    return response.text || null;
  } catch (error) {
    console.error("Error transcribing audio:", error);
    return null;
  }
}
