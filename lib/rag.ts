import { prisma } from "./db";
import { chatWithAI, createEmbedding, createManyEmbeddings } from "./openai";
import { saveManyVectors, searchVectors } from "./pinecone";
import { chunkTranscript, extractSpeaker } from "./text-chunker";
import { queryGraphMemory } from "./graph"; 
export async function processTranscript(
    meetingId: string,
    userId: string,
    transcript: string,
    meetingTitle?: string
) {
    const chunks = chunkTranscript(transcript)
    const texts = chunks.map(chunk => chunk.content)
    const embeddings = await createManyEmbeddings(texts)

    const dbChunks = chunks.map((chunk) => ({
        meetingId,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        speakerName: extractSpeaker(chunk.content),
        vectorId: `${meetingId}_chunk_${chunk.chunkIndex}`
    }))

    await prisma.transcriptChunk.createMany({
        data: dbChunks,
        skipDuplicates: true
    })

    const vectors = chunks.map((chunk, index) => ({
        id: `${meetingId}_chunk_${chunk.chunkIndex}`,
        embedding: embeddings[index],
        metadata: {
            meetingId,
            userId,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            speakerName: extractSpeaker(chunk.content),
            meetingTitle: meetingTitle || 'Untitled Meeting'
        }
    }))

    await saveManyVectors(vectors)
}

export async function chatWithMeeting(
    userId: string,
    meetingId: string,
    question: string
) {
    const questionEmbedding = await createEmbedding(question)

    const results = await searchVectors(
        questionEmbedding,
        { userId, meetingId },
        5
    )

    const meeting = await prisma.meeting.findUnique({
        where: { id: meetingId }
    })

    const context = results
        .map(result => {
            const speaker = result.metadata?.speakerName || 'Unknown'
            const content = result.metadata?.content || ''
            return `${speaker}: ${content}`
        })
        .join('\n\n')

    const systemPrompt = `You are helping someone understand their meeting.
    Meeting: ${meeting?.title || 'Untitled Meeting'}
    Date: ${meeting?.createdAt ? new Date(meeting.createdAt).toDateString() : 'Unknown'}

    Here's what was discussed:
    ${context}

    Answer the user's question based only on the meeting content above. If the answer isn't in the meeting, say so`

    const answer = await chatWithAI(systemPrompt, question)

    return {
        answer,
        sources: results.map(result => ({
            meetingId: result.metadata?.meetingId,
            content: result.metadata?.content,
            speakerName: result.metadata?.speakerName,
            confidence: result.score
        }))
    }
}

// ---------------------------------------------------------
// 🧠 UPGRADED: HYBRID GLOBAL SEARCH (Graph + Vector)
// ---------------------------------------------------------
export async function chatWithAllMeetings(
    userId: string,
    question: string
) {
    // 1. Parallel Execution: Run Vector Search AND Graph Search at the same time
    const [questionEmbedding, graphKnowledge] = await Promise.all([
        createEmbedding(question),
        queryGraphMemory(question) // Query Neo4j
    ]);

    // 2. Vector Search Results (Unstructured Text)
    const vectorResults = await searchVectors(
        questionEmbedding,
        { userId },
        8
    )

    const vectorContext = vectorResults
        .map(result => {
            const meetingTitle = result.metadata?.meetingTitle || 'Untitled Meeting'
            const speaker = result.metadata?.speakerName || 'Unknown'
            const content = result.metadata?.content || ''
            return `[Meeting: ${meetingTitle}] ${speaker}: ${content}`
        })
        .join('\n\n')

    // 3. Construct the "Super Context"
    const systemPrompt = `You are an advanced AI assistant with access to the user's corporate memory.
    
    You have two sources of information:
    
    --- SOURCE 1: KNOWLEDGE GRAPH (Structured Facts) ---
    ${graphKnowledge ? graphKnowledge : "No direct relationships found in the graph."}
    
    --- SOURCE 2: TRANSCRIPT FRAGMENTS (Discussion Context) ---
    ${vectorContext}

    INSTRUCTIONS:
    1. Use the "Knowledge Graph" to identify specific entities, roles, and relationships (e.g. who manages whom, who owns what project).
    2. Use the "Transcripts" to understand the nuance, context, and discussions around those entities.
    3. Synthesize both sources to answer the user's question accurately.
    4. If the sources conflict, prioritize the Transcript as it is the raw record.
    `

    console.log("🧠 Hybrid Context Built. Sending to LLM...");

    const answer = await chatWithAI(systemPrompt, question)

    return {
        answer,
        // We return vector sources for UI citations, Graph sources are implicit in the answer
        sources: vectorResults.map(result => ({
            meetingId: result.metadata?.meetingId,
            meetingTitle: result.metadata?.meetingTitle,
            content: result.metadata?.content,
            speakerName: result.metadata?.speakerName,
            confidence: result.score
        }))
    }
}