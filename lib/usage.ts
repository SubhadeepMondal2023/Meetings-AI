import { prisma } from "./db"

interface PlanLimits {
    meetings: number
    chatMessages: number
}

const PLAN_LIMITS: Record<string, PlanLimits> = {  
    free: { meetings: -1, chatMessages: -1 },  
    starter: { meetings: -1, chatMessages: -1 },  
    pro: { meetings: -1, chatMessages: -1 },  
    premium: { meetings: -1, chatMessages: -1 }  
}

export async function canUserSendBot(userId: string) {
    const user = await prisma.user.findUnique({
        where: { id: userId }
    })

    if (!user) {
        return { allowed: false, reason: 'User not found' }
    }

    return { allowed: true }
}

export async function canUserChat(userId: string) {
    const user = await prisma.user.findUnique({
        where: {
            id: userId
        }
    })

    if (!user) {
        return { allowed: false, reason: 'user not found' }
    }

    return { allowed: true }
}

export function getPlanLimits(plan: string): PlanLimits {
    return PLAN_LIMITS[plan] || PLAN_LIMITS.free
}