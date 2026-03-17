import GraphVisualization from "@/components/GraphVisualization";

export default function GraphPage() {
  return (
    <div className="flex flex-col h-full p-6 gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Knowledge Graph</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Visual map of entities, actions, and relationships extracted from your meetings.
        </p>
      </div>
      <div className="flex-1 min-h-0">
        <GraphVisualization />
      </div>
    </div>
  );
}