import { prisma } from "@/lib/db";
import { canUserChat, incrementChatUsage } from "@/lib/usage";
import { auth } from "@clerk/nextjs/server";
import { error } from "console";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
    try {
        const { userId } = await auth()
        if (!userId) {
            return NextResponse.json({ error: 'Not authed' }, { status: 401 })
        }

        // 🎯 OPTIMIZED: Single query instead of 3
        const user = await prisma.user.findUnique({
            where: {
                clerkId: userId
            },
            select: {
                id: true,
                currentPlan: true,
                subscriptionStatus: true,
                chatMessagesToday: true
            }
        })

        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 })
        }

        // Check limits without extra DB query
        const PLAN_LIMITS: Record<string, number> = {
            free: 0,
            starter: 30,
            pro: 100,
            premium: -1
        }

        const limit = PLAN_LIMITS[user.currentPlan] || 0;

        if (user.currentPlan === 'free' || user.subscriptionStatus !== 'active') {
            return NextResponse.json({
                error: 'Upgrade your plan to chat with our AI bot',
                upgradeRequired: true
            }, { status: 403 })
        }

        if (limit !== -1 && user.chatMessagesToday >= limit) {
            return NextResponse.json({
                error: `You've reached your daily limit of ${limit} messages`,
                upgradeRequired: true
            }, { status: 403 })
        }

        // Single increment operation
        await prisma.user.update({
            where: { id: user.id },
            data: {
                chatMessagesToday: {
                    increment: 1
                }
            }
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        return NextResponse.json({ error: 'failed to increment usage' }, { status: 500 })
    }
}