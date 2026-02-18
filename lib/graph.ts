import { ChatOpenAI } from "@langchain/openai";
import { LLMGraphTransformer } from "@langchain/community/experimental/graph_transformers/llm";
import { Neo4jGraph } from "@langchain/community/graphs/neo4j_graph";
import { Document } from "@langchain/core/documents";
import { GraphCypherQAChain } from "@langchain/community/chains/graph_qa/cypher";

// 1. Initialize the LLM (Use GPT-4o-mini for speed/cost, or GPT-4 for better accuracy)
const model = new ChatOpenAI({
  modelName: "gpt-4o-mini",
  temperature: 0,
  openAIApiKey: process.env.OPENAI_API_KEY,
});

// 2. Initialize the Graph Transformer
// This tells the AI specific things to look for, so the graph isn't messy
const transformer = new LLMGraphTransformer({
  llm: model,
  allowedNodes: ["Person", "Project", "Company", "Technology", "Risk", "Decision"],
  allowedRelationships: ["WORKS_ON", "MANAGED_BY", "MENTIONED", "HAS_RISK", "DECIDED_TO"],
});

// 3. Initialize Neo4j Connection
let graph: Neo4jGraph | null = null;

async function getGraph() {
  if (!graph) {
    graph = await Neo4jGraph.initialize({
      url: process.env.NEO4J_URI!,
      username: process.env.NEO4J_USERNAME!,
      password: process.env.NEO4J_PASSWORD!,
    });
  }
  return graph;
}

// ---------------------------------------------------------
// 🕸️ EXTRACT KNOWLEDGE GRAPH FROM TRANSCRIPT
// ---------------------------------------------------------
export async function addToKnowledgeGraph(transcript: any, meetingId: string, meetingTitle: string) {
  try {
    console.log("🕸️ Starting Graph Extraction...");

    // Convert your complex transcript object into a simple string for LangChain
    let textContent = "";
    if (Array.isArray(transcript)) {
      textContent = transcript
        .map((t: any) => `${t.speaker}: ${t.words.map((w: any) => w.word).join(" ")}`)
        .join("\n");
    } else if (typeof transcript === "string") {
      textContent = transcript;
    } else if (transcript.text) {
      textContent = transcript.text;
    }

    // Create a LangChain Document
    const documents = [
      new Document({
        pageContent: textContent,
        metadata: { meetingId, title: meetingTitle }, // Tag every node with this meeting ID
      }),
    ];

    // 4. Extract Graph Data (Nodes & Relationships)
    const graphDocuments = await transformer.convertToGraphDocuments(documents);

    // 5. Save to Neo4j
    const neo4j = await getGraph();
    await neo4j.addGraphDocuments(graphDocuments);

    console.log(`🕸️ Saved ${graphDocuments.length} graph structures to Neo4j`);
    return true;

  } catch (error) {
    console.error("❌ Graph Extraction Failed:", error);
    return false;
  }
}

// ---------------------------------------------------------
// 🔍 QUERY THE KNOWLEDGE GRAPH (HYBRID SEARCH)
// ---------------------------------------------------------
export async function queryGraphMemory(question: string) {
  try {
    console.log("🔍 Querying Knowledge Graph...");
    
    const neo4jGraph = await getGraph();
    
    // This Chain automatically:
    // 1. Converts user question to Cypher Query (SQL for Graphs)
    // 2. Runs it on Neo4j
    // 3. Returns the answer based on the data
    const chain = GraphCypherQAChain.fromLLM({
      llm: model,
      graph: neo4jGraph,
    });

    const response = await chain.invoke({ 
      query: question 
    });
    
    console.log("🕸️ Graph Query Result:", response);
    
    // Extract the text response
    if (response && response.text) {
      return response.text;
    }
    
    // The response might be an object or string depending on the result
    if (typeof response === 'string') {
      return response;
    }
    
    return JSON.stringify(response);

  } catch (error) {
    console.error("❌ Graph Query Failed (Falling back to vectors only):", error);
    return ""; // Return empty string so the app doesn't crash
  }
}

// ---------------------------------------------------------
// 🧹 OPTIONAL: CLEAR ALL GRAPH DATA (FOR TESTING)
// ---------------------------------------------------------
export async function clearGraph() {
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