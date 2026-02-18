import { prisma } from "@/lib/db";

export async function checkPermission(userId: string, workspaceId: string, requiredRole: 'ADMIN' | 'MEMBER') {
    const membership = await prisma.workspaceMember.findUnique({
        where: {
            userId_workspaceId: {
                userId,
                workspaceId
            }
        }
    });

    if (!membership) return false;

    if (requiredRole === 'ADMIN' && membership.role !== 'ADMIN') return false;
    
    return true;
}