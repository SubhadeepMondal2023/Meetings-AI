import { prisma } from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ meetingId: string }> }
) {
    try {
        const { userId: clerkUserId } = await auth()
        const { meetingId } = await params

        // 1. Find the User first (to check ownership)
        const user = await prisma.user.findUnique({
            where: { clerkId: clerkUserId! }
        })

        if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

        // 2. Find Meeting using NEW schema fields
        const meeting = await prisma.meeting.findUnique({
            where: { id: meetingId },
            include: {
                createdBy: { // Changed from 'user' to 'createdBy'
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        clerkId: true
                    }
                }
            }
        })

        if (!meeting) {
            return NextResponse.json({ error: 'meeting not found' }, { status: 404 })
        }

        const responseData = {
            ...meeting,
            // Check ownership via 'createdBy' relation
            isOwner: user.id === meeting.createdById 
        }

        return NextResponse.json(responseData)
    } catch (error) {
        console.error('api error:', error)
        return NextResponse.json({ error: 'failed to fetch meeting' }, { status: 500 })
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ meetingId: string }> }
) {
    try {
        const { userId: clerkUserId } = await auth()
        if (!clerkUserId) return NextResponse.json({ error: 'not authenticated' }, { status: 401 })

        const { meetingId } = await params

        const user = await prisma.user.findUnique({
            where: { clerkId: clerkUserId }
        })

        const meeting = await prisma.meeting.findUnique({
            where: { id: meetingId }
        })

        if (!meeting) return NextResponse.json({ error: 'meeting not found' }, { status: 404 })

        // Check ownership
        if (meeting.createdById !== user?.id) {
            return NextResponse.json({ error: 'not authorized' }, { status: 403 })
        }

        await prisma.meeting.delete({
            where: { id: meetingId }
        })

        return NextResponse.json({ success: true })

    } catch (error) {
        console.error('failed to delete meeting', error)
        return NextResponse.json({ error: 'failed to delete meeting' }, { status: 500 })
    }
}