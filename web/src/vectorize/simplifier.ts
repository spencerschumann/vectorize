import type { Graph, GraphEdge } from "./tracer.ts";
import type { Arc, Circle, Line, Point } from "./geometry.ts";
import { distance } from "./geometry.ts";
import { optimizeEdge } from "./optimizer.ts";
import { IncrementalLineFit } from "./line_fit.ts";
import { fitCircle, IncrementalCircleFit, percentile } from "./arc_fit.ts";

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

function segmentEdge(points: Point[]): Segment[] {
  const segments: Segment[] = [];
  let startIndex = 0;
  // Use median + percentile thresholds to encourage longer segments
  const MEDIAN_TOLERANCE = 1.5; // Median error threshold (allows for pixel aliasing)
  const P90_TOLERANCE = 3.0; // 90th percentile threshold

  // Check for closed loop - if start and end are very close, try fitting a circle first
  const isClosedLoop = points.length >= 10 &&
    distance(points[0], points[points.length - 1]) < 2.0;

  if (isClosedLoop) {
    const circleFit = fitCircle(points);
    if (circleFit) {
      const p90 = percentile(circleFit.errors, 0.9);
      if (circleFit.medianError <= MEDIAN_TOLERANCE && p90 <= P90_TOLERANCE) {
        // Good circle fit! Return single circle segment
        return [{
          type: "circle",
          circle: circleFit.circle,
          points: points,
        }];
      }
    }
  }

  while (startIndex < points.length - 1) {
    let bestEndIndex = startIndex + 1;
    let bestType: "line" | "arc" = "line";
    let bestLineFit = null;
    let bestArcFit = null;

    const lineFit = new IncrementalLineFit();
    const arcFit = new IncrementalCircleFit();

    // Add first point
    lineFit.addPoint(points[startIndex]);
    arcFit.addPoint(points[startIndex]);

    // Try to extend as far as possible
    for (let i = startIndex + 1; i < points.length; i++) {
      const p = points[i];
      lineFit.addPoint(p);
      arcFit.addPoint(p);

      const count = i - startIndex + 1;

      let lValid = false;
      let aValid = false;
      let lFit = null;
      let aFit = null;

      // Check Line Fit
      if (count >= 2) {
        lFit = lineFit.getFit();
        if (lFit) {
          const p90 = percentile(lFit.errors, 0.9);
          if (lFit.medianError <= MEDIAN_TOLERANCE && p90 <= P90_TOLERANCE) {
            lValid = true;
          }
        }
      }

      // Check Arc Fit
      if (count >= 3) {
        aFit = arcFit.getFit();
        if (aFit) {
          const p90 = percentile(aFit.errors, 0.9);
          const errOk = aFit.medianError <= MEDIAN_TOLERANCE &&
            p90 <= P90_TOLERANCE;
          // For closed loops (sweep approaching 360°), limit to ~350° to leave room for closing
          // This avoids the degenerate case where start == end (zero chord length)
          const sweepOk = aFit.sweepAngle < 2 * Math.PI - 0.2; // ~350° max
          if (errOk && sweepOk) {
            aValid = true;
          }
        }
      }

      if (!lValid && !aValid) {
        // Both failed. The previous index was the last valid one.
        break;
      }

      // Current index is valid for at least one type
      bestEndIndex = i;

      if (lValid && aValid) {
        // Prefer line unless arc is significantly better
        if (aFit!.rmsError < lFit!.rmsError * 0.8) {
          bestType = "arc";
          bestArcFit = aFit;
          bestLineFit = null;
        } else {
          bestType = "line";
          bestLineFit = lFit;
          bestArcFit = null;
        }
      } else if (lValid) {
        bestType = "line";
        bestLineFit = lFit;
        bestArcFit = null;
      } else {
        bestType = "arc";
        bestArcFit = aFit;
        bestLineFit = null;
      }
    }

    // Create segment
    const startP = points[startIndex];
    const endP = points[bestEndIndex];
    const segmentPoints = points.slice(startIndex, bestEndIndex + 1);

    if (bestType === "line") {
      if (!bestLineFit) {
        const dx = endP.x - startP.x;
        const dy = endP.y - startP.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        bestLineFit = {
          line: { point: startP, direction: { x: dx / len, y: dy / len } },
          rmsError: 0,
          medianError: 0,
          count: 2,
          errors: [0, 0],
        };
      }

      segments.push({
        type: "line",
        line: bestLineFit!.line,
        start: startP,
        end: endP,
        points: segmentPoints,
      });
    } else {
      segments.push({
        type: "arc",
        arc: {
          center: bestArcFit!.circle.center,
          radius: bestArcFit!.circle.radius,
          startAngle: bestArcFit!.startAngle,
          endAngle: bestArcFit!.endAngle,
          clockwise: bestArcFit!.clockwise,
        },
        start: startP,
        end: endP,
        points: segmentPoints,
      });
    }

    startIndex = bestEndIndex;
  }

  return segments;
}

import type { OptNode, OptSegment } from "./optimizer.ts";

/**
 * Simplifies the edges in the graph into geometric segments (lines and arcs).
 */
export function simplifyGraph(
  graph: Graph,
  onIteration?: (
    edgeId: number,
    nodes: OptNode[],
    segments: OptSegment[],
    label: string,
  ) => void,
): SimplifiedGraph {
  const simplifiedEdges: SimplifiedEdge[] = [];

  for (const edge of graph.edges) {
    if (edge.points.length < 2) {
      continue;
    }

    // 1. Initial Greedy Pass
    const initialSegments = segmentEdge(edge.points);

    const initial: SimplifiedEdge = {
      original: edge,
      segments: initialSegments,
    };

    // 2. Optimization Pass
    const optimized = optimizeEdge(
      initial,
      initialSegments,
      (nodes, segments, label) => {
        if (onIteration) onIteration(edge.id, nodes, segments, label);
      },
    );
    simplifiedEdges.push(optimized);
  }

  return {
    nodes: graph.nodes,
    edges: simplifiedEdges,
  };
}
