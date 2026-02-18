'use client'

import React, { useEffect, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Loader2, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { 
    ssr: false,
    loading: () => <div className="flex items-center justify-center h-full text-muted-foreground">Loading Graph Engine...</div>
});

export default function GraphVisualization() {
    const [data, setData] = useState({ nodes: [], links: [] });
    const [loading, setLoading] = useState(true);
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 800, height: 500 });

    const fetchData = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/graph/visualize');
            const graphData = await res.json();
            if (graphData.nodes) {
                setData(graphData);
            }
        } catch (error) {
            console.error("Failed to load graph", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        
        // Responsive sizing
        if (containerRef.current) {
            setDimensions({
                width: containerRef.current.offsetWidth,
                height: containerRef.current.offsetHeight
            });
        }
    }, []);

    return (
        <div className="flex flex-col h-full bg-card border border-border rounded-xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-border flex justify-between items-center bg-muted/30">
                <h3 className="font-semibold text-lg flex items-center gap-2">
                    🕸️ Knowledge Graph
                    <span className="text-xs font-normal text-muted-foreground bg-background px-2 py-0.5 rounded-full border">
                        {data.nodes.length} Nodes
                    </span>
                </h3>
                <Button variant="ghost" size="icon" onClick={fetchData} disabled={loading}>
                    <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                </Button>
            </div>

            <div ref={containerRef} className="flex-1 relative min-h-[500px] bg-slate-950">
                {loading && data.nodes.length === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center z-10 bg-slate-950/80">
                        <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
                    </div>
                )}
                
                <ForceGraph2D
                    width={dimensions.width}
                    height={500}
                    graphData={data}
                    nodeLabel="id"
                    nodeColor={node => {
                        // Custom colors based on Label
                        switch ((node as any).label) {
                            case 'Person': return '#3b82f6'; // Blue
                            case 'Project': return '#a855f7'; // Purple
                            case 'Technology': return '#f59e0b'; // Amber
                            case 'Risk': return '#ef4444'; // Red
                            default: return '#10b981'; // Emerald
                        }
                    }}
                    nodeRelSize={6}
                    linkColor={() => '#475569'} // Slate-600
                    linkDirectionalArrowLength={3.5}
                    linkDirectionalArrowRelPos={1}
                    backgroundColor="#020617" // Very dark slate (almost black)
                />
            </div>
        </div>
    );
}