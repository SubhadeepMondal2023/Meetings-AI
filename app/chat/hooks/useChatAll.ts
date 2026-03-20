import { useChatCore } from "@/app/hooks/chat/useChatCore"

const chatSuggestions = [
    "Who participated in the last meeting?",
    "What action items were assigned and to whom?",
    "What deadlines were discussed across all meetings?",
    "What decisions were made in recent meetings?",
    "Which topics were discussed most frequently?",
    "Summarize all meetings and their key outcomes"
]

export default function useChatAll() {
    const chat = useChatCore({
        apiEndpoint: '/api/rag/chat-all',
        getRequestBody: (input) => ({ question: input })
    })

    return {
        ...chat,
        chatSuggestions
    }
}