'use client'

import React from 'react'
import { useMeetings } from './hooks/useMeetings' 
import { useRouter } from 'next/navigation'
import PastMeetings from './components/PastMeetings'
import UpcomingMeetings from './components/UpcomingMeetings'
import GraphVisualization from '@/components/GraphVisualization' // 👈 IMPORT THIS

function Home() {
    const {
        userId,
        pastMeetings,
        pastLoading,
        getAttendeeList,
        getInitials
    } = useMeetings()

    const router = useRouter()
    
    const handleMeetingClick = (meetingId: string) => {
        router.push(`/meeting/${meetingId}`)
    }

    if (!userId) {
        return (
            <div className='flex items-center justify-center h-screen'>
                Loading...
            </div>
        )
    }

    return (
        <div className='min-h-screen bg-background p-6'>
            
            {/* 1. 🕸️ KNOWLEDGE GRAPH SECTION (NEW) */}
            <div className="mb-8">
                <GraphVisualization />
            </div>

            <div className='flex gap-6'>
                {/* 2. Left Side: Past Meetings */}
                <div className='flex-1'>
                    <div className='mb-6'>
                        <h2 className='text-2xl font-bold text-foreground'>
                            Past Meetings
                        </h2>
                    </div>
                    <PastMeetings
                        pastMeetings={pastMeetings}
                        pastLoading={pastLoading}
                        onMeetingClick={handleMeetingClick}
                        getAttendeeList={getAttendeeList}
                        getInitials={getInitials}
                    />
                </div>

                <div className='w-px bg-border'></div>

                {/* 3. Right Side: Upcoming Meetings */}
                <div className='w-96'>
                    <div className='sticky top-6'>
                        <UpcomingMeetings />
                    </div>
                </div>
            </div>
        </div>
    )
}

export default Home