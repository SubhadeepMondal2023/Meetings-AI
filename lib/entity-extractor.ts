/**
 * ENTITY EXTRACTION LAYER - Step 1 of Knowledge Graph Fix
 * 
 * Extracts and normalizes: People, Action Items, Dates, Projects, Topics
 * Enriches transcript with metadata for better graph extraction
 */

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 30000,
});

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type ExtractedEntity = {
  type: "PERSON" | "ACTION_ITEM" | "DATE" | "PROJECT" | "TOPIC" | "DECISION";
  value: string;
  normalizedValue: string; // For deduplication
  metadata: Record<string, unknown>;
  confidence: number;
};

export type EnrichedTranscript = {
  original: string;
  enriched: string;
  entities: ExtractedEntity[];
  entityIndex: Map<string, ExtractedEntity>;
};

// ============================================================================
// NAME NORMALIZATION (Solves fragmentation)
// ============================================================================

/**
 * Normalizes person names to canonical form
 * "John Smith" = "John S." = "JS" = "john smith" → canonical: "john_smith"
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, "") // Remove punctuation
    .replace(/\s+/g, "_") // Replace spaces with underscore
    .replace(/_+/g, "_"); // Remove duplicate underscores
}

/**
 * Deduplicates similar names (handles "John Smith" vs "J.S.")
 */
export function deduplicateNames(names: string[]): Map<string, string> {
  const canonical = new Map<string, string>();

  for (const name of names) {
    const normalized = normalizeName(name);

    // Check if we already have this canonical form
    if (canonical.has(normalized)) {
      continue;
    }

    // Check if this name is similar to existing ones
    let foundSimilar = false;
    for (const [existing, existingCanonical] of canonical) {
      if (isSimilarName(normalized, existingCanonical)) {
        // Use the existing one (prefer longer form)
        if (name.length > existing.length) {
          canonical.delete(existingCanonical);
          canonical.set(name, normalized);
        }
        foundSimilar = true;
        break;
      }
    }

    if (!foundSimilar) {
      canonical.set(name, normalized);
    }
  }

  return canonical;
}

/**
 * Checks if two names are similar (fuzzy matching)
 */
function isSimilarName(name1: string, name2: string): boolean {
  // Exact match
  if (name1 === name2) return true;

  // One is abbreviation of other
  const parts1 = name1.split("_");
  const parts2 = name2.split("_");

  if (parts1.length === 1 && parts2.length > 1) {
    return parts1[0][0] === parts2[0][0]; // "john" vs "john_smith" → check first letter
  }

  return false;
}

// ============================================================================
// DATE NORMALIZATION
// ============================================================================

/**
 * Converts relative dates to absolute dates
 */
export function normalizeDate(
  dateStr: string,
  referenceDate: Date = new Date()
): { normalized: string; isoDate: string; confidence: number } {
  const lower = dateStr.toLowerCase();
  const targetDate = new Date(referenceDate);

  if (lower.includes("monday")) {
    const day = 1;
    const diff = (day - targetDate.getDay() + 7) % 7;
    targetDate.setDate(targetDate.getDate() + (diff === 0 ? 7 : diff));
  } else if (lower.includes("tuesday")) {
    const day = 2;
    const diff = (day - targetDate.getDay() + 7) % 7;
    targetDate.setDate(targetDate.getDate() + (diff === 0 ? 7 : diff));
  } else if (lower.includes("wednesday")) {
    const day = 3;
    const diff = (day - targetDate.getDay() + 7) % 7;
    targetDate.setDate(targetDate.getDate() + (diff === 0 ? 7 : diff));
  } else if (lower.includes("thursday")) {
    const day = 4;
    const diff = (day - targetDate.getDay() + 7) % 7;
    targetDate.setDate(targetDate.getDate() + (diff === 0 ? 7 : diff));
  } else if (lower.includes("friday")) {
    const day = 5;
    const diff = (day - targetDate.getDay() + 7) % 7;
    targetDate.setDate(targetDate.getDate() + (diff === 0 ? 7 : diff));
  } else if (lower.includes("tomorrow")) {
    targetDate.setDate(targetDate.getDate() + 1);
  } else if (lower.includes("next week")) {
    targetDate.setDate(targetDate.getDate() + 7);
  } else if (lower.includes("next month")) {
    targetDate.setMonth(targetDate.getMonth() + 1);
  } else if (lower.includes("q1")) {
    targetDate.setMonth(2); // End of Q1
  } else if (lower.includes("q2")) {
    targetDate.setMonth(5); // End of Q2
  } else if (lower.includes("q3")) {
    targetDate.setMonth(8); // End of Q3
  } else if (lower.includes("q4")) {
    targetDate.setMonth(11); // End of Q4
  }

  return {
    normalized: dateStr,
    isoDate: targetDate.toISOString().split("T")[0],
    confidence: dateStr.match(/^\d{4}-\d{2}-\d{2}$/) ? 1.0 : 0.7,
  };
}

// ============================================================================
// MAIN ENTITY EXTRACTION
// ============================================================================

/**
 * Extracts all entities from transcript using LLM
 */
export async function extractEntitiesFromTranscript(
  transcript: string
): Promise<ExtractedEntity[]> {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0, // Deterministic
      max_tokens: 2000,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an entity extraction specialist for meeting transcripts.

Extract all entities in this JSON format ONLY:
{
  "people": ["Name1", "Name2"],
  "actionItems": [
    {
      "text": "Description of task",
      "assignedTo": "Person Name or null",
      "deadline": "Date or null"
    }
  ],
  "dates": ["relative date string"],
  "projects": ["Project name"],
  "topics": ["Topic discussed"],
  "decisions": ["Decision made"]
}

RULES:
- People: Extract all proper names (exact spelling from transcript)
- Action Items: Extract with owner and deadline if mentioned
- Dates: Extract relative ("by Friday") and absolute ("2025-03-21")
- Projects: Extract capitalized project names
- Topics: Main subjects discussed (technical, business, strategic)
- Decisions: Key decisions made ("We decided to...", "We will...")

Be exhaustive but accurate.`,
        },
        {
          role: "user",
          content: transcript,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error("Empty response");

    const parsed = JSON.parse(content);

    const entities: ExtractedEntity[] = [];

    // Extract people
    if (Array.isArray(parsed.people)) {
      const personNames = new Map(deduplicateNames(parsed.people));
      for (const [originalName, normalized] of personNames) {
        entities.push({
          type: "PERSON",
          value: originalName,
          normalizedValue: normalized,
          metadata: { role: "unknown" },
          confidence: 0.9,
        });
      }
    }

    // Extract action items
    if (Array.isArray(parsed.actionItems)) {
      for (const item of parsed.actionItems) {
        const itemObj = item as Record<string, unknown>;
        entities.push({
          type: "ACTION_ITEM",
          value: String(itemObj.text ?? ""),
          normalizedValue: `action_${normalizeName(String(itemObj.text ?? ""))}`,
          metadata: {
            assignedTo: itemObj.assignedTo
              ? normalizeName(String(itemObj.assignedTo))
              : null,
            deadline: itemObj.deadline ? String(itemObj.deadline) : null,
          },
          confidence: 0.85,
        });
      }
    }

    // Extract dates
    if (Array.isArray(parsed.dates)) {
      for (const dateStr of parsed.dates) {
        const normalized = normalizeDate(String(dateStr));
        entities.push({
          type: "DATE",
          value: String(dateStr),
          normalizedValue: normalized.isoDate,
          metadata: { isoDate: normalized.isoDate },
          confidence: normalized.confidence,
        });
      }
    }

    // Extract projects
    if (Array.isArray(parsed.projects)) {
      for (const proj of parsed.projects) {
        entities.push({
          type: "PROJECT",
          value: String(proj),
          normalizedValue: normalizeName(String(proj)),
          metadata: {},
          confidence: 0.85,
        });
      }
    }

    // Extract topics
    if (Array.isArray(parsed.topics)) {
      for (const topic of parsed.topics) {
        entities.push({
          type: "TOPIC",
          value: String(topic),
          normalizedValue: normalizeName(String(topic)),
          metadata: {},
          confidence: 0.8,
        });
      }
    }

    // Extract decisions
    if (Array.isArray(parsed.decisions)) {
      for (const decision of parsed.decisions) {
        entities.push({
          type: "DECISION",
          value: String(decision),
          normalizedValue: normalizeName(String(decision)),
          metadata: {},
          confidence: 0.85,
        });
      }
    }

    console.log(`✅ Extracted ${entities.length} entities from transcript`);
    return entities;
  } catch (error) {
    console.error("❌ Entity extraction failed:", error);
    return [];
  }
}

// ============================================================================
// TRANSCRIPT ENRICHMENT
// ============================================================================

/**
 * Enriches transcript with entity metadata for better graph extraction
 */
export async function enrichTranscript(
  transcript: string
): Promise<EnrichedTranscript> {
  try {
    console.log("🔍 Extracting entities...");
    const entities = await extractEntitiesFromTranscript(transcript);

    const entityIndex = new Map<string, ExtractedEntity>();
    for (const entity of entities) {
      entityIndex.set(entity.normalizedValue, entity);
    }

    // Create enriched version with entity markers
    let enriched = transcript;

    // Add metadata comments for graph transformer to pick up
    const enrichmentComments = entities
      .filter((e) => e.confidence > 0.8)
      .map((e) => {
        if (e.type === "PERSON") {
          return `[PERSON: ${e.value} | normalized: ${e.normalizedValue}]`;
        } else if (e.type === "ACTION_ITEM") {
          const metadata = e.metadata as Record<string, unknown>;
          return `[ACTION: ${e.value} | assignedTo: ${metadata.assignedTo || "unassigned"} | deadline: ${metadata.deadline || "none"}]`;
        } else if (e.type === "DATE") {
          const metadata = e.metadata as Record<string, unknown>;
          return `[DATE: ${e.value} | iso: ${metadata.isoDate}]`;
        } else if (e.type === "PROJECT") {
          return `[PROJECT: ${e.value}]`;
        } else if (e.type === "TOPIC") {
          return `[TOPIC: ${e.value}]`;
        } else if (e.type === "DECISION") {
          return `[DECISION: ${e.value}]`;
        }
        return "";
      })
      .filter((c) => c.length > 0)
      .join("\n");

    enriched = `${enrichmentComments}\n\n=== TRANSCRIPT ===\n\n${transcript}`;

    console.log(
      `✅ Transcript enriched: ${entities.length} entities marked`
    );

    return {
      original: transcript,
      enriched,
      entities,
      entityIndex,
    };
  } catch (error) {
    console.error("❌ Transcript enrichment failed:", error);
    return {
      original: transcript,
      enriched: transcript,
      entities: [],
      entityIndex: new Map(),
    };
  }
}

/**
 * Exports deduplication mapping for graph node linking
 */
export function getDeduplicationMap(
  entities: ExtractedEntity[]
): Map<string, string> {
  const map = new Map<string, string>();

  // Map original names to normalized names
  const people = entities.filter((e) => e.type === "PERSON");
  for (const person of people) {
    map.set(person.value, person.normalizedValue);
  }

  return map;
}