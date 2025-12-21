import type { Graph, GraphEdge } from "./tracer.ts";
import type { Arc, Circle, Line, Point } from "./geometry.ts";
import { distance } from "./geometry.ts";
import { optimizeWithCutPoints } from "./cutPointOptimizer/index.ts"; // Import new optimizer

export type Segment =
  | { type: "line"; line: Line; start: Point; end: Point; points: Point[] }
  | { type: "arc"; arc: Arc; start: Point; end: Point; points: Point[] }
  | { type: "circle"; circle: Circle; points: Point[] };

export interface SimplifiedEdge {
  original: GraphEdge;
  segments: Segment[];
}

export interface SimplifiedGraph {
  nodes: Graph["nodes"];
  edges: SimplifiedEdge[];
}

/**
 * Simplifies the edges in the graph into geometric segments (lines and arcs).
 */
export function simplifyGraph(
  graph: Graph,
): SimplifiedGraph {
  const simplifiedEdges: SimplifiedEdge[] = [];

  for (const edge of graph.edges) {
    if (edge.points.length < 2) {
      continue;
    }

    const isClosedLoop = distance(edge.points[0], edge.points[edge.points.length - 1]) < 2.0;

    // Use the new cut point optimizer.
    const finalSegments = optimizeWithCutPoints(edge.points, isClosedLoop);

    const simplified: SimplifiedEdge = {
      original: edge,
      segments: finalSegments,
    };
    simplifiedEdges.push(simplified);
  }

  return {
    nodes: graph.nodes,
    edges: simplifiedEdges,
  };
}