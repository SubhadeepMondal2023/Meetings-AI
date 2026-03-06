import { prisma } from "@/lib/db";
import { currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function GET() {  
    try {  
        const user = await currentUser()  
        if (!user) {  
            return NextResponse.json({ error: 'unauthorized' }, { status: 401 })  
        }  
  
        const dbUser = await prisma.user.findFirst({  
            where: {  
                clerkId: user.id  
            }  
        })  
  
        const result = [{  
            platform: 'google-calendar',  
            name: 'Google Calendar',  
            logo: '📅',  
            connected: dbUser?.calendarConnected || false  
        }]  
  
        return NextResponse.json(result)  
    } catch (error) {  
        console.error('error fetching integration status:', error)  
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })  
    }  
}