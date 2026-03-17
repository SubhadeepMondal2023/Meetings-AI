'use client'

import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Loader2, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-muted-foreground">
      Loading Graph Engine...
    </div>
  ),
});

type GraphNode = {
  id: string;
  label: string;
  type: string;
  color: string;
  x?: number;
  y?: number;
};

type GraphLink = {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
  label: string;
  color: string;
};

type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
};

export default function GraphVisualization() {
  const [data, setData] = useState<GraphData>({ nodes: [], links: [] });
  const [loading, setLoading] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<any>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 500 });
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/graph/visualize');
      const graphData = await res.json();
      if (graphData.nodes && graphData.links) {
        setData(graphData);
      }
    } catch (error) {
      console.error('Failed to load graph', error);
    } finally {
      setLoading(false);
    }
  };

  // Responsive: measure container and re-measure on resize
  useEffect(() => {
    const measure = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight || 500,
        });
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    fetchData();
  }, []);

  // After data loads, zoom to fit all nodes
  useEffect(() => {
    if (data.nodes.length > 0 && fgRef.current) {
      setTimeout(() => fgRef.current?.zoomToFit(400, 40), 500);
    }
  }, [data]);

  // -------------------------------------------------------------------------
  // nodeCanvasObject: draw BOTH the circle and the label.
  // The original code only drew text — the circle node disappeared entirely.
  // -------------------------------------------------------------------------
  const drawNode = useCallback((node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const radius = 6;

    // Circle fill
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, radius, 0, 2 * Math.PI);
    ctx.fillStyle = node.color || '#10b981';
    ctx.fill();

    // Subtle ring
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 0.8 / globalScale;
    ctx.stroke();

    // Highlight ring when hovered
    if (hoveredNode?.id === node.id) {
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, radius + 3 / globalScale, 0, 2 * Math.PI);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 / globalScale;
      ctx.stroke();
    }
  }, [hoveredNode]);

  // -------------------------------------------------------------------------
  // linkCanvasObject: draw the LINE + label.
  // The original code drew only the label — edges were invisible.
  // ForceGraph2D skips its own line rendering when you provide this callback,
  // so you must draw the line yourself.
  // -------------------------------------------------------------------------
  const drawLink = useCallback((link: GraphLink, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const start = link.source as GraphNode;
    const end   = link.target as GraphNode;
    if (!start?.x || !end?.x) return;

    const color = link.color || '#475569';

    // Line
    ctx.beginPath();
    ctx.moveTo(start.x, start.y ?? 0);
    ctx.lineTo(end.x, end.y ?? 0);
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.8 / globalScale;
    ctx.stroke();
  }, []);

  return (
    <div className="flex flex-col h-full bg-card border border-border rounded-xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className="p-4 border-b border-border flex justify-between items-center bg-muted/30 shrink-0">
        <h3 className="font-semibold text-lg flex items-center gap-2">
          Knowledge Graph
          <span className="text-xs font-normal text-muted-foreground bg-background px-2 py-0.5 rounded-full border">
            {data.nodes.length} Nodes · {data.links.length} Edges
          </span>
        </h3>
        <Button variant="ghost" size="icon" onClick={fetchData} disabled={loading}>
          <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Canvas container */}
      <div
        ref={containerRef}
        className="flex-1 relative bg-slate-950"
        onMouseMove={(e) => {
          const rect = containerRef.current?.getBoundingClientRect();
          if (rect) setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        }}
        onMouseLeave={() => setHoveredNode(null)}
      >
        {/* Loading overlay */}
        {loading && data.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-slate-950/80">
            <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
          </div>
        )}

        {data.nodes.length > 0 && (
          <ForceGraph2D
            ref={fgRef}
            width={dimensions.width}
            height={dimensions.height}
            graphData={data}
            // Node rendering
            nodeCanvasObject={(node, ctx, globalScale) =>
              drawNode(node as GraphNode, ctx, globalScale)
            }
            nodeCanvasObjectMode={() => 'replace'}
            nodePointerAreaPaint={(node, color, ctx) => {
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc((node as GraphNode).x ?? 0, (node as GraphNode).y ?? 0, 8, 0, 2 * Math.PI);
              ctx.fill();
            }}
            nodeLabel=""  // disable built-in browser tooltip — we render our own
            onNodeHover={(node) => setHoveredNode(node as GraphNode | null)}
            // Link rendering
            linkCanvasObject={(link, ctx, globalScale) =>
              drawLink(link as GraphLink, ctx, globalScale)
            }
            linkCanvasObjectMode={() => 'replace'} // We own the full link draw
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={1}
            linkDirectionalArrowColor={(link) => (link as GraphLink).color || '#475569'}
            // Interaction
            enableNodeDrag
            enablePanInteraction
            enableZoomInteraction
            backgroundColor="#020617"
            onEngineStop={() => fgRef.current?.zoomToFit(400, 40)}
          />
        )}

        {/* Empty state */}
        {!loading && data.nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-muted-foreground text-sm">
              No graph data available. Process a meeting first.
            </p>
          </div>
        )}

        {/* Neo4j-style hover card */}
        {hoveredNode && (
          <div
            className="absolute z-20 pointer-events-none"
            style={{
              left:  mousePos.x > dimensions.width  - 280 ? mousePos.x - 280 : mousePos.x + 16,
              top:   mousePos.y > dimensions.height - 140 ? mousePos.y - 120 : mousePos.y - 12,
            }}
          >
            <div
              className="rounded-xl border border-slate-700 bg-slate-900 shadow-2xl overflow-hidden"
              style={{ minWidth: 200, maxWidth: Math.min(360, dimensions.width - 40) }}
            >
              {/* Type badge row */}
              <div className="px-4 pt-3 pb-2">
                <span
                  className="inline-block text-xs font-semibold px-3 py-0.5 rounded-full"
                  style={{
                    backgroundColor: hoveredNode.color + '28', // 16% alpha
                    color: hoveredNode.color,
                    border: `1px solid ${hoveredNode.color}55`,
                  }}
                >
                  {hoveredNode.type}
                </span>
              </div>

              {/* Divider */}
              <div className="border-t border-slate-700/60" />

              {/* Property row — key + full value, wraps naturally */}
              <div className="px-4 py-3 flex flex-col gap-0.5">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide leading-none">
                  id
                </span>
                <span className="text-sm text-slate-100 font-medium leading-snug break-words">
                  {hoveredNode.label}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Legend */}
        {data.nodes.length > 0 && (
          <div className="absolute bottom-3 left-3 flex flex-col gap-3 bg-slate-900/90 border border-slate-700/60 rounded-xl p-3 text-xs text-slate-300 pointer-events-none w-44">
            {/* Node types */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Nodes</span>
              {[
                { label: 'Action / Task', color: '#10b981' },
                { label: 'Person',        color: '#3b82f6' },
                { label: 'Decision',      color: '#06b6d4' },
                { label: 'Deadline',      color: '#f59e0b' },
                { label: 'Project',       color: '#a855f7' },
                { label: 'Risk',          color: '#ef4444' },
              ].map(({ label, color }) => (
                <div key={label} className="flex items-center gap-2">
                  <span style={{ background: color }} className="w-2.5 h-2.5 rounded-full shrink-0" />
                  <span>{label}</span>
                </div>
              ))}
            </div>

            {/* Divider */}
            <div className="border-t border-slate-700/60" />

            {/* Edge types */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Edges</span>
              {[
                { label: 'Assigned To',  color: '#10b981' },
                { label: 'Has Deadline', color: '#f59e0b' },
                { label: 'Decided To',   color: '#8b5cf6' },
                { label: 'Discussed',    color: '#06b6d4' },
                { label: 'Has Risk',     color: '#ef4444' },
                { label: 'Works On',     color: '#a855f7' },
                { label: 'Depends On',   color: '#ec4899' },
                { label: 'Impacts',      color: '#14b8a6' },
              ].map(({ label, color }) => (
                <div key={label} className="flex items-center gap-2">
                  {/* Dash line indicator */}
                  <svg width="18" height="8" className="shrink-0">
                    <line x1="0" y1="4" x2="12" y2="4" stroke={color} strokeWidth="1.5"/>
                    <polygon points="12,1 18,4 12,7" fill={color}/>
                  </svg>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}