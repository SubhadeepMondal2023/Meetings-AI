/**
 * API ROUTE: api/graph/visualize
 *
 * Uses neo4j-driver directly (not Neo4jGraph from LangChain).
 * Neo4jGraph is a RAG utility — it wraps Cypher for chain use,
 * not for raw graph data extraction. Use the driver for this.
 */

import { NextRequest, NextResponse } from "next/server";
import neo4j, { Driver, Integer } from "neo4j-driver";

// ============================================================================
// TYPES
// ============================================================================

type NodeType =
  | "Speaker" | "Person" | "ActionItem" | "Task" | "Deadline" | "Date"
  | "Project" | "Topic" | "Decision" | "Risk" | "Meeting" | "Outcome" | "Assumption";

type FormattedNode = {
  id: string;
  label: string;
  type: NodeType;
  color: string;
};

type FormattedLink = {
  source: string;
  target: string;
  type: string;
  label: string;
  color: string;
};

// ============================================================================
// COLOR MAPPING
// ============================================================================

const NODE_COLORS: Record<string, string> = {
  Speaker:    "#3b82f6",
  Person:     "#3b82f6",
  ActionItem: "#10b981",
  Actionitem: "#10b981",  // Neo4j label casing inconsistency — treat as same type
  Task:       "#10b981",
  Deadline:   "#f59e0b",
  Date:       "#f59e0b",
  Project:    "#a855f7",
  Topic:      "#ec4899",
  Decision:   "#06b6d4",
  Risk:       "#ef4444",
  Meeting:    "#8b5cf6",
  Outcome:    "#14b8a6",
  Assumption: "#64748b",
};

const EDGE_COLORS: Record<string, string> = {
  SPOKE_IN:    "#94a3b8",
  ASSIGNED_TO: "#10b981",
  HAS_DEADLINE:"#f59e0b",
  DISCUSSED:   "#06b6d4",
  WORKS_ON:    "#a855f7",
  HAS_RISK:    "#ef4444",
  DECIDED_TO:  "#8b5cf6",
  DEPENDS_ON:  "#ec4899",
  MENTIONS:    "#64748b",
  IMPACTS:     "#14b8a6",
};

const EDGE_LABELS: Record<string, string> = {
  SPOKE_IN:    "Spoke In",
  ASSIGNED_TO: "Assigned To",
  HAS_DEADLINE:"Has Deadline",
  DISCUSSED:   "Discussed",
  WORKS_ON:    "Works On",
  HAS_RISK:    "Has Risk",
  DECIDED_TO:  "Decided To",
  DEPENDS_ON:  "Depends On",
  MENTIONS:    "Mentions",
  IMPACTS:     "Impacts",
};

// ============================================================================
// NEO4J DRIVER (module-level singleton, safe for serverless)
// ============================================================================

let driver: Driver | null = null;

function getDriver(): Driver {
  if (!driver) {
    driver = neo4j.driver(
      process.env.NEO4J_URI!,
      neo4j.auth.basic(
        process.env.NEO4J_USERNAME!,
        process.env.NEO4J_PASSWORD!
      )
    );
  }
  return driver;
}

// neo4j-driver returns Integer objects for internal IDs — convert to string
function toId(value: unknown): string {
  if (value instanceof Integer) return value.toString();
  return String(value ?? "");
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

export async function GET(req: NextRequest) {
  const session = getDriver().session();

  try {
    const { searchParams } = new URL(req.url);
    const meetingId = searchParams.get("meetingId");

    // ------------------------------------------------------------------
    // Step 1: Fetch nodes
    // Filter by meetingId property if provided — label-based filtering
    // (your original approach) is unreliable; use a node property instead.
    // ------------------------------------------------------------------
    const nodeQuery = meetingId
      ? `
          MATCH (n)
          WHERE n.meetingId = $meetingId
          RETURN
            toString(id(n)) AS id,
            labels(n)[0]    AS type,
            properties(n)   AS props
          LIMIT 500
        `
      : `
          MATCH (n)
          RETURN
            toString(id(n)) AS id,
            labels(n)[0]    AS type,
            properties(n)   AS props
          LIMIT 500
        `;

    const nodeResult = await session.run(nodeQuery, meetingId ? { meetingId } : {});

    const nodes: FormattedNode[] = nodeResult.records
      .map((record) => {
        const id    = toId(record.get("id"));
        const type  = String(record.get("type") ?? "Unknown") as NodeType;
        const props = record.get("props") as Record<string, unknown> ?? {};

        // All nodes store their value under the "id" property (confirmed from schema)
        const rawName =
          type === "Meeting"
            ? (props.title ?? props.meetingTitle ?? props.id ?? `[${type}]`)  // ← show title for Meeting
            : (props.id ?? props.name ?? props.text ?? props.title ?? `[${type}]`)

        return {
          id,
          label: String(rawName).substring(0, 60),
          type,
          color: NODE_COLORS[type] ?? "#10b981",
        };
      })
      .filter((n) => n.id);

    // ------------------------------------------------------------------
    // Step 2: Fetch relationships
    // Only return edges whose endpoints are already in the node set.
    // This prevents ForceGraph2D from crashing on dangling references.
    // ------------------------------------------------------------------
    const nodeIds = new Set(nodes.map((n) => n.id));

    const linkQuery = meetingId
      ? `
          MATCH (a)-[r]->(b)
          WHERE a.meetingId = $meetingId
          RETURN
            toString(id(a)) AS source,
            toString(id(b)) AS target,
            type(r)         AS type
          LIMIT 1000
        `
      : `
          MATCH (a)-[r]->(b)
          RETURN
            toString(id(a)) AS source,
            toString(id(b)) AS target,
            type(r)         AS type
          LIMIT 1000
        `;

    const linkResult = await session.run(linkQuery, meetingId ? { meetingId } : {});

    const links: FormattedLink[] = linkResult.records
      .map((record) => {
        const source = toId(record.get("source"));
        const target = toId(record.get("target"));
        const type   = String(record.get("type") ?? "UNKNOWN");
        return {
          source,
          target,
          type,
          label: EDGE_LABELS[type] ?? type,
          color: EDGE_COLORS[type] ?? "#64748b",
        };
      })
      // Drop edges that reference nodes not in our result set
      .filter((l) => l.source && l.target && nodeIds.has(l.source) && nodeIds.has(l.target));

    return NextResponse.json({
      nodes,
      links,
      stats: {
        totalNodes: nodes.length,
        totalLinks: links.length,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Graph visualization failed:", error);
    return NextResponse.json(
      {
        nodes: [],
        links: [],
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  } finally {
    // Always close the session — never the driver (reused across requests)
    await session.close();
  }
}