/**
 * ENTITY EXTRACTION LAYER
 * Migrated: Gemini → Groq (llama-3.3-70b-versatile)
 */

import Groq from "groq-sdk"

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! })
const MODEL = "llama-3.3-70b-versatile"

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type ExtractedEntity = {
  type: "PERSON" | "ACTION_ITEM" | "DATE" | "PROJECT" | "TOPIC" | "DECISION"
  value: string
  normalizedValue: string
  metadata: Record<string, unknown>
  confidence: number
}

export type EnrichedTranscript = {
  original: string
  enriched: string
  entities: ExtractedEntity[]
  entityIndex: Map<string, ExtractedEntity>
}

// ============================================================================
// NAME NORMALIZATION
// ============================================================================

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
}

export function deduplicateNames(names: string[]): Map<string, string> {
  const canonical = new Map<string, string>()
  for (const name of names) {
    const normalized = normalizeName(name)
    if (canonical.has(normalized)) continue
    let foundSimilar = false
    for (const [existing, existingCanonical] of canonical) {
      if (isSimilarName(normalized, existingCanonical)) {
        if (name.length > existing.length) {
          canonical.delete(existingCanonical)
          canonical.set(name, normalized)
        }
        foundSimilar = true
        break
      }
    }
    if (!foundSimilar) canonical.set(name, normalized)
  }
  return canonical
}

function isSimilarName(name1: string, name2: string): boolean {
  if (name1 === name2) return true
  const parts1 = name1.split("_")
  const parts2 = name2.split("_")
  if (parts1.length === 1 && parts2.length > 1) return parts1[0][0] === parts2[0][0]
  return false
}

// ============================================================================
// DATE NORMALIZATION
// ============================================================================

export function normalizeDate(
  dateStr: string,
  referenceDate: Date = new Date()
): { normalized: string; isoDate: string; confidence: number } {
  const lower = dateStr.toLowerCase()
  const targetDate = new Date(referenceDate)

  const dayMap: Record<string, number> = {
    monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5,
  }
  for (const [day, num] of Object.entries(dayMap)) {
    if (lower.includes(day)) {
      const diff = (num - targetDate.getDay() + 7) % 7
      targetDate.setDate(targetDate.getDate() + (diff === 0 ? 7 : diff))
    }
  }
  if (lower.includes("tomorrow")) targetDate.setDate(targetDate.getDate() + 1)
  else if (lower.includes("next week")) targetDate.setDate(targetDate.getDate() + 7)
  else if (lower.includes("next month")) targetDate.setMonth(targetDate.getMonth() + 1)
  else if (lower.includes("q1")) targetDate.setMonth(2)
  else if (lower.includes("q2")) targetDate.setMonth(5)
  else if (lower.includes("q3")) targetDate.setMonth(8)
  else if (lower.includes("q4")) targetDate.setMonth(11)

  return {
    normalized: dateStr,
    isoDate: targetDate.toISOString().split("T")[0],
    confidence: dateStr.match(/^\d{4}-\d{2}-\d{2}$/) ? 1.0 : 0.7,
  }
}

// ============================================================================
// MAIN ENTITY EXTRACTION
// ============================================================================

export async function extractEntitiesFromTranscript(
  transcript: string
): Promise<ExtractedEntity[]> {
  try {
    const response = await groq.chat.completions.create({
      model: MODEL,
      temperature: 0,
      max_tokens: 2000,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an entity extraction specialist for meeting transcripts.
Extract all entities and return ONLY this JSON format:
{
  "people": ["Name1", "Name2"],
  "actionItems": [
    { "text": "task description", "assignedTo": "Person Name or null", "deadline": "date or null" }
  ],
  "dates": ["relative or absolute date strings"],
  "projects": ["Project name"],
  "topics": ["Topic discussed"],
  "decisions": ["Decision made"]
}
Be exhaustive but accurate. Return only the JSON object.`,
        },
        { role: "user", content: transcript },
      ],
    })

    const content = response.choices[0]?.message?.content
    if (!content) throw new Error("Empty response")

    const clean = content.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim()
    const parsed = JSON.parse(clean)
    const entities: ExtractedEntity[] = []

    if (Array.isArray(parsed.people)) {
      const personNames = new Map(deduplicateNames(parsed.people))
      for (const [originalName, normalized] of personNames) {
        entities.push({
          type: "PERSON",
          value: originalName,
          normalizedValue: normalized,
          metadata: { role: "unknown" },
          confidence: 0.9,
        })
      }
    }

    if (Array.isArray(parsed.actionItems)) {
      for (const item of parsed.actionItems) {
        const itemObj = item as Record<string, unknown>
        entities.push({
          type: "ACTION_ITEM",
          value: String(itemObj.text ?? ""),
          normalizedValue: `action_${normalizeName(String(itemObj.text ?? ""))}`,
          metadata: {
            assignedTo: itemObj.assignedTo ? normalizeName(String(itemObj.assignedTo)) : null,
            deadline: itemObj.deadline ? String(itemObj.deadline) : null,
          },
          confidence: 0.85,
        })
      }
    }

    if (Array.isArray(parsed.dates)) {
      for (const dateStr of parsed.dates) {
        const normalized = normalizeDate(String(dateStr))
        entities.push({
          type: "DATE",
          value: String(dateStr),
          normalizedValue: normalized.isoDate,
          metadata: { isoDate: normalized.isoDate },
          confidence: normalized.confidence,
        })
      }
    }

    if (Array.isArray(parsed.projects)) {
      for (const proj of parsed.projects) {
        entities.push({
          type: "PROJECT",
          value: String(proj),
          normalizedValue: normalizeName(String(proj)),
          metadata: {},
          confidence: 0.85,
        })
      }
    }

    if (Array.isArray(parsed.topics)) {
      for (const topic of parsed.topics) {
        entities.push({
          type: "TOPIC",
          value: String(topic),
          normalizedValue: normalizeName(String(topic)),
          metadata: {},
          confidence: 0.8,
        })
      }
    }

    if (Array.isArray(parsed.decisions)) {
      for (const decision of parsed.decisions) {
        entities.push({
          type: "DECISION",
          value: String(decision),
          normalizedValue: normalizeName(String(decision)),
          metadata: {},
          confidence: 0.85,
        })
      }
    }

    console.log(`✅ Extracted ${entities.length} entities from transcript`)
    return entities
  } catch (error) {
    console.error("❌ Entity extraction failed:", error)
    return []
  }
}

// ============================================================================
// TRANSCRIPT ENRICHMENT
// ============================================================================

export async function enrichTranscript(transcript: string): Promise<EnrichedTranscript> {
  try {
    console.log("🔍 Extracting entities...")
    const entities = await extractEntitiesFromTranscript(transcript)

    const entityIndex = new Map<string, ExtractedEntity>()
    for (const entity of entities) entityIndex.set(entity.normalizedValue, entity)

    const enrichmentComments = entities
      .filter((e) => e.confidence > 0.8)
      .map((e) => {
        if (e.type === "PERSON") return `[PERSON: ${e.value} | normalized: ${e.normalizedValue}]`
        if (e.type === "ACTION_ITEM") {
          const m = e.metadata as Record<string, unknown>
          return `[ACTION: ${e.value} | assignedTo: ${m.assignedTo || "unassigned"} | deadline: ${m.deadline || "none"}]`
        }
        if (e.type === "DATE") {
          const m = e.metadata as Record<string, unknown>
          return `[DATE: ${e.value} | iso: ${m.isoDate}]`
        }
        if (e.type === "PROJECT") return `[PROJECT: ${e.value}]`
        if (e.type === "TOPIC") return `[TOPIC: ${e.value}]`
        if (e.type === "DECISION") return `[DECISION: ${e.value}]`
        return ""
      })
      .filter((c) => c.length > 0)
      .join("\n")

    const enriched = `${enrichmentComments}\n\n=== TRANSCRIPT ===\n\n${transcript}`
    console.log(`✅ Transcript enriched: ${entities.length} entities marked`)

    return { original: transcript, enriched, entities, entityIndex }
  } catch (error) {
    console.error("❌ Transcript enrichment failed:", error)
    return { original: transcript, enriched: transcript, entities: [], entityIndex: new Map() }
  }
}

export function getDeduplicationMap(entities: ExtractedEntity[]): Map<string, string> {
  const map = new Map<string, string>()
  const people = entities.filter((e) => e.type === "PERSON")
  for (const person of people) map.set(person.value, person.normalizedValue)
  return map
}
