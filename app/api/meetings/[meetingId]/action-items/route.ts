import { prisma } from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ meetingId: string }> }
) {

    try {
        const { userId } = await auth()

        if (!userId) {
            return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
        }

        const { text } = await request.json()
        const { meetingId } = await params
        
        // 1. Find User (Need DB ID, not Clerk ID)
        const user = await prisma.user.findUnique({
            where: { clerkId: userId }
        })

        if (!user) {
            return NextResponse.json({ error: 'user not found' }, { status: 404 })
        }

        // 2. Find Meeting (Using createdById instead of userId)
        const meeting = await prisma.meeting.findFirst({
            where: {
                id: meetingId,
                createdById: user.id // ✅ FIXED: Changed from userId to createdById
            }
        })

        if (!meeting) {
            return NextResponse.json({ error: 'meeting not found' }, { status: 404 })
        }

        const existingItems = meeting.actionItems as any[] || []
        const nextId = existingItems.length > 0
            ? Math.max(...existingItems.map((item: any) => item.id || 0)) + 1
            : 1

        const newActionItem = {
            id: nextId,
            text
        }

        const updatedActionItems = [...existingItems, newActionItem]

        await prisma.meeting.update({
            where: {
                id: meetingId
            },
            data: {
                actionItems: updatedActionItems
            }
        })

        return NextResponse.json(newActionItem)
    } catch (error) {
        console.error('error adding action item', error)
        return NextResponse.json({ error: 'internal error' }, { status: 500 })
    }
}