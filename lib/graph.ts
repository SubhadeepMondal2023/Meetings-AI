/**
 * ENHANCED KNOWLEDGE GRAPH EXTRACTION & QUERYING (FIXED)
 * 
 * This module implements knowledge graph extraction using LangChain
 * with strict entity resolution and no TypeScript errors.
 */

import { ChatOpenAI } from "@langchain/openai";
import { LLMGraphTransformer } from "@langchain/community/experimental/graph_transformers/llm";
import { Neo4jGraph } from "@langchain/community/graphs/neo4j_graph";
import { Document } from "@langchain/core/documents";
import { GraphCypherQAChain } from "@langchain/community/chains/graph_qa/cypher";

// ============================================================================
// TYPE DEFINITIONS (INLINE)
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
// CONFIGURATION
// ============================================================================

const model = new ChatOpenAI({
  modelName: "gpt-4o-mini",
  temperature: 0,
  openAIApiKey: process.env.OPENAI_API_KEY,
  requestOptions: {
    timeout: 45000,
  },
  maxRetries: 2,
});

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
    "Outcome",
    "Topic",
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

/**
 * Lazily initializes Neo4j connection with retry logic
 */
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
      } else {
        throw new Error(
          `Failed to connect to Neo4j after ${maxRetries} attempts`
        );
      }
    }
  }

  throw new Error("Unreachable: Neo4j connection failed");
}

// ============================================================================
// KNOWLEDGE GRAPH EXTRACTION
// ============================================================================

/**
 * Extracts knowledge graph from meeting transcript
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

    console.log("🕸️ Starting Knowledge Graph Extraction...");

    // Step 1: Normalize transcript
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

    // Step 2: Create LangChain Document
    const documents = [
      new Document({
        pageContent: textContent,
        metadata: {
          meetingId,
          meetingTitle,
          extractedAt: new Date().toISOString(),
          wordCount: textContent.split(/\s+/).length,
          source: "meeting_transcript",
        },
      }),
    ];

    // Step 3: Extract graph structures
    console.log("🔍 Extracting entities and relationships...");
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

    // Step 4: Save to Neo4j
    console.log("💾 Saving graph structures to Neo4j...");
    const neo4j = await getGraph();
    await neo4j.addGraphDocuments(graphDocuments);

    console.log("✅ Graph saved to Neo4j");

    // Step 5: Extract and structure data
    const nodes = extractNodes(graphDocuments);
    const relationships = extractRelationships(graphDocuments);

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

/**
 * Extracts nodes from graph documents
 */
function extractNodes(graphDocuments: unknown[]): GraphNode[] {
  const nodeMap = new Map<string, GraphNode>();

  const docs = graphDocuments as Array<Record<string, unknown>>;
  for (const doc of docs) {
    if (doc.nodes && Array.isArray(doc.nodes)) {
      for (const node of doc.nodes) {
        const n = node as Record<string, unknown>;
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

/**
 * Extracts relationships from graph documents
 */
function extractRelationships(graphDocuments: unknown[]): GraphRelationship[] {
  const relationshipMap = new Map<string, GraphRelationship>();

  const docs = graphDocuments as Array<Record<string, unknown>>;
  for (const doc of docs) {
    if (doc.relationships && Array.isArray(doc.relationships)) {
      for (const rel of doc.relationships) {
        const r = rel as Record<string, unknown>;
        const source = r.source as Record<string, unknown>;
        const target = r.target as Record<string, unknown>;
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

/**
 * Queries the knowledge graph using natural language
 */
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

    if (typeof response === "string") {
      return response;
    }

    return JSON.stringify(response);
  } catch (error) {
    console.error(
      "❌ Graph Query Failed:",
      error instanceof Error ? error.message : error
    );
    return "";
  }
}

// ============================================================================
// ADVANCED GRAPH QUERIES
// ============================================================================

/**
 * Retrieves action items for specific person
 */
export async function getActionItemsForPerson(
  personName: string
): Promise<string[]> {
  try {
    const neo4j = await getGraph();

    const result = await neo4j.query(
      `MATCH (p:Speaker {name: $name})<-[:ASSIGNED_TO]-(a:ActionItem)
       RETURN a.text as actionItem, a.id as id
       ORDER BY a.id`,
      { name: personName }
    );

    const queryResult = result as Array<Record<string, unknown>>;
    return queryResult.map((record) => String(record.actionItem ?? ""));
  } catch (error) {
    console.error(`Failed to get action items for ${personName}:`, error);
    return [];
  }
}

/**
 * Retrieves decisions with associated risks
 */
export async function getDecisionsWithRisks(): Promise<
  Array<{ decision: string; risks: string[] }>
> {
  try {
    const neo4j = await getGraph();

    const result = await neo4j.query(
      `MATCH (d:Decision)-[:HAS_RISK]->(r:Risk)
       RETURN d.description as decision, collect(r.description) as risks`
    );

    const queryResult = result as Array<Record<string, unknown>>;
    return queryResult.map((record) => ({
      decision: String(record.decision ?? ""),
      risks: Array.isArray(record.risks)
        ? record.risks.map((r) => String(r ?? ""))
        : [],
    }));
  } catch (error) {
    console.error("Failed to get decisions with risks:", error);
    return [];
  }
}

/**
 * Finds discussions related to project
 */
export async function getProjectDiscussions(
  projectName: string
): Promise<string[]> {
  try {
    const neo4j = await getGraph();

    const result = await neo4j.query(
      `MATCH (p:Project {name: $name})<-[:DISCUSSED]-(d)
       WHERE d:Topic OR d:Decision
       RETURN DISTINCT d.description as content
       LIMIT 20`,
      { name: projectName }
    );

    const queryResult = result as Array<Record<string, unknown>>;
    return queryResult.map((record) => String(record.content ?? ""));
  } catch (error) {
    console.error(
      `Failed to get discussions for project ${projectName}:`,
      error
    );
    return [];
  }
}

/**
 * Gets graph statistics
 */
export async function getGraphStatistics(): Promise<
  Record<string, unknown>
> {
  try {
    const neo4j = await getGraph();

    // Get node counts
    const nodeStats = await neo4j.query(
      `MATCH (n)
       RETURN labels(n)[0] as type, count(*) as count
       ORDER BY count DESC`
    );

    // Get relationship counts
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

// ============================================================================
// GRAPH MAINTENANCE
// ============================================================================

/**
 * Clears all graph data
 */
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

/**
 * Deletes graph data for specific meeting
 */
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

/**
 * Merges duplicate nodes
 */
export async function mergeDuplicateNodes(
  nodeType: string,
  propertyName: string = "name"
): Promise<number> {
  try {
    const neo4jGraph = await getGraph();

    const mergeQuery = `
      MATCH (n1:${nodeType}), (n2:${nodeType})
      WHERE n1.${propertyName} = n2.${propertyName} 
        AND id(n1) < id(n2)
      WITH n1, n2, relationships(n1) as rel1, relationships(n2) as rel2
      CALL apoc.refactor.mergeNodes([n1, n2]) 
      YIELD node
      RETURN count(node) as mergedCount
    `;

    const result = await neo4jGraph.query(mergeQuery);
    const queryResult = result as Array<Record<string, unknown>>;
    const mergedCount = Number(queryResult[0]?.mergedCount ?? 0);

    console.log(
      `✅ Merged ${mergedCount} duplicate ${nodeType} nodes`
    );
    return mergedCount;
  } catch (error) {
    console.error(
      `Failed to merge duplicate nodes for ${nodeType}:`,
      error
    );
    return 0;
  }
}

/**
 * Exports graph as JSON
 */
export async function exportGraphAsJSON(): Promise<{
  nodes: unknown[];
  relationships: unknown[];
}> {
  try {
    const neo4jGraph = await getGraph();

    const nodes = await neo4jGraph.query(
      `MATCH (n)
       RETURN {
         id: id(n),
         type: labels(n)[0],
         properties: properties(n)
       } as node`
    );

    const relationships = await neo4jGraph.query(
      `MATCH (a)-[r]->(b)
       RETURN {
         source: id(a),
         target: id(b),
         type: type(r),
         properties: properties(r)
       } as rel`
    );

    const nodeResult = nodes as Array<Record<string, unknown>>;
    const relResult = relationships as Array<Record<string, unknown>>;

    return {
      nodes: nodeResult.map((n) => n.node),
      relationships: relResult.map((r) => r.rel),
    };
  } catch (error) {
    console.error("Failed to export graph as JSON:", error);
    return { nodes: [], relationships: [] };
  }
}