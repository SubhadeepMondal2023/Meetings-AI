"use client"

import React, { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Clock, RefreshCcw, Video } from 'lucide-react'
import { format } from 'date-fns'
import { toast } from "sonner" // CHANGED: Using Sonner directly

interface Meeting {
    id: string
    meetingId: string
    summary: string
    start: { dateTime: string }
    end: { dateTime: string }
    hangoutLink?: string
    location?: string
    botScheduled: boolean
    attendees?: any[]
}

export default function UpcomingMeetings() {
    const [meetings, setMeetings] = useState<Meeting[]>([])
    const [loading, setLoading] = useState(true)
    const [isRefreshing, setIsRefreshing] = useState(false)
    const [connected, setConnected] = useState(false)

    // 1. Fetch Function
    const fetchMeetings = async () => {
        try {
            setLoading(true)
            const res = await fetch("/api/meetings/upcoming")
            if (res.ok) {
                const data = await res.json()
                setMeetings(data.events || [])
                setConnected(data.connected)
            }
        } catch (error) {
            console.error("Failed to fetch meetings", error)
            toast.error("Failed to load meetings")
        } finally {
            setLoading(false)
            setIsRefreshing(false)
        }
    }

    // Initial Load
    useEffect(() => {
        fetchMeetings()
    }, [])

    const onRefresh = () => {
        setIsRefreshing(true)
        fetchMeetings()
    }

    // 2. Toggle Bot Function
    const handleBotToggle = async (meetingId: string, currentStatus: boolean) => {
        // Optimistic UI Update
        setMeetings((prev) =>
            prev.map((m) =>
                m.meetingId === meetingId ? { ...m, botScheduled: !currentStatus } : m
            )
        )

        try {
            const res = await fetch(`/api/meetings/${meetingId}/bot-toggle`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ botScheduled: !currentStatus }),
            })

            const data = await res.json()

            if (!res.ok) throw new Error(data.error || "Failed")

            // CHANGED: Sonner Toast Syntax
            toast.success(data.botScheduled ? "Bot Enabled 🤖" : "Bot Disabled", {
                description: data.message,
            })

        } catch (error) {
            // Revert UI if failed
            setMeetings((prev) =>
                prev.map((m) =>
                    m.meetingId === meetingId ? { ...m, botScheduled: currentStatus } : m
                )
            )
            toast.error("Could not update bot status")
        }
    }

    const handleConnectCalendar = () => {
        // Ensure this path matches your auth route
        window.location.href = '/api/auth/google' 
    }

    if (loading && !isRefreshing) {
        return (
            <div className='bg-card rounded-lg p-6 border border-border'>
                <div className='animate-pulse space-y-4'>
                    <div className='h-4 bg-muted rounded w-3/4'></div>
                    <div className='h-12 bg-muted rounded w-full'></div>
                    <div className='h-12 bg-muted rounded w-full'></div>
                </div>
            </div>
        )
    }

    return (
        <div className="h-full flex flex-col">
            <div className='flex justify-between items-center mb-6'>
                <h2 className='text-xl font-bold text-foreground'>Upcoming</h2>
                <div className="flex items-center gap-2">
                    <span className='text-sm text-muted-foreground'>({meetings.length})</span>
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={onRefresh} 
                        disabled={isRefreshing}
                        className="h-8 w-8 cursor-pointer"
                    >
                        <RefreshCcw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                    </Button>
                </div>
            </div>

            {!connected ? (
                <div className='bg-card rounded-lg p-6 text-center border border-border flex-1 flex flex-col items-center justify-center'>
                    <div className='w-12 h-12 mx-auto bg-primary/10 rounded-full flex items-center justify-center mb-3'>
                        📆
                    </div>
                    <h3 className='font-semibold mb-2 text-foreground text-sm'>Connect Calendar</h3>
                    <p className='text-muted-foreground mb-4 text-xs'>
                        Connect Google Calendar to see upcoming meetings
                    </p>
                    <Button
                        onClick={handleConnectCalendar}
                        className='px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm cursor-pointer'
                    >
                        Connect Google Calendar
                    </Button>
                </div>
            ) : meetings.length === 0 ? (
                <div className='bg-card rounded-lg p-6 text-center border border-border flex-1 flex flex-col items-center justify-center'>
                    <h3 className='font-medium mb-2 text-foreground text-sm'>
                        No upcoming meetings
                    </h3>
                    <p className='text-muted-foreground text-xs '>
                        Your calendar is clear!
                    </p>
                    <Button variant="outline" size="sm" onClick={onRefresh} className="mt-4">
                        Check again
                    </Button>
                </div>
            ) : (
                <div className='space-y-3 overflow-y-auto max-h-[500px] pr-2'>
                    {meetings.map((event) => (
                        <div key={event.id} className='bg-card rounded-lg p-3 border border-border hover:shadow-md transition-all relative group'>
                            
                            {/* Toggle Switch */}
                            <div className='absolute top-3 right-3 flex flex-col items-end gap-1'>
                                <Switch
                                    checked={event.botScheduled}
                                    onCheckedChange={() => handleBotToggle(event.meetingId, event.botScheduled)}
                                    aria-label='Toggle bot for this meeting'
                                    className='cursor-pointer'
                                />
                                <span className="text-[10px] text-muted-foreground">
                                    {event.botScheduled ? 'Rec On' : 'Rec Off'}
                                </span>
                            </div>

                            <h4 className='font-medium text-sm text-foreground mb-2 pr-14 truncate'>
                                {event.summary || 'No Title'}
                            </h4>
                            
                            <div className='space-y-1 text-xs text-muted-foreground'>
                                <div className='flex items-center gap-1'>
                                    <Clock className='w-3 h-3' />
                                    {format(new Date(event.start.dateTime), 'MMM d, h:mm a')}
                                </div>
                                {event.attendees && (
                                    <div>👥 {event.attendees.length} attendees</div>
                                )}
                            </div>

                            {(event.hangoutLink || event.location) && (
                                <div className="mt-3">
                                    <a
                                        href={event.hangoutLink || event.location || '#'}
                                        target='_blank'
                                        rel='noopener noreferrer'
                                        className='inline-flex items-center gap-2 px-3 py-1.5 bg-primary/10 text-primary hover:bg-primary/20 rounded-md text-xs font-medium transition-colors'
                                    >
                                        <Video className="w-3 h-3" />
                                        Join Meeting
                                    </a>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}