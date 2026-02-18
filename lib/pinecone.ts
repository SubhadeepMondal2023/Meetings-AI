import { Pinecone } from '@pinecone-database/pinecone'

// Helper: Only connect to Pinecone when we actually need to use it
function getIndex() {
    if (!process.env.PINECONE_API_KEY) {
        throw new Error("PINECONE_API_KEY is missing in .env")
    }
    if (!process.env.PINECONE_INDEX_NAME) {
        throw new Error("PINECONE_INDEX_NAME is missing in .env")
    }

    const pinecone = new Pinecone({
        apiKey: process.env.PINECONE_API_KEY,
    })

    return pinecone.index(process.env.PINECONE_INDEX_NAME)
}

export async function saveManyVectors(vectors: Array<{
    id: string
    embedding: number[]
    metadata: any
}>) {
    // Initialize here (Runtime) instead of at the top (Build time)
    const index = getIndex()

    const upsertData = vectors.map(v => ({
        id: v.id,
        values: v.embedding,
        metadata: v.metadata
    }))

    await index.upsert(upsertData)
}

export async function searchVectors(
    embedding: number[],
    filter: any = {},
    topK: number = 5
) {
    // Initialize here (Runtime) instead of at the top (Build time)
    const index = getIndex()

    const result = await index.query({
        vector: embedding,
        filter,
        topK,
        includeMetadata: true
    })

    return result.matches || []
}