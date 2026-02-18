import { prisma } from '@/lib/db'
import { auth, currentUser } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2024-06-20',
    typescript: true,
})

export async function POST(request: NextRequest) {
    try {
        const { userId } = await auth()
        const user = await currentUser()

        if (!userId || !user) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
        }

        const { priceId, planName } = await request.json()

        if (!priceId) {
            return NextResponse.json({ error: 'Price ID is required' }, { status: 400 })
        }

        // 1. Safe URL Handling
        let appUrl = process.env.NEXT_PUBLIC_APP_URI || process.env.NEXT_PUBLIC_APP_URI || 'http://localhost:3000';
        if (appUrl.endsWith('/')) appUrl = appUrl.slice(0, -1);

        // 2. Get User from DB
        let dbUser = await prisma.user.findUnique({
            where: { clerkId: userId }
        })

        if (!dbUser) {
            dbUser = await prisma.user.create({
                data: {
                    id: userId,
                    clerkId: userId,
                    email: user.primaryEmailAddress?.emailAddress || '',
                    name: user.fullName || 'User'
                }
            })
        }

        // 3. Handle Stripe Customer ID (With Validation)
        let stripeCustomerId = dbUser.stripeCustomerId

        // If we have an ID, check if it actually exists in the CURRENT Stripe environment (Test/Live)
        if (stripeCustomerId) {
            try {
                const existingCustomer = await stripe.customers.retrieve(stripeCustomerId)
                if (existingCustomer.deleted) {
                    stripeCustomerId = null // ID exists but was deleted in Stripe
                }
            } catch (error) {
                console.log("⚠️ Stale Stripe Customer ID found. Generating new one...")
                stripeCustomerId = null // ID doesn't exist in this environment (e.g. switched Live -> Test)
            }
        }

        // If ID is missing or invalid, create a new one
        if (!stripeCustomerId) {
            const customer = await stripe.customers.create({
                email: user.primaryEmailAddress?.emailAddress,
                name: user.fullName || undefined,
                metadata: {
                    clerkUserId: userId,
                    dbUserId: dbUser.id
                }
            })

            stripeCustomerId = customer.id

            await prisma.user.update({
                where: { id: dbUser.id },
                data: { stripeCustomerId }
            })
        }

        // 4. Create Session
        const session = await stripe.checkout.sessions.create({
            customer: stripeCustomerId,
            payment_method_types: ['card'],
            line_items: [
                {
                    price: priceId,
                    quantity: 1
                }
            ],
            mode: 'subscription',
            success_url: `${appUrl}/home?success=true`,
            cancel_url: `${appUrl}/pricing`,
            metadata: {
                clerkUserId: userId,
                dbUserId: dbUser.id,
                planName
            }
        })

        return NextResponse.json({ url: session.url })

    } catch (error: any) {
        console.error('❌ Stripe Checkout Error:', error)
        return NextResponse.json({ 
            error: 'Failed to create checkout session', 
            details: error.message 
        }, { status: 500 })
    }
}