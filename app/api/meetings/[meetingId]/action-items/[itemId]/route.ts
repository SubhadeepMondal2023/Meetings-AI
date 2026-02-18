import { prisma } from "@/lib/db";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ meetingId: string; itemId: string }> }
) {
    try {
        const { userId } = await auth()
        if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

        const { meetingId, itemId } = await params
        const itemIdNumber = parseInt(itemId) // or string depending on your model

        const user = await prisma.user.findUnique({ where: { clerkId: userId } })

        const meeting = await prisma.meeting.findFirst({
            where: {
                id: meetingId,
                createdById: user?.id // ✅ Changed
            }
        })

        if (!meeting) return NextResponse.json({ error: 'meeting not found' }, { status: 404 })

        // ... (Keep existing logic to update actionItems JSON) ...
        // Note: If you switched ActionItems to a separate table in new schema, 
        // you should use prisma.actionItem.delete() instead.
        // Assuming JSON for now based on your old code:
        
        const actionItems = (meeting.actionItems as any[]) || []
        const updatedActionItems = actionItems.filter((item: any) => item.id !== itemIdNumber)

        await prisma.meeting.update({
            where: { id: meetingId },
            data: { actionItems: updatedActionItems }
        })

        return NextResponse.json({ success: true })

    } catch (error) {
        console.error('error deleting action item:', error)
        return NextResponse.json({ error: 'internal error' }, { status: 500 })
    }
}