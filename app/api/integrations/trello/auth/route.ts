import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function GET() {
    const { userId } = await auth()

    if (!userId) {
        return NextResponse.redirect(new URL('/sign-in', process.env.NEXT_PUBLIC_APP_URI))
    }

    const apiKey = process.env.TRELLO_API_KEY
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URI}/integrations/trello/callback`

    const authUrl = `https://trello.com/1/authorize?expiration=never&scope=read,write&response_type=token&key=${apiKey}&return_url=${encodeURIComponent(redirectUri)}`

    return NextResponse.redirect(authUrl)
}