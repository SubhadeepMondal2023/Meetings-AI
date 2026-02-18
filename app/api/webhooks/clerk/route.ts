import { prisma } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { Webhook } from 'svix';
import { WebhookEvent } from '@clerk/nextjs/server';

export async function POST(request: NextRequest) {
    try {
        // Get the raw body as text
        const payload = await request.text();
        
        // Get the headers
        const headers = {
            'svix-id': request.headers.get('svix-id') || '',
            'svix-timestamp': request.headers.get('svix-timestamp') || '',
            'svix-signature': request.headers.get('svix-signature') || '',
        };

        console.log('📥 Webhook received');
        console.log('Headers:', headers);

        // Verify the webhook signature
        const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
        
        if (!webhookSecret) {
            console.error('❌ CLERK_WEBHOOK_SECRET is not set');
            return NextResponse.json(
                { error: 'Webhook secret not configured' }, 
                { status: 500 }
            );
        }

        let event: WebhookEvent;

        try {
            const wh = new Webhook(webhookSecret);
            event = wh.verify(payload, headers) as WebhookEvent;
            console.log('✅ Webhook signature verified');
        } catch (err) {
            console.error('❌ Webhook signature verification failed:', err);
            return NextResponse.json(
                { error: 'Invalid webhook signature' }, 
                { status: 400 }
            );
        }

        console.log('📋 Event type:', event.type);
        console.log('📋 Event data:', JSON.stringify(event.data, null, 2));

        // Handle user.created event
        if (event.type === 'user.created') {
            const { id, email_addresses, first_name, last_name, image_url } = event.data;
            
            console.log('👤 Processing user.created event');
            console.log('User ID:', id);
            console.log('Email addresses:', email_addresses);

            // Find the primary email
            const primaryEmail = email_addresses?.find(
                (email: any) => email.id === event.data.primary_email_address_id
            )?.email_address;

            if (!primaryEmail) {
                console.error('❌ No primary email found');
                return NextResponse.json(
                    { error: 'No primary email found' }, 
                    { status: 400 }
                );
            }

            console.log('📧 Primary email:', primaryEmail);

            // Create user in database
            try {
                const newUser = await prisma.user.create({
                    data: {
                        id: id,
                        clerkId: id,
                        email: primaryEmail,
                        name: first_name && last_name 
                            ? `${first_name} ${last_name}`.trim() 
                            : first_name || last_name || null,
                        botImageUrl: image_url || null,
                    }
                });

                console.log('✅ User created successfully in database');
                console.log('User details:', {
                    id: newUser.id,
                    clerkId: newUser.clerkId,
                    email: newUser.email,
                    name: newUser.name
                });

                return NextResponse.json({ 
                    message: "User created successfully",
                    userId: newUser.id 
                }, { status: 200 });

            } catch (dbError: any) {
                console.error('❌ Database error:', dbError);
                
                // Check if user already exists
                if (dbError.code === 'P2002') {
                    console.log('⚠️ User already exists in database');
                    return NextResponse.json({ 
                        message: "User already exists" 
                    }, { status: 200 });
                }

                return NextResponse.json(
                    { error: 'Failed to create user in database', details: dbError.message }, 
                    { status: 500 }
                );
            }
        }

        // Handle user.updated event
        if (event.type === 'user.updated') {
            const { id, email_addresses, first_name, last_name, image_url } = event.data;
            
            console.log('👤 Processing user.updated event');

            const primaryEmail = email_addresses?.find(
                (email: any) => email.id === event.data.primary_email_address_id
            )?.email_address;

            try {
                const updatedUser = await prisma.user.update({
                    where: {
                        clerkId: id
                    },
                    data: {
                        email: primaryEmail || undefined,
                        name: first_name && last_name 
                            ? `${first_name} ${last_name}`.trim() 
                            : first_name || last_name || undefined,
                        botImageUrl: image_url || undefined,
                    }
                });

                console.log('✅ User updated successfully');
                return NextResponse.json({ 
                    message: "User updated successfully",
                    userId: updatedUser.id 
                }, { status: 200 });

            } catch (dbError: any) {
                console.error('❌ Failed to update user:', dbError);
                return NextResponse.json(
                    { error: 'Failed to update user', details: dbError.message }, 
                    { status: 500 }
                );
            }
        }

        // Handle user.deleted event
        if (event.type === 'user.deleted') {
            const { id } = event.data;
            
            console.log('👤 Processing user.deleted event');

            try {
                await prisma.user.delete({
                    where: {
                        clerkId: id as string
                    }
                });

                console.log('✅ User deleted successfully');
                return NextResponse.json({ 
                    message: "User deleted successfully" 
                }, { status: 200 });

            } catch (dbError: any) {
                console.error('❌ Failed to delete user:', dbError);
                return NextResponse.json(
                    { error: 'Failed to delete user', details: dbError.message }, 
                    { status: 500 }
                );
            }
        }

        // For other event types
        console.log('ℹ️ Unhandled event type:', event.type);
        return NextResponse.json({ 
            message: 'Webhook received but not processed',
            eventType: event.type 
        }, { status: 200 });

    } catch (error: any) {
        console.error('❌ Webhook error:', error);
        return NextResponse.json(
            { 
                error: 'Webhook processing failed', 
                details: error.message 
            }, 
            { status: 500 }
        );
    }
}