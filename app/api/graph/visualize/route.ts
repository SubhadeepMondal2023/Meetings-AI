import { NextResponse } from "next/server";
import neo4j from "neo4j-driver";

export const dynamic = 'force-dynamic'; // Ensure it doesn't cache

export async function GET() {
    let driver;
    try {
        // 1. Connect to Neo4j using the official driver
        driver = neo4j.driver(
            process.env.NEO4J_URI!,
            neo4j.auth.basic(process.env.NEO4J_USERNAME!, process.env.NEO4J_PASSWORD!)
        );

        const session = driver.session();

        // 2. Run Query: Fetch all nodes and relationships (Limit 300 to prevent crashing browser)
        const result = await session.run(
            `MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 300`
        );

        // 3. Transform Data for React Force Graph
        // Format needed: { nodes: [{id: '1', label: 'Person'}], links: [{source: '1', target: '2'}] }
        const nodes = new Map();
        const links: any[] = [];

        result.records.forEach((record) => {
            const source = record.get('n'); // Source Node
            const target = record.get('m'); // Target Node
            const rel = record.get('r');    // Relationship

            // Helper to extract a unique ID (Neo4j objects are complex)
            // We try 'id' property -> 'name' property -> Neo4j internal ID
            const getValidId = (node: any) => {
                return node.properties.id || node.properties.name || node.identity.toString();
            };

            const sourceId = getValidId(source);
            const targetId = getValidId(target);

            // Add Nodes (De-duplicate using Map)
            if (!nodes.has(sourceId)) {
                nodes.set(sourceId, {
                    id: sourceId,
                    label: source.labels[0] || "Node",
                    ...source.properties
                });
            }
            if (!nodes.has(targetId)) {
                nodes.set(targetId, {
                    id: targetId,
                    label: target.labels[0] || "Node",
                    ...target.properties
                });
            }

            // Add Link
            links.push({
                source: sourceId,
                target: targetId,
                label: rel.type
            });
        });

        await session.close();

        return NextResponse.json({
            nodes: Array.from(nodes.values()),
            links: links
        });

    } catch (error: any) {
        console.error("❌ Graph Visualization Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    } finally {
        if (driver) await driver.close();
    }
}