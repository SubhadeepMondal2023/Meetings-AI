import { prisma } from "@/lib/db";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2025-08-27.basil',
    typescript: true,
})

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!

export async function POST(request: NextRequest) {
    try {
        const body = await request.text()
        const headersList = await headers()
        const sig = headersList.get('stripe-signature')!

        let event: Stripe.Event

        try {
            event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
        } catch (error) {
            console.error('webhok signature failed:', error)
            return NextResponse.json({ error: 'invalid signature' }, { status: 400 })
        }

        switch (event.type) {
            case 'customer.subscription.created':
                await handleSubscriptionCreated(event.data.object)
                break
            case 'customer.subscription.updated':
                await handleSubscriptionUpdated(event.data.object)
                break
            case 'customer.subscription.deleted':
                await handleSubscriptionCancelled(event.data.object)
                break
            case 'invoice.payment_succeeded':
                await handlePaymentSucceeded(event.data.object)
                break

            default:
                console.log(`unhandle type event: ${event.type}`)
        }

        return NextResponse.json({ received: true })
    } catch (error) {
        console.error('error handling subscription create:', error)
        return NextResponse.json({ error: 'webhook failed' }, { status: 500 })
    }
}

async function handleSubscriptionCreated(subscription: Stripe.Subscription) {
    try {
        const customerId = subscription.customer as string
        const planName = getPlanFromSubscription(subscription)

        console.log(`💳 Subscription Created - Customer: ${customerId}, Plan: ${planName}`);

        if (planName === 'invalid') {
            console.error('❌ Unknown price ID:', subscription.items.data[0]?.price.id);
            return;
        }

        const user = await prisma.user.findFirst({
            where: {
                stripeCustomerId: customerId
            }
        })

        if (!user) {
            console.error(`❌ User not found for customer: ${customerId}`);
            return;
        }

        console.log(`✅ Updating user ${user.id} to plan: ${planName}`);

        await prisma.user.update({
            where: {
                id: user.id
            },
            data: {
                currentPlan: planName,
                subscriptionStatus: 'active',
                stripeSubscriptionId: subscription.id,
                billingPeriodStart: new Date(),
                meetingsThisMonth: 0,
                chatMessagesToday: 0
            }
        })

        console.log(`✅ Subscription activated for ${user.id}: ${planName}`);
    } catch (error) {
        console.error('error handling subscription create:', error)
    }
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
    try {
        const user = await prisma.user.findFirst({
            where: {
                stripeSubscriptionId: subscription.id
            }
        })

        if (user) {
            const planName = getPlanFromSubscription(subscription)

            await prisma.user.update({
                where: {
                    id: user.id
                },
                data: {
                    currentPlan: planName,
                    subscriptionStatus: subscription.status === 'active' ? 'active' : 'cancelled'
                }
            })
        }
    } catch (error) {
        console.error('error handling subscription updated:', error)
    }
}

async function handleSubscriptionCancelled(subscription: Stripe.Subscription) {
    try {
        const user = await prisma.user.findFirst({
            where: {
                stripeSubscriptionId: subscription.id
            }
        })
        if (user) {
            await prisma.user.update({
                where: {
                    id: user.id
                },
                data: {
                    subscriptionStatus: 'cancelled'
                }
            })
        }
    } catch (error) {
        console.error('error handling subscription cancelleation:', error)
    }
}

async function handlePaymentSucceeded(invoice: Stripe.Invoice) {
    try {
        const subscriptionId = (invoice as Stripe.Invoice & { subscription?: string }).subscription as string | null

        console.log(`💰 Payment Succeeded - Subscription: ${subscriptionId}`);

        if (subscriptionId) {
            const user = await prisma.user.findFirst({
                where: {
                    stripeSubscriptionId: subscriptionId
                }
            })

            if (!user) {
                console.error(`❌ User not found for subscription: ${subscriptionId}`);
                return;
            }

            console.log(`✅ Activating subscription for user ${user.id}`);

            // Only reset monthly metrics and chat messages if we're starting a new billing period
            const billingPeriodStart = new Date();
            
            await prisma.user.update({
                where: {
                    id: user.id
                },
                data: {
                    subscriptionStatus: 'active',
                    billingPeriodStart,
                    meetingsThisMonth: 0,
                    chatMessagesToday: 0  // Reset daily chat counter on each billing cycle
                }
            })

            console.log(`✅ Payment processed for user ${user.id} on plan: ${user.currentPlan}`);
        } else {
            console.warn(`⚠️ Payment succeeded but no subscription ID found in invoice`);
        }
    } catch (error) {
        console.error('error handling payment success:', error)
    }
}




function getPlanFromSubscription(subscription: Stripe.Subscription) {
    const priceId = subscription.items.data[0]?.price.id
    const metadata = subscription.metadata as Record<string, string> || {}

    const priceToPlank: Record<string, string> = {
        'price_1T1R6RPZTA6eUT52JBGYgKDr': 'starter',
        'price_1T1R6cPZTA6eUT52sTegh3Yq': 'pro',
        'price_1T1R6kPZTA6eUT52seIHXZXg': 'premium'
    }

    // Try to get from price ID first
    if (priceId && priceToPlank[priceId]) {
        return priceToPlank[priceId]
    }

    // Fallback to metadata if price ID doesn't match
    if (metadata.planName && ['starter', 'pro', 'premium'].includes(metadata.planName)) {
        console.warn(`⚠️ Using metadata fallback for planName: ${metadata.planName}`);
        return metadata.planName
    }

    return 'invalid'
}