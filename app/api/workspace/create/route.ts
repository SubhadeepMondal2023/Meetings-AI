import { prisma } from "@/lib/db";
import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
    const { userId } = await auth();
    const user = await currentUser();
    const { name } = await req.json();

    if (!userId || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Transaction: Create Workspace AND add Creator as ADMIN
    const workspace = await prisma.$transaction(async (tx) => {
        const ws = await tx.workspace.create({
            data: { name }
        });

        await tx.workspaceMember.create({
            data: {
                userId,
                workspaceId: ws.id,
                role: "ADMIN"
            }
        });

        return ws;
    });

    return NextResponse.json(workspace);
}