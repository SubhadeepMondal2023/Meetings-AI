import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

// 1. Define Protected Routes (User must be logged in)
const isProtectedRoute = createRouteMatcher([
    '/home(.*)', 
    '/dashboard(.*)', 
    '/meeting(.*)',
    '/settings(.*)',
    '/integrations(.*)'
])

// 2. Define Public Routes (Bot/Webhook must access these)
const isPublicRoute = createRouteMatcher([
    '/api/webhooks(.*)',  // 👈 CRITICAL: Explicitly allow the webhook
    '/sign-in(.*)', 
    '/sign-up(.*)',
    '/api/uploadthing(.*)' // (Optional: if you use file uploads)
])

export default clerkMiddleware(async (auth, req) => {
    const { userId, redirectToSignIn } = await auth()

    // 🔍 DEBUG LOGGER: This will tell us if the request is reaching your server
    console.log(`🔒 Middleware Check: ${req.method} ${req.nextUrl.pathname}`)

    // 3. Logic:
    // A. If it is a public route, let it pass immediately (Don't check auth)
    if (isPublicRoute(req)) {
        return NextResponse.next()
    }

    // B. If it is a protected route and user is NOT logged in, redirect
    if (!userId && isProtectedRoute(req)) {
        return redirectToSignIn()
    }

    // C. Default: Allow everything else
    return NextResponse.next()
})

export const config = {
    matcher: [
        '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
        '/(api|trpc)(.*)',
    ],
}