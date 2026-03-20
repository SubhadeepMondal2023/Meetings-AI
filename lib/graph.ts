import { Neo4jGraph } from "@langchain/community/graphs/neo4j_graph"
import { ChatOpenAI } from "@langchain/openai"
import { GraphCypherQAChain } from "@langchain/community/chains/graph_qa/cypher"
import {
  enrichTranscript,
  getDeduplicationMap,
  type ExtractedEntity,
} from "./entity-extractor"

process.env.OPENAI_API_KEY = process.env.GROQ_API_KEY || "dummy"

type GraphNode = {
  type: string
  id: string
  properties: Record<string, unknown>
}

type GraphRelationship = {
  source: string
  target: string
  type: string
  properties?: Record<string, unknown>
}

type KnowledgeGraphData = {
  nodes: GraphNode[]
  relationships: GraphRelationship[]
  meetingId: string
  extractedAt: Date
}

// Query model — only used for querying, not extraction
const queryModel = new ChatOpenAI({
  modelName: "llama-3.1-8b-instant",
  temperature: 0,
  openAIApiKey: process.env.GROQ_API_KEY || "dummy",
  configuration: {
    baseURL: "https://api.groq.com/openai/v1",
    apiKey: process.env.GROQ_API_KEY,
  },
  maxRetries: 2,
})

let graphInstance: Neo4jGraph | null = null

async function getGraph(): Promise<Neo4jGraph> {
  if (graphInstance) return graphInstance
  const maxRetries = 3
  const retryDelay = 2000
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`🔗 Connecting to Neo4j (attempt ${attempt}/${maxRetries})...`)
      graphInstance = await Neo4jGraph.initialize({
        url: process.env.NEO4J_URI!,
        username: process.env.NEO4J_USERNAME!,
        password: process.env.NEO4J_PASSWORD!,
      })
      console.log("✅ Neo4j connection established")
      return graphInstance
    } catch (error) {
      console.error(`❌ Connection attempt ${attempt} failed:`, error instanceof Error ? error.message : error)
      if (attempt < maxRetries) {
        const waitTime = retryDelay * Math.pow(2, attempt - 1)
        await new Promise((resolve) => setTimeout(resolve, waitTime))
      }
    }
  }
  throw new Error("Failed to connect to Neo4j after retries")
}

/**
 * Build graph directly from extracted entities — NO LLM required
 */
export async function addToKnowledgeGraph(
  transcript: unknown,
  meetingId: string,
  meetingTitle: string
): Promise<KnowledgeGraphData | null> {
  try {
    if (!transcript) {
      console.warn("⚠️ Graph extraction skipped: No transcript provided")
      return null
    }

    console.log("🕸️ Starting Knowledge Graph Extraction (rule-based)...")

    // Normalize transcript to text
    let textContent = ""
    if (Array.isArray(transcript)) {
      textContent = transcript
        .map((t: unknown) => {
          const item = t as Record<string, unknown>
          const text =
            Array.isArray(item.words) && item.words.length > 0
              ? (item.words as unknown[]).map((w) => String((w as Record<string, unknown>).word ?? "")).join(" ")
              : String(item.text ?? "[speaking]")
          return `${String(item.speaker ?? "Speaker")}: ${text}`
        })
        .join("\n")
    } else if (typeof transcript === "string") {
      textContent = transcript
    } else if (transcript && typeof transcript === "object" && "text" in transcript) {
      textContent = String((transcript as Record<string, unknown>).text)
    }

    if (!textContent || textContent.trim().length === 0) throw new Error("EMPTY_TRANSCRIPT_CONTENT")

    // Extract entities using existing entity extractor
    const enrichmentResult = await enrichTranscript(textContent)
    const entities = enrichmentResult.entities

    console.log(`✅ Extracted ${entities.length} entities`)

    // Build nodes and relationships directly from entities
    const nodes: GraphNode[] = []
    const relationships: GraphRelationship[] = []

    // Add Meeting node
    nodes.push({
      type: "Meeting",
      id: meetingId,
      properties: { title: meetingTitle, meetingId }
    })

    // Process each entity into nodes
    for (const entity of entities) {
      if (entity.type === "PERSON") {
        nodes.push({
          type: "Speaker",
          id: entity.normalizedValue,
          properties: { name: entity.value, meetingId }
        })
        relationships.push({
          source: entity.normalizedValue,
          target: meetingId,
          type: "SPOKE_IN",
          properties: { meetingId }
        })
      }

      if (entity.type === "ACTION_ITEM") {
        const metadata = entity.metadata as Record<string, unknown>
        nodes.push({
          type: "ActionItem",
          id: entity.normalizedValue,
          properties: { text: entity.value, meetingId }
        })

        // ActionItem → ASSIGNED_TO → Speaker
        if (metadata.assignedTo) {
          relationships.push({
            source: entity.normalizedValue,
            target: String(metadata.assignedTo),
            type: "ASSIGNED_TO",
            properties: { meetingId }
          })
        }

        // ActionItem → HAS_DEADLINE → Deadline
        if (metadata.deadline) {
          const deadlineId = `deadline_${String(metadata.deadline).replace(/-/g, "_")}`
          nodes.push({
            type: "Deadline",
            id: deadlineId,
            properties: { date: metadata.deadline, meetingId }
          })
          relationships.push({
            source: entity.normalizedValue,
            target: deadlineId,
            type: "HAS_DEADLINE",
            properties: { meetingId }
          })
        }
      }

      if (entity.type === "DECISION") {
        nodes.push({
          type: "Decision",
          id: entity.normalizedValue,
          properties: { text: entity.value, meetingId }
        })
        relationships.push({
          source: meetingId,
          target: entity.normalizedValue,
          type: "DECIDED_TO",
          properties: { meetingId }
        })
      }

      if (entity.type === "PROJECT") {
        nodes.push({
          type: "Project",
          id: entity.normalizedValue,
          properties: { name: entity.value, meetingId }
        })
      }

      if (entity.type === "TOPIC") {
        nodes.push({
          type: "Topic",
          id: entity.normalizedValue,
          properties: { name: entity.value, meetingId }
        })
        relationships.push({
          source: meetingId,
          target: entity.normalizedValue,
          type: "DISCUSSED",
          properties: { meetingId }
        })
      }
    }

    // Save to Neo4j using raw Cypher
    const neo4j = await getGraph()

    // Save nodes
    for (const node of nodes) {
      await neo4j.query(
        `MERGE (n:${node.type} {id: $id})
         SET n += $properties`,
        { id: node.id, properties: { ...node.properties, id: node.id } }
      )
    }

    // Save relationships
    for (const rel of relationships) {
      await neo4j.query(
        `MATCH (a {id: $sourceId})
         MATCH (b {id: $targetId})
         MERGE (a)-[r:${rel.type}]->(b)
         SET r += $properties`,
        {
          sourceId: rel.source,
          targetId: rel.target,
          properties: rel.properties || {}
        }
      )
    }

    console.log(`🕸️ Knowledge Graph Complete: ${nodes.length} nodes, ${relationships.length} relationships`)
    return { nodes, relationships, meetingId, extractedAt: new Date() }

  } catch (error) {
    console.error("❌ Knowledge Graph Extraction Failed:", error instanceof Error ? error.message : error)
    return null
  }
}

export async function queryGraphMemory(question: string): Promise<string> {
  try {
    if (!question?.trim()) return "Error: Please provide a valid question."

    console.log(`🔍 Graph Query: "${question}"`)
    const neo4jGraph = await getGraph()

    const chain = GraphCypherQAChain.fromLLM({
      llm: queryModel,
      graph: neo4jGraph,
    })

    const response = await chain.invoke({ query: question })
    console.log("✅ Graph Query Complete")

    if (response && typeof response === "object") {
      const r = response as Record<string, unknown>
      if ("text" in r && typeof r.text === "string") return r.text
      if ("output" in r) return String(r.output)
      if ("result" in r) return String(r.result)
    }

    return typeof response === "string" ? response : JSON.stringify(response)
  } catch (error) {
    console.error("❌ Graph Query Failed:", error instanceof Error ? error.message : error)
    return ""
  }
}

export async function clearGraph(): Promise<boolean> {
  try {
    const neo4jGraph = await getGraph()
    await neo4jGraph.query("MATCH (n) DETACH DELETE n")
    console.log("🧹 Graph cleared successfully")
    return true
  } catch (error) {
    console.error("❌ Failed to clear graph:", error)
    return false
  }
}

export async function deleteGraphForMeeting(meetingId: string): Promise<boolean> {
  try {
    const neo4jGraph = await getGraph()
    const result = await neo4jGraph.query(
      `MATCH (n {meetingId: $meetingId}) DETACH DELETE n RETURN count(n) as deletedCount`,
      { meetingId }
    )
    const deletedCount = (result as Array<Record<string, unknown>>)[0]?.deletedCount ?? 0
    console.log(`🧹 Deleted ${deletedCount} nodes for meeting ${meetingId}`)
    return true
  } catch (error) {
    console.error(`Failed to delete graph for meeting ${meetingId}:`, error)
    return false
  }
}

export async function getGraphStatistics(): Promise<Record<string, unknown>> {
  try {
    const neo4j = await getGraph()
    const nodeStats = await neo4j.query(
      `MATCH (n) RETURN labels(n)[0] as type, count(*) as count ORDER BY count DESC`
    )
    const relStats = await neo4j.query(
      `MATCH ()-[r]->() RETURN type(r) as type, count(*) as count ORDER BY count DESC`
    )
    const nodeResult = nodeStats as Array<Record<string, unknown>>
    const relResult = relStats as Array<Record<string, unknown>>
    return {
      nodesByType: Object.fromEntries(nodeResult.map((s) => [s.type, s.count])),
      relationshipsByType: Object.fromEntries(relResult.map((s) => [s.type, s.count])),
      totalNodes: nodeResult.reduce((sum, s) => sum + Number(s.count ?? 0), 0),
      totalRelationships: relResult.reduce((sum, s) => sum + Number(s.count ?? 0), 0),
    }
  } catch (error) {
    console.error("Failed to get graph statistics:", error)
    return {}
  }
}