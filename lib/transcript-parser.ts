/**
 * Normalize different transcript formats into the standard format
 * Expected format: Array of segments with speaker, offset, and words array
 */

interface TranscriptWord {
    word: string;
    start: number;
    end: number;
}

interface TranscriptSegment {
    speaker: string;
    offset: number;
    words: TranscriptWord[];
}

export function normalizeTranscript(data: any): TranscriptSegment[] | null {
    if (!data) return null;

    // If it's already an array, assume it's the expected format
    if (Array.isArray(data)) {
        // Validate it has the expected structure
        if (data.length > 0 && data[0].words && data[0].speaker) {
            return data as TranscriptSegment[];
        }

        // Try to parse if it looks like raw segments
        // MeetingBaaS might send: [{ speaker: "...", text: "...", timestamp: 0 }, ...]
        return parseRawTranscriptArray(data);
    }

    // If it's an object with transcript property
    if (data.transcript) {
        return normalizeTranscript(data.transcript);
    }

    return null;
}

function parseRawTranscriptArray(data: any[]): TranscriptSegment[] | null {
    const segments: TranscriptSegment[] = [];

    for (let i = 0; i < data.length; i++) {
        const item = data[i];

        // Skip invalid items
        if (!item || typeof item !== 'object') continue;

        // Extract speaker name (different possible field names)
        const speaker = item.speaker || item.name || item.person || `Speaker ${i + 1}`;

        // Extract offset/timestamp
        const offset = item.offset || item.timestamp || item.start_time || i;

        // Extract text (different possible field names) - check many possible fields
        let text = item.text 
            || item.content 
            || item.transcript 
            || item.transcription
            || item.message
            || item.body
            || item.data
            || '';
        
        // Debug: log what we found for first few segments
        if (i < 2) {
            console.log(`📋 [SEGMENT ${i}] Available fields:`, Object.keys(item));
            console.log(`📋 [SEGMENT ${i}] Text extracted as:`, text ? `"${text.substring(0, 100)}..."` : '(empty)');
            console.log(`📋 [SEGMENT ${i}] Words array:`, item.words ? `${item.words.length} items` : 'missing');
        }

        // If no text but has words array with content, extract from there
        if (!text && item.words && item.words.length > 0) {
            text = item.words.map((w: any) => (typeof w === 'string' ? w : w.word || w.text || '')).join(' ');
        }

        // If still no text, try to extract from nested structures
        if (!text) {
            // Try common nested patterns
            if (item.segment?.text) text = item.segment.text;
            if (!text && item.result?.text) text = item.result.text;
            if (!text && item.utterance) text = item.utterance;
            if (!text && item.speech) text = item.speech;
        }

        // If still no text but we have timing info, log it (don't auto-generate placeholder yet)
        if (!text && (item.words || item.start_time || item.end_time)) {
            // We have timing info but no transcribed text
            const duration = (item.end_time || item.end || item.offset) - (item.start_time || item.start || item.offset || 0);
            console.log(`⚠️ [SEGMENT ${i}] Has timing (${duration.toFixed(1)}s) but no text content. Fields: ${Object.keys(item).join(', ')}`);
            text = `[Speaking for ${duration.toFixed(1)}s]`;
        }

        if (!text) continue; // Skip empty segments

        // Convert text to words array
        const words: TranscriptWord[] = [];
        if (typeof text === 'string') {
            // Simple approach: split text into words with estimated timing
            const textWords = text.split(/\s+/).filter(w => w.length > 0);
            let currentTime = offset;
            const avgWordDuration = 0.5; // Assume ~0.5 seconds per word

            textWords.forEach((word, idx) => {
                words.push({
                    word: word,
                    start: currentTime,
                    end: currentTime + avgWordDuration,
                });
                currentTime += avgWordDuration;
            });
        } else if (Array.isArray(text)) {
            // If text is already an array of words
            text.forEach((w: any) => {
                if (typeof w === 'string') {
                    words.push({
                        word: w,
                        start: 0,
                        end: 0.5,
                    });
                } else if (w.word || w.text) {
                    words.push({
                        word: w.word || w.text,
                        start: w.start || w.start_time || 0,
                        end: w.end || w.end_time || 0.5,
                    });
                }
            });
        }

        if (words.length > 0) {
            segments.push({
                speaker,
                offset,
                words,
            });
        }
    }

    return segments.length > 0 ? segments : null;
}

export function validateTranscript(transcript: any): boolean {
    if (!transcript) return false;
    if (!Array.isArray(transcript)) return false;
    if (transcript.length === 0) return false;

    // Check if first item has expected structure
    const first = transcript[0];
    return !!(first.speaker && first.words && Array.isArray(first.words));
}
