import Groq from "groq-sdk"

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY! })

export async function createEmbedding(text: string): Promise<number[]> {
    const embeddings = await createManyEmbeddings([text])
    return embeddings[0] || []
}

export async function createManyEmbeddings(texts: string[]): Promise<number[][]> {
    const response = await fetch("https://api.cohere.com/v2/embed", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.COHERE_API_KEY}`
        },
        body: JSON.stringify({
            texts,
            model: "embed-english-light-v3.0",
            input_type: "search_document",
            embedding_types: ["float"]
        })
    })
    const data = await response.json()
    console.log("🔍 Cohere response:", JSON.stringify(data).substring(0, 200))
    return data?.embeddings?.float || []
}

export async function chatWithAI(systemPrompt: string, userQuestion: string): Promise<string> {
    const response = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userQuestion }
        ],
        temperature: 0.7,
        max_tokens: 500,
    })
    return response.choices[0]?.message?.content || "Sorry, I could not generate a response."
}