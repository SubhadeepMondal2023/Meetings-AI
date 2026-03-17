/**
 * ENHANCED KNOWLEDGE GRAPH EXTRACTION (STEP 2 FIX)
 * 
 * Key improvements:
 * 1. Transcript is now ENRICHED with entity metadata before extraction
 * 2. LLM has explicit instructions on entity types and relationships
 * 3. Manual post-processing to create missing relationships (ActionItem→Deadline, etc.)
 * 4. Entity deduplication using normalized names
 */

import { ChatOpenAI } from "@langchain/openai";
import { LLMGraphTransformer } from "@langchain/community/experimental/graph_transformers/llm";
import { Neo4jGraph } from "@langchain/community/graphs/neo4j_graph";
import { Document } from "@langchain/core/documents";
import { GraphCypherQAChain } from "@langchain/community/chains/graph_qa/cypher";
import {
  enrichTranscript,
  getDeduplicationMap,
  type ExtractedEntity,
} from "./entity-extractor";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type GraphNode = {
  type: string;
  id: string;
  properties: Record<string, unknown>;
};

type GraphRelationship = {
  source: string;
  target: string;
  type: string;
  properties?: Record<string, unknown>;
};

type KnowledgeGraphData = {
  nodes: GraphNode[];
  relationships: GraphRelationship[];
  meetingId: string;
  extractedAt: Date;
};

// ============================================================================
// CONFIGURATION WITH ENRICHED INSTRUCTIONS
// ============================================================================

const model = new ChatOpenAI({
  modelName: "gpt-4o-mini",
  temperature: 0, // Deterministic for consistent extraction
  openAIApiKey: process.env.OPENAI_API_KEY,
  requestOptions: {
    timeout: 45000,
  },
  maxRetries: 2,
});

// ✅ IMPROVED: System prompt now guides extraction with examples
const ENHANCED_SYSTEM_PROMPT = `You are a knowledge graph extraction expert for meeting transcripts.

Your task: Extract a structured knowledge graph from the transcript.

ENTITY TYPES (Create nodes for these):
1. Meeting - The meeting itself
2. Speaker - A person who spoke (USE NORMALIZED NAMES from metadata)
3. ActionItem - A task/responsibility (e.g., "Fix bug", "Present findings")
4. Deadline - A date when something is due (extracted from "by Friday", "Q2", etc.)
5. Decision - A key decision made (e.g., "We decided to...", "We will...")
6. Project - A named initiative or project
7. Topic - A subject discussed
8. Risk - A potential problem identified
9. Assumption - A stated or implied assumption

RELATIONSHIP TYPES (Create edges between nodes):
1. SPOKE_IN(Speaker → Meeting) - "Speaker X participated in Meeting Y"
2. ASSIGNED_TO(ActionItem → Speaker) - "Task X assigned to Person Y"
3. HAS_DEADLINE(ActionItem → Deadline) - "Task X has deadline Y"
4. DISCUSSED(Speaker/ActionItem → Topic) - "X discussed/relates to Topic Y"
5. WORKS_ON(Speaker → Project) - "Person X works on Project Y"
6. HAS_RISK(ActionItem/Decision → Risk) - "X has potential Risk Y"
7. DECIDED_TO(Speaker/Meeting → Decision) - "X decided to do Y"
8. DEPENDS_ON(ActionItem → ActionItem) - "Task X depends on Task Y"
9. MENTIONS(Topic → Concept) - "Topic X mentions Concept Y"
10. IMPACTS(Decision → Outcome) - "Decision X impacts Outcome Y"

EXTRACTION RULES:
- Use [PERSON: name], [ACTION: text | assignedTo: X | deadline: Y] markers as hints
- Speaker nodes: Use normalized names (already deduplicated in metadata)
- Action items: ALWAYS create ActionItem → Deadline relationship if deadline exists
- Relationships: Be explicit - don't omit relationships that are implied
- Confidence: Only create relationships with >70% confidence

CRITICAL: If an action item has a deadline, CREATE BOTH:
  - ActionItem node
  - Deadline node
  - HAS_DEADLINE relationship between them`;

const transformer = new LLMGraphTransformer({
  llm: model,
  allowedNodes: [
    "Meeting",
    "Speaker",
    "ActionItem",
    "Deadline",
    "Decision",
    "Project",
    "Risk",
    "Topic",
    "Outcome",
    "Assumption",
  ],
  allowedRelationships: [
    "SPOKE_IN",
    "ASSIGNED_TO",
    "HAS_DEADLINE",
    "DISCUSSED",
    "WORKS_ON",
    "HAS_RISK",
    "DECIDED_TO",
    "DEPENDS_ON",
    "MENTIONS",
    "IMPACTS",
  ],
  strict: true,
});

// ============================================================================
// CONNECTION MANAGEMENT
// ============================================================================

let graphInstance: Neo4jGraph | null = null;

async function getGraph(): Promise<Neo4jGraph> {
  if (graphInstance) {
    return graphInstance;
  }

  const maxRetries = 3;
  const retryDelay = 2000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔗 Connecting to Neo4j (attempt ${attempt}/${maxRetries})...`);

      graphInstance = await Neo4jGraph.initialize({
        url: process.env.NEO4J_URI!,
        username: process.env.NEO4J_USERNAME!,
        password: process.env.NEO4J_PASSWORD!,
      });

      console.log("✅ Neo4j connection established");
      return graphInstance;
    } catch (error) {
      console.error(
        `❌ Connection attempt ${attempt} failed:`,
        error instanceof Error ? error.message : "Unknown error"
      );

      if (attempt < maxRetries) {
        const waitTime = retryDelay * Math.pow(2, attempt - 1);
        console.log(`⏳ Retrying in ${waitTime}ms...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }
  }

  throw new Error("Failed to connect to Neo4j after retries");
}

// ============================================================================
// KNOWLEDGE GRAPH EXTRACTION (STEP 2 FIX)
// ============================================================================

/**
 * ✅ FIXED: Now uses enriched transcript for better extraction
 */
export async function addToKnowledgeGraph(
  transcript: unknown,
  meetingId: string,
  meetingTitle: string
): Promise<KnowledgeGraphData | null> {
  try {
    if (!transcript) {
      console.warn("⚠️ Graph extraction skipped: No transcript provided");
      return null;
    }

    console.log("🕸️ Starting Knowledge Graph Extraction (STEP 2 FIX)...");

    // Step 1: Normalize transcript to string
    let textContent = "";
    if (Array.isArray(transcript)) {
      textContent = transcript
        .map((t: unknown) => {
          const item = t as Record<string, unknown>;
          const text =
            Array.isArray(item.words) && item.words.length > 0
              ? (item.words as unknown[])
                  .map((w: unknown) => {
                    const word = w as Record<string, unknown>;
                    return String(word.word ?? "");
                  })
                  .join(" ")
              : String(item.text ?? "[speaking]");
          return `${String(item.speaker ?? "Speaker")}: ${text}`;
        })
        .join("\n");
    } else if (typeof transcript === "string") {
      textContent = transcript;
    } else if (
      transcript &&
      typeof transcript === "object" &&
      "text" in transcript
    ) {
      textContent = String((transcript as Record<string, unknown>).text);
    }

    if (!textContent || textContent.trim().length === 0) {
      throw new Error("EMPTY_TRANSCRIPT_CONTENT");
    }

    console.log(`📝 Transcript normalized: ${textContent.length} characters`);

    // ✅ STEP 2 FIX: Enrich transcript with entity metadata
    console.log("✨ Enriching transcript with entity metadata...");
    const enrichmentResult = await enrichTranscript(textContent);
    const enrichedText = enrichmentResult.enriched;
    const extractedEntities = enrichmentResult.entities;
    const deduplicationMap = getDeduplicationMap(extractedEntities);

    console.log(
      `✅ Enrichment complete: ${extractedEntities.length} entities identified`
    );

    // Step 3: Create LangChain Document with enriched content
    const documents = [
      new Document({
        pageContent: enrichedText,
        metadata: {
          meetingId,
          meetingTitle,
          extractedAt: new Date().toISOString(),
          wordCount: textContent.split(/\s+/).length,
          source: "meeting_transcript_enriched",
          entityCount: extractedEntities.length,
        },
      }),
    ];

    // Step 4: Extract graph structures
    console.log("🔍 Extracting entities and relationships from enriched transcript...");
    const graphDocuments = await transformer.convertToGraphDocuments(
      documents
    );

    if (!graphDocuments || graphDocuments.length === 0) {
      console.warn("⚠️ No graph structures extracted from transcript");
      return null;
    }

    console.log(
      `✅ Extracted ${graphDocuments.length} graph document(s)`
    );

    // ✅ STEP 2 FIX: Post-process to add missing relationships
    console.log("🔗 Post-processing: Adding missing relationships...");
    const processedDocuments = postProcessGraphDocuments(
      graphDocuments,
      extractedEntities,
      deduplicationMap,
      meetingId
    );

    // Step 5: Save to Neo4j
    console.log("💾 Saving graph structures to Neo4j...");
    const neo4j = await getGraph();
    await neo4j.addGraphDocuments(processedDocuments);

    console.log("✅ Graph saved to Neo4j");

    // Step 6: Extract and structure data
    const nodes = extractNodes(processedDocuments);
    const relationships = extractRelationships(processedDocuments);

    const result: KnowledgeGraphData = {
      nodes,
      relationships,
      meetingId,
      extractedAt: new Date(),
    };

    console.log(
      `🕸️ Knowledge Graph Complete: ${nodes.length} nodes, ${relationships.length} relationships`
    );

    return result;
  } catch (error) {
    console.error(
      "❌ Knowledge Graph Extraction Failed:",
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

// ============================================================================
// POST-PROCESSING: Add Missing Relationships (STEP 2 FIX)
// ============================================================================

/**
 * ✅ STEP 2 FIX: Post-process to add relationships that LLM might miss
 * Especially: ActionItem → HAS_DEADLINE → Deadline
 */
function postProcessGraphDocuments(
  graphDocuments: any[],
  extractedEntities: ExtractedEntity[],
  deduplicationMap: Map<string, string>,
  meetingId: string
): any[] {
  const docs = graphDocuments as any[];

  for (const doc of docs) {
    if (!doc.relationships) {
      doc.relationships = [];
    }

    const relationships = doc.relationships as Array<Record<string, unknown>>;

    // Extract action items from document
    const actionItems = extractedEntities.filter((e) => e.type === "ACTION_ITEM");

    for (const actionItem of actionItems) {
      const metadata = actionItem.metadata as Record<string, unknown>;
      const deadline = metadata.deadline as string | null;
      const assignedTo = metadata.assignedTo as string | null;

      if (deadline) {
        // ✅ Create ActionItem → HAS_DEADLINE → Deadline relationship
        const actionItemId = actionItem.normalizedValue;
        const deadlineId = `deadline_${deadline.replace(/-/g, "_")}`;

        // Check if relationship already exists
        const exists = relationships.some(
          (r) =>
            r.source?.id === actionItemId &&
            r.type === "HAS_DEADLINE" &&
            r.target?.id === deadlineId
        );

        if (!exists) {
          console.log(
            `   ➕ Adding missing relationship: ${actionItemId} --[HAS_DEADLINE]--> ${deadlineId}`
          );

          relationships.push({
            source: {
              type: "ActionItem",
              id: actionItemId,
            },
            target: {
              type: "Deadline",
              id: deadlineId,
            },
            type: "HAS_DEADLINE",
            properties: {
              deadline: deadline,
              meetingId,
            },
          });
        }
      }

      if (assignedTo) {
        // ✅ Create ActionItem → ASSIGNED_TO → Speaker relationship
        const actionItemId = actionItem.normalizedValue;
        const speakerId = assignedTo;

        const exists = relationships.some(
          (r) =>
            r.source?.id === actionItemId &&
            r.type === "ASSIGNED_TO" &&
            r.target?.id === speakerId
        );

        if (!exists) {
          console.log(
            `   ➕ Adding missing relationship: ${actionItemId} --[ASSIGNED_TO]--> ${speakerId}`
          );

          relationships.push({
            source: {
              type: "ActionItem",
              id: actionItemId,
            },
            target: {
              type: "Speaker",
              id: speakerId,
            },
            type: "ASSIGNED_TO",
            properties: {
              meetingId,
            },
          });
        }
      }
    }

    doc.relationships = relationships;
  }

  return docs;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function extractNodes(graphDocuments: any[]): GraphNode[] {
  const nodeMap = new Map<string, GraphNode>();

  for (const doc of graphDocuments) {
    const docAny = doc as any;
    if (docAny.nodes && Array.isArray(docAny.nodes)) {
      for (const node of docAny.nodes) {
        const n = node as any;
        const nodeType = String(n.type ?? "Unknown");
        const nodeId = String(n.id ?? "");
        const key = `${nodeType}:${nodeId}`;

        if (!nodeMap.has(key)) {
          nodeMap.set(key, {
            type: nodeType,
            id: nodeId,
            properties: (n.properties as Record<string, unknown>) ?? {},
          });
        }
      }
    }
  }

  return Array.from(nodeMap.values());
}

function extractRelationships(graphDocuments: any[]): GraphRelationship[] {
  const relationshipMap = new Map<string, GraphRelationship>();

  for (const doc of graphDocuments) {
    const docAny = doc as any;
    if (docAny.relationships && Array.isArray(docAny.relationships)) {
      for (const rel of docAny.relationships) {
        const r = rel as any;
        const source = r.source as any;
        const target = r.target as any;
        const sourceId = String(source?.id ?? r.source ?? "");
        const targetId = String(target?.id ?? r.target ?? "");
        const relType = String(r.type ?? "UNKNOWN");
        const key = `${sourceId}:${relType}:${targetId}`;

        if (!relationshipMap.has(key)) {
          relationshipMap.set(key, {
            source: sourceId,
            target: targetId,
            type: relType,
            properties: (r.properties as Record<string, unknown>) ?? {},
          });
        }
      }
    }
  }

  return Array.from(relationshipMap.values());
}

// ============================================================================
// GRAPH QUERYING
// ============================================================================

export async function queryGraphMemory(question: string): Promise<string> {
  try {
    if (
      !question ||
      typeof question !== "string" ||
      question.trim().length === 0
    ) {
      return "Error: Please provide a valid question.";
    }

    console.log(`🔍 Graph Query: "${question}"`);

    const neo4jGraph = await getGraph();

    const chain = GraphCypherQAChain.fromLLM({
      llm: model,
      graph: neo4jGraph,
      verbose: false,
      topK: 10,
      answerLanguage: "English",
    });

    const response = await chain.invoke({ query: question });

    console.log("✅ Graph Query Complete");

    if (response && typeof response === "object") {
      const respObj = response as Record<string, unknown>;
      if ("text" in respObj && typeof respObj.text === "string") {
        return respObj.text;
      }
      if ("output" in respObj) {
        return String(respObj.output);
      }
      if ("result" in respObj) {
        return String(respObj.result);
      }
    }

    return typeof response === "string" ? response : JSON.stringify(response);
  } catch (error) {
    console.error(
      "❌ Graph Query Failed:",
      error instanceof Error ? error.message : error
    );
    return "";
  }
}

// ============================================================================
// MAINTENANCE & EXPORT
// ============================================================================

export async function clearGraph(): Promise<boolean> {
  try {
    const neo4jGraph = await getGraph();
    await neo4jGraph.query("MATCH (n) DETACH DELETE n");
    console.log("🧹 Graph cleared successfully");
    return true;
  } catch (error) {
    console.error("❌ Failed to clear graph:", error);
    return false;
  }
}

export async function deleteGraphForMeeting(
  meetingId: string
): Promise<boolean> {
  try {
    const neo4jGraph = await getGraph();

    const deleteQuery = `
      MATCH (n {meetingId: $meetingId})
      DETACH DELETE n
      RETURN count(n) as deletedCount
    `;

    const result = await neo4jGraph.query(deleteQuery, { meetingId });
    const queryResult = result as Array<Record<string, unknown>>;
    const deletedCount = queryResult[0]?.deletedCount ?? 0;

    console.log(
      `🧹 Deleted ${deletedCount} nodes for meeting ${meetingId}`
    );
    return true;
  } catch (error) {
    console.error(
      `Failed to delete graph for meeting ${meetingId}:`,
      error
    );
    return false;
  }
}

export async function getGraphStatistics(): Promise<
  Record<string, unknown>
> {
  try {
    const neo4j = await getGraph();

    const nodeStats = await neo4j.query(
      `MATCH (n)
       RETURN labels(n)[0] as type, count(*) as count
       ORDER BY count DESC`
    );

    const relStats = await neo4j.query(
      `MATCH ()-[r]->()
       RETURN type(r) as type, count(*) as count
       ORDER BY count DESC`
    );

    const nodeResult = nodeStats as Array<Record<string, unknown>>;
    const relResult = relStats as Array<Record<string, unknown>>;

    const nodesByType = Object.fromEntries(
      nodeResult.map((s) => [s.type, s.count])
    );
    const relationshipsByType = Object.fromEntries(
      relResult.map((s) => [s.type, s.count])
    );

    return {
      nodesByType,
      relationshipsByType,
      totalNodes: nodeResult.reduce(
        (sum, s) => sum + Number(s.count ?? 0),
        0
      ),
      totalRelationships: relResult.reduce(
        (sum, s) => sum + Number(s.count ?? 0),
        0
      ),
    };
  } catch (error) {
    console.error("Failed to get graph statistics:", error);
    return {};
  }
}