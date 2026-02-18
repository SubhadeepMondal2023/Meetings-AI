'use client'

import React, { useMemo } from 'react'
import { useMeetingDetail } from './hooks/useMeetingDetail'
import MeetingHeader from './components/MeetingHeader'
import MeetingInfo from './components/MeetingInfo'
import { Button } from '@/components/ui/button'
import ActionItems from './components/action-items/ActionItems'
import TranscriptDisplay from './components/TranscriptDisplay'
import ChatSidebar from './components/ChatSidebar'
import CustomAudioPlayer from './components/AudioPlayer'
import { AlertTriangle } from 'lucide-react'
import { 
    AreaChart, 
    Area, 
    XAxis, 
    YAxis, 
    CartesianGrid, 
    Tooltip, 
    ResponsiveContainer, 
    ReferenceLine,
    Legend 
} from 'recharts'

// Distinct colors for different speakers
const SPEAKER_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

function MeetingDetail() {

    const {
        meetingId,
        isOwner,
        userChecked,
        chatInput,
        setChatInput,
        messages,
        showSuggestions,
        activeTab,
        setActiveTab,
        meetingData,
        loading,
        handleSendMessage,
        handleSuggestionClick,
        handleInputChange,
        deleteActionItem,
        addActionItem,
        displayActionItems,
        meetingInfoData
    } = useMeetingDetail()

    // 🧠 DYNAMIC SPEAKER EXTRACTION
    // This logic finds all unique keys (speakers) in your sentiment data
    // excluding 'timestamp' and 'name'.
    const sentimentSpeakers = useMemo(() => {
        if (!meetingData?.sentimentData || !Array.isArray(meetingData.sentimentData) || meetingData.sentimentData.length === 0) {
            return [];
        }
        const firstPoint = meetingData.sentimentData[0];
        return Object.keys(firstPoint).filter(key => key !== 'timestamp' && key !== 'name');
    }, [meetingData]);

    return (
        <div className='min-h-screen bg-background'>

            <MeetingHeader
                title={meetingData?.title || 'Meeting'}
                meetingId={meetingId}
                summary={meetingData?.summary}
                actionItems={meetingData?.actionItems?.map((item: any) => `• ${item.text}`).join('\n') || ''}
                isOwner={isOwner}
                isLoading={!userChecked}
            />
            <div className='flex h-[calc(100vh-73px)]'>
                <div className={`flex-1 p-6 overflow-auto pb-24 ${!userChecked
                    ? ''
                    : !isOwner
                        ? 'max-w-4xl mx-auto'
                        : ''
                    }`}>
                    <MeetingInfo meetingData={meetingInfoData} />

                    <div className='mb-8'>
                        <div className='flex border-b border-border'>
                            <Button
                                variant='ghost'
                                onClick={() => setActiveTab('summary')}
                                className={`px-4 py-2 text-sm font-medium border-b-2 rounded-none shadow-none transition-colors
                                ${activeTab === 'summary'
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/50'
                                }`}
                                style={{ boxShadow: 'none' }}
                                type='button'
                            >
                                Summary
                            </Button>
                            <Button
                                variant='ghost'
                                onClick={() => setActiveTab('transcript')}
                                className={`px-4 py-2 text-sm font-medium border-b-2 rounded-none shadow-none transition-colors
                                ${activeTab === 'transcript'
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/50'
                                }`}
                                style={{ boxShadow: 'none' }}
                                type='button'
                            >
                                Transcript
                            </Button>
                        </div>

                        <div className='mt-6'>
                            {activeTab === 'summary' && (
                                <div>
                                    {loading ? (
                                        <div className='bg-card border border-border rounded-lg p-6 text-center'>
                                            <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4'></div>
                                            <p className='text-muted-foreground'>Loading meeting data..</p>
                                        </div>
                                    ) : meetingData?.processed ? (
                                        <div className='space-y-6'>
                                            {/* 1. Standard Summary */}
                                            {meetingData.summary && (
                                                <div className='bg-card border border-border rounded-lg p-6'>
                                                    <h3 className='text-lg font-semibold text-foreground mb-3'>Meeting Summary</h3>
                                                    <p className='text-muted-foreground leading-relaxed'>
                                                        {meetingData.summary}
                                                    </p>
                                                </div>
                                            )}

                                            {/* 2. 🔥 The Devil's Advocate Analysis */}
                                            {(meetingData as any).riskAnalysis && (
                                                <div className="border-l-4 border-red-500 bg-red-50 dark:bg-red-950/10 p-6 rounded-r-lg shadow-sm">
                                                    <div className="flex items-center gap-2 mb-4">
                                                        <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
                                                        <h2 className="text-xl font-bold text-red-600 dark:text-red-400">The Devil's Advocate Analysis</h2>
                                                    </div>
                                                    
                                                    <div 
                                                        className="prose prose-sm max-w-none text-gray-700 dark:text-gray-300
                                                        prose-h3:text-lg prose-h3:font-semibold prose-h3:mt-4 prose-h3:mb-2
                                                        prose-ul:list-disc prose-ul:pl-5 prose-li:mb-1
                                                        prose-strong:font-bold prose-strong:text-foreground"
                                                        dangerouslySetInnerHTML={{ __html: (meetingData as any).riskAnalysis }} 
                                                    />
                                                    
                                                    <div className="mt-4 text-xs text-gray-400 italic border-t border-red-200 dark:border-red-900/30 pt-2">
                                                        * AI-generated risk assessment based on critical transcript analysis.
                                                    </div>
                                                </div>
                                            )}

                                            {/* 3. 📈 Advanced Sentiment Arc (Multi-Speaker) */}
                                            {(meetingData as any).sentimentData && (meetingData as any).sentimentData.length > 0 && (
                                                <div className="bg-card border border-border rounded-lg p-6">
                                                    <div className="flex items-center gap-2 mb-6">
                                                        <span className="text-2xl">❤️</span>
                                                        <div>
                                                            <h3 className="text-lg font-semibold text-foreground">Emotional Arc</h3>
                                                            <p className="text-xs text-muted-foreground">Sentiment tracking per speaker over time.</p>
                                                        </div>
                                                    </div>

                                                    <div className="h-[300px] w-full">
                                                        <ResponsiveContainer width="100%" height="100%">
                                                            <AreaChart data={(meetingData as any).sentimentData}>
                                                                <defs>
                                                                    {sentimentSpeakers.map((speaker, index) => (
                                                                        <linearGradient key={speaker} id={`color-${speaker}`} x1="0" y1="0" x2="0" y2="1">
                                                                            <stop offset="5%" stopColor={SPEAKER_COLORS[index % SPEAKER_COLORS.length]} stopOpacity={0.3}/>
                                                                            <stop offset="95%" stopColor={SPEAKER_COLORS[index % SPEAKER_COLORS.length]} stopOpacity={0}/>
                                                                        </linearGradient>
                                                                    ))}
                                                                </defs>
                                                                
                                                                <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                                                                <XAxis 
                                                                    dataKey="timestamp" 
                                                                    tickFormatter={(val) => `${Math.floor(val/60)}m`} 
                                                                    stroke="#888888" 
                                                                    fontSize={12}
                                                                />
                                                                <YAxis domain={[-1, 1]} hide />
                                                                
                                                                <Tooltip 
                                                                    contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }}
                                                                    itemStyle={{ color: '#fff' }}
                                                                    labelFormatter={(label) => `${Math.floor(Number(label)/60)}:00`}
                                                                />
                                                                
                                                                <Legend verticalAlign="top" height={36}/>
                                                                <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />

                                                                {/* 🎨 DYNAMICALLY RENDER LINES PER SPEAKER */}
                                                                {sentimentSpeakers.map((speaker, index) => (
                                                                    <Area 
                                                                        key={speaker}
                                                                        type="monotone" 
                                                                        dataKey={speaker} // Matches the JSON key (e.g., "Tarif")
                                                                        name={speaker}    // Shows in Legend
                                                                        stroke={SPEAKER_COLORS[index % SPEAKER_COLORS.length]} 
                                                                        strokeWidth={2}
                                                                        fill={`url(#color-${speaker})`} 
                                                                        connectNulls={true} // Connects lines if a speaker is silent for a bit
                                                                        fillOpacity={0.2}
                                                                    />
                                                                ))}
                                                            </AreaChart>
                                                        </ResponsiveContainer>
                                                    </div>
                                                </div>
                                            )}

                                            {!userChecked ? (
                                                <div className='bg-card border border-border rounded-lg p-6'>
                                                    <div className='animate-pulse'>
                                                        <div className='h-4 bg-muted rounded w-1/4 mb-4'></div>
                                                        <div className='space-y-2'>
                                                            <div className='h-3 bg-muted rounded w-3/4'></div>
                                                            <div className='h-3 bg-muted rounded w-1/2'></div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    {isOwner && displayActionItems.length > 0 && (
                                                        <ActionItems
                                                            actionItems={displayActionItems}
                                                            onDeleteItem={deleteActionItem}
                                                            onAddItem={addActionItem}
                                                            meetingId={meetingId}
                                                        />
                                                    )}

                                                    {!isOwner && displayActionItems.length > 0 && (
                                                        <div className='bg-card rounded-lg p-6 border border-border'>
                                                            <h3 className='text-lg font-semibold text-foreground mb-4'>
                                                                Action Items
                                                            </h3>
                                                            <div className='space-y-3'>
                                                                {displayActionItems.map((item) => (
                                                                    <div key={item.id} className='flex items-start gap-3'>
                                                                        <div className='w-2 h-2 rounded-full bg-primary mt-2 flex-shrink-0'></div>
                                                                        <p className='text-sm text-foreground'>{item.text}</p>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    ) : (
                                        <div className='bg-card border border-border rounded-lg p-6 text-center'>
                                            <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4'></div>
                                            <p className='text-muted-foreground'>Processing meeting with AI..</p>
                                            <p className='text-sm text-muted-foreground mt-2'>You'll receive an email when ready</p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {activeTab === 'transcript' && (
                                <div>
                                    {loading ? (
                                        <div className='bg-card border border-border rounded-lg p-6 text-center'>
                                            <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4'></div>
                                            <p className='text-muted-foreground'>Loading meeting data..</p>
                                        </div>
                                    ) : meetingData?.transcript ? (
                                        <TranscriptDisplay transcript={meetingData.transcript} />
                                    ) : (
                                        <div className='bg-card rounded-lg p-6 border border-border text-center'>
                                            <p className='text-muted-foreground'>No transcript available</p>
                                        </div>
                                    )}
                                </div>
                            )}

                        </div>

                    </div>

                </div>

                {!userChecked ? (
                    <div className='w-90 border-l border-border p-4 bg-card'>
                        <div className='animate-pulse'>
                            <div className='h-4 bg-muted rounded w-1/2 mb-4'></div>
                            <div className='space-y-3'>
                                <div className='h-8 bg-muted rounded'></div>
                                <div className='h-8 bg-muted rounded'></div>
                                <div className='h-8 bg-muted rounded'></div>
                            </div>
                        </div>
                    </div>
                ) : isOwner && (
                    <ChatSidebar
                        messages={messages}
                        chatInput={chatInput}
                        showSuggestions={showSuggestions}
                        onInputChange={handleInputChange}
                        onSendMessage={handleSendMessage}
                        onSuggestionClick={handleSuggestionClick}
                    />
                )}

            </div>

            <CustomAudioPlayer
                recordingUrl={meetingData?.recordingUrl}
                isOwner={isOwner}
            />
        </div>
    )
}

export default MeetingDetail