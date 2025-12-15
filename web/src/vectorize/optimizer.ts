import {
  add,
  cross,
  distance,
  dot,
  magnitude,
  normalize,
  type Point,
  scale,
  subtract,
} from "./geometry.ts";
import { type Segment, type SimplifiedEdge } from "./simplifier.ts";

// Configuration
const CONFIG = {
  LEARNING_RATE: 0.05,
  ITERATIONS: 50,
  SPLIT_THRESHOLD: 0.7, // Max error to trigger split
  MERGE_THRESHOLD: 0.2, // Error increase allowed for merge
  ALIGNMENT_STRENGTH: 1.0, // Weight for axis alignment
  SMOOTHNESS_STRENGTH: 0.2, // Weight for tangent continuity
  FIDELITY_WEIGHT: 1.0,
};

export interface OptNode {
  x: number;
  y: number;
  fixed: boolean;
}

export interface OptSegment {
  startIdx: number; // Index into nodes array
  endIdx: number; // Index into nodes array
  sagitta: number; // Height of arc (0 = line)
  points: Point[]; // Original pixels
}

export function optimizeEdge(
  edge: SimplifiedEdge,
  initialSegments?: Segment[],
  onIteration?: (
    nodes: OptNode[],
    segments: OptSegment[],
    label: string,
  ) => void,
): SimplifiedEdge {
  // 1. Initialize Optimization Model
  let nodes: OptNode[] = [];
  let segments: OptSegment[] = [];

  if (initialSegments && initialSegments.length > 0) {
    // Initialize from existing segments
    // Add first node
    const firstP = initialSegments[0].start;
    nodes.push({ x: firstP.x, y: firstP.y, fixed: true });

    for (let i = 0; i < initialSegments.length; i++) {
      const seg = initialSegments[i];
      const endP = seg.end;

      // Add end node
      // Last node is fixed, intermediate nodes are free
      const isLast = i === initialSegments.length - 1;
      nodes.push({ x: endP.x, y: endP.y, fixed: isLast });

      // Use points directly from the segment
      const segmentPoints = seg.points;

      // Calculate initial sagitta
      let sagitta = 0;
      if (seg.type === "arc") {
        // Calculate sagitta from arc parameters
        // s = R - sqrt(R^2 - (L/2)^2)  (for small arcs)
        // or just distance from midpoint of chord to arc center minus radius?
        // Sagitta is signed distance from chord to arc.

        const chord = subtract(seg.end, seg.start);
        const chordLen = magnitude(chord);
        const midChord = scale(add(seg.start, seg.end), 0.5);

        // Vector from midChord to center
        const toCenter = subtract(seg.arc.center, midChord);
        const distToCenter = magnitude(toCenter);

        // Check if center is on the "left" or "right" of the chord
        // Cross product of chord and toCenter
        const cp = cross(chord, toCenter);

        // If arc is "small" (less than semicircle), sagitta has same sign as cross product?
        // Let's use the convention: sagitta is positive if arc is to the "left" of chord vector?
        // Our optimizer uses: center = midChord + (R-|s|) * (-sign(s)*normal)
        // where normal = (-dy, dx) / L.

        // Let's just estimate it numerically from the midpoint of the arc
        const midAngle = (seg.arc.startAngle + seg.arc.endAngle) / 2; // Careful with wrapping
        // Better: use the midpoint of the segment points
        if (segmentPoints.length > 0) {
          const midIdx = Math.floor(segmentPoints.length / 2);
          const pMid = segmentPoints[midIdx];
          // Distance from pMid to chord
          const d = Math.sqrt(
            distancePointToLineSegmentSq(pMid, seg.start, seg.end),
          );

          // Determine sign
          const normal = { x: chord.y, y: -chord.x };
          const toP = subtract(pMid, seg.start);
          const dotN = dot(toP, normal);
          sagitta = d * (dotN > 0 ? 1 : -1);
        }
      }

      segments.push({
        startIdx: i,
        endIdx: i + 1,
        sagitta: sagitta,
        points: segmentPoints,
      });
    }
  } else {
    // Create initial single segment
    const startP = edge.original.points[0];
    const endP = edge.original.points[edge.original.points.length - 1];

    nodes.push({ x: startP.x, y: startP.y, fixed: true });
    nodes.push({ x: endP.x, y: endP.y, fixed: true });

    segments.push({
      startIdx: 0,
      endIdx: 1,
      sagitta: 0,
      points: edge.original.points,
    });
  }

  if (onIteration) {
    onIteration(
      JSON.parse(JSON.stringify(nodes)),
      JSON.parse(JSON.stringify(segments)),
      "Initial",
    );
  }

  // 2. Iterative Refinement Loop
  let changed = true;
  let loopCount = 0;

  while (changed && loopCount < 5) {
    changed = false;
    loopCount++;

    // A. Optimize Parameters (Gradient Descent)
    optimizeParameters(nodes, segments);
    if (onIteration) {
      onIteration(
        JSON.parse(JSON.stringify(nodes)),
        JSON.parse(JSON.stringify(segments)),
        `Iteration ${loopCount} - Optimized`,
      );
    } // B. Split Pass
    const newSegments: OptSegment[] = [];
    let splitOccurred = false;

    for (const seg of segments) {
      const maxErr = getMaxError(seg, nodes);
      if (maxErr > CONFIG.SPLIT_THRESHOLD && seg.points.length > 4) {
        // Split at max error point
        const splitRes = splitSegment(seg, nodes);
        newSegments.push(splitRes.left);
        newSegments.push(splitRes.right);
        splitOccurred = true;
        changed = true;
      } else {
        newSegments.push(seg);
      }
    }
    segments = newSegments;

    if (splitOccurred) {
      if (onIteration) {
        onIteration(
          JSON.parse(JSON.stringify(nodes)),
          JSON.parse(JSON.stringify(segments)),
          `Iteration ${loopCount} - Split`,
        );
      }
      // Re-optimize after split
      optimizeParameters(nodes, segments);
      if (onIteration) {
        onIteration(
          JSON.parse(JSON.stringify(nodes)),
          JSON.parse(JSON.stringify(segments)),
          `Iteration ${loopCount} - Re-optimized`,
        );
      }
    }

    // C. Merge Pass (TODO: Implement if needed, for now split-only + optimize is powerful)
    // Merging is tricky with the node indices.
    // For the L-shape case, splitting is the key.
    // Merging helps if we over-split.
  }

  // Final Polish
  optimizeParameters(nodes, segments);
  if (onIteration) {
    onIteration(
      JSON.parse(JSON.stringify(nodes)),
      JSON.parse(JSON.stringify(segments)),
      "Final",
    );
  }

  return {
    original: edge.original,
    segments: convertToSegments(nodes, segments),
  };
}

function optimizeParameters(nodes: OptNode[], segments: OptSegment[]) {
  for (let iter = 0; iter < CONFIG.ITERATIONS; iter++) {
    // Calculate Gradients
    const nodeGrads = nodes.map(() => ({ x: 0, y: 0 }));
    const sagittaGrads = segments.map(() => 0);

    // 1. Fidelity Gradients
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const pStart = nodes[seg.startIdx];
      const pEnd = nodes[seg.endIdx];

      // Numerical gradient for sagitta
      const h = 0.1;
      const errBase = getSegmentError(seg, pStart, pEnd, seg.sagitta);
      const errPlus = getSegmentError(seg, pStart, pEnd, seg.sagitta + h);
      sagittaGrads[i] += (errPlus - errBase) / h * CONFIG.FIDELITY_WEIGHT;

      // Numerical gradient for nodes (if not fixed)
      if (!pStart.fixed) {
        const pStartX = { ...pStart, x: pStart.x + h };
        const errX = getSegmentError(seg, pStartX, pEnd, seg.sagitta);
        nodeGrads[seg.startIdx].x += (errX - errBase) / h *
          CONFIG.FIDELITY_WEIGHT;

        const pStartY = { ...pStart, y: pStart.y + h };
        const errY = getSegmentError(seg, pStartY, pEnd, seg.sagitta);
        nodeGrads[seg.startIdx].y += (errY - errBase) / h *
          CONFIG.FIDELITY_WEIGHT;
      }

      if (!pEnd.fixed) {
        const pEndX = { ...pEnd, x: pEnd.x + h };
        const errX = getSegmentError(seg, pStart, pEndX, seg.sagitta);
        nodeGrads[seg.endIdx].x += (errX - errBase) / h *
          CONFIG.FIDELITY_WEIGHT;

        const pEndY = { ...pEnd, y: pEnd.y + h };
        const errY = getSegmentError(seg, pStart, pEndY, seg.sagitta);
        nodeGrads[seg.endIdx].y += (errY - errBase) / h *
          CONFIG.FIDELITY_WEIGHT;
      }
    }

    // 2. Alignment Gradients (Axis snapping)
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const pStart = nodes[seg.startIdx];
      const pEnd = nodes[seg.endIdx];
      const h = 0.1;

      // Only apply if sagitta is small (line-like)
      if (Math.abs(seg.sagitta) < 1.0) {
        const dx = pEnd.x - pStart.x;
        const dy = pEnd.y - pStart.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 1e-4) {
          // Cost = sin^2(2*angle) ? No, we want 0, 90, 180, 270.
          // sin(angle) is 0 at 0, 180. cos(angle) is 0 at 90, 270.
          // Cost = (dx/len)^2 * (dy/len)^2  <-- 0 if horizontal (dy=0) or vertical (dx=0)
          // This is sin^2 * cos^2 = (1/4)sin^2(2*theta)

          // Let's use numerical gradient for simplicity
          const costBase = alignmentCost(pStart, pEnd);

          if (!pStart.fixed) {
            const costX = alignmentCost({ ...pStart, x: pStart.x + h }, pEnd);
            nodeGrads[seg.startIdx].x += (costX - costBase) / h *
              CONFIG.ALIGNMENT_STRENGTH;
            const costY = alignmentCost({ ...pStart, y: pStart.y + h }, pEnd);
            nodeGrads[seg.startIdx].y += (costY - costBase) / h *
              CONFIG.ALIGNMENT_STRENGTH;
          }
          if (!pEnd.fixed) {
            const costX = alignmentCost(pStart, { ...pEnd, x: pEnd.x + h });
            nodeGrads[seg.endIdx].x += (costX - costBase) / h *
              CONFIG.ALIGNMENT_STRENGTH;
            const costY = alignmentCost(pStart, { ...pEnd, y: pEnd.y + h });
            nodeGrads[seg.endIdx].y += (costY - costBase) / h *
              CONFIG.ALIGNMENT_STRENGTH;
          }
        }
      }
    }

    // Apply Gradients
    for (let i = 0; i < nodes.length; i++) {
      if (!nodes[i].fixed) {
        nodes[i].x -= nodeGrads[i].x * CONFIG.LEARNING_RATE;
        nodes[i].y -= nodeGrads[i].y * CONFIG.LEARNING_RATE;
      }
    }
    for (let i = 0; i < segments.length; i++) {
      segments[i].sagitta -= sagittaGrads[i] * CONFIG.LEARNING_RATE;

      // Limit sagitta to half chord length (180 degrees max)
      const start = nodes[segments[i].startIdx];
      const end = nodes[segments[i].endIdx];
      const chordLen = distance(start, end);
      const maxSagitta = chordLen / 2 * 0.9999; // Slightly less than half to avoid singularity

      if (segments[i].sagitta > maxSagitta) segments[i].sagitta = maxSagitta;
      if (segments[i].sagitta < -maxSagitta) segments[i].sagitta = -maxSagitta;
    }
  }
}

function alignmentCost(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return 0;
  // (dx*dy / lenSq)^2 is minimized when dx=0 or dy=0
  return Math.pow((dx * dy) / lenSq, 2) * 100; // Scale up
}

function getSegmentError(
  seg: OptSegment,
  start: Point,
  end: Point,
  sagitta: number,
): number {
  let error = 0;
  // Pre-calculate arc parameters
  const chord = subtract(end, start);
  const chordLen = magnitude(chord);
  if (chordLen < 1e-6) return 0;

  const midChord = scale(add(start, end), 0.5);
  const normal = { x: chord.y / chordLen, y: -chord.x / chordLen };
  const arcMid = add(midChord, scale(normal, sagitta));

  // If sagitta is small, use line distance
  if (Math.abs(sagitta) < 0.1) {
    for (const p of seg.points) {
      error += distancePointToLineSegmentSq(p, start, end);
    }
  } else {
    // Arc distance
    // Find center and radius
    // R^2 = (L/2)^2 + (R-s)^2  => R^2 = L^2/4 + R^2 - 2Rs + s^2 => 2Rs = L^2/4 + s^2 => R = (L^2/4 + s^2) / (2s)
    const R = (Math.pow(chordLen / 2, 2) + sagitta * sagitta) /
      (2 * Math.abs(sagitta));
    const centerDist = R - Math.abs(sagitta); // Distance from chord to center
    // Center is along normal direction (flipped if sagitta < 0?)
    // If sagitta > 0, center is "below" chord (away from arcMid).
    // Wait, if sagitta > 0, arcMid is at +s*normal. Center is at (R-s)*(-normal) ?
    // Let's use geometric construction.
    // Center is at midChord + (R - |s|) * (-sign(s) * normal)
    const center = add(
      midChord,
      scale(normal, (R - Math.abs(sagitta)) * (sagitta > 0 ? -1 : 1)),
    );

    for (const p of seg.points) {
      const d = Math.abs(distance(p, center) - R);
      error += d * d;
    }
  }
  return error;
}

function getMaxError(seg: OptSegment, nodes: OptNode[]): number {
  const start = nodes[seg.startIdx];
  const end = nodes[seg.endIdx];
  let maxErr = 0;

  // Re-calculate geometry
  const chord = subtract(end, start);
  const chordLen = magnitude(chord);
  if (chordLen < 1e-6) return 0;

  const midChord = scale(add(start, end), 0.5);
  const normal = { x: chord.y / chordLen, y: -chord.x / chordLen };

  if (Math.abs(seg.sagitta) < 0.1) {
    for (const p of seg.points) {
      const d = Math.sqrt(distancePointToLineSegmentSq(p, start, end));
      if (d > maxErr) maxErr = d;
    }
  } else {
    const R = (Math.pow(chordLen / 2, 2) + seg.sagitta * seg.sagitta) /
      (2 * Math.abs(seg.sagitta));
    const center = add(
      midChord,
      scale(normal, (R - Math.abs(seg.sagitta)) * (seg.sagitta > 0 ? -1 : 1)),
    );
    for (const p of seg.points) {
      const d = Math.abs(distance(p, center) - R);
      if (d > maxErr) maxErr = d;
    }
  }
  return maxErr;
}

function splitSegment(
  seg: OptSegment,
  nodes: OptNode[],
): { left: OptSegment; right: OptSegment } {
  // Find split point (max error point)
  const start = nodes[seg.startIdx];
  const end = nodes[seg.endIdx];
  let maxErr = -1;
  let splitIdx = -1;

  // Re-calculate geometry for distance check
  const chord = subtract(end, start);
  const chordLen = magnitude(chord);
  const midChord = scale(add(start, end), 0.5);
  const normal = { x: chord.y / chordLen, y: -chord.x / chordLen };
  let center = { x: 0, y: 0 };
  let R = 0;
  const isLine = Math.abs(seg.sagitta) < 0.1;

  if (!isLine) {
    R = (Math.pow(chordLen / 2, 2) + seg.sagitta * seg.sagitta) /
      (2 * Math.abs(seg.sagitta));
    center = add(
      midChord,
      scale(normal, (R - Math.abs(seg.sagitta)) * (seg.sagitta > 0 ? -1 : 1)),
    );
  }

  for (let i = 0; i < seg.points.length; i++) {
    const p = seg.points[i];
    let d = 0;
    if (isLine) {
      d = Math.sqrt(distancePointToLineSegmentSq(p, start, end));
    } else {
      d = Math.abs(distance(p, center) - R);
    }

    if (d > maxErr) {
      maxErr = d;
      splitIdx = i;
    }
  }

  // Create new node
  const splitPoint = seg.points[splitIdx];
  const newNodeIdx = nodes.length;
  nodes.push({ x: splitPoint.x, y: splitPoint.y, fixed: false });

  const leftPoints = seg.points.slice(0, splitIdx + 1);
  const rightPoints = seg.points.slice(splitIdx);

  return {
    left: {
      startIdx: seg.startIdx,
      endIdx: newNodeIdx,
      sagitta: seg.sagitta / 2, // Initial guess
      points: leftPoints,
    },
    right: {
      startIdx: newNodeIdx,
      endIdx: seg.endIdx,
      sagitta: seg.sagitta / 2, // Initial guess
      points: rightPoints,
    },
  };
}

function distancePointToLineSegmentSq(p: Point, a: Point, b: Point): number {
  const l2 = distanceSquared(a, b);
  if (l2 === 0) return distanceSquared(p, a);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const proj = {
    x: a.x + t * (b.x - a.x),
    y: a.y + t * (b.y - a.y),
  };
  return distanceSquared(p, proj);
}

function distanceSquared(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return dx * dx + dy * dy;
}

export function convertToSegments(
  nodes: OptNode[],
  optSegments: OptSegment[],
): Segment[] {
  return optSegments.map((seg) => {
    const start = nodes[seg.startIdx];
    const end = nodes[seg.endIdx];

    if (Math.abs(seg.sagitta) < 1.0) {
      return {
        type: "line",
        start: { x: start.x, y: start.y },
        end: { x: end.x, y: end.y },
        points: seg.points,
        line: {
          point: { x: start.x, y: start.y },
          direction: normalize(subtract(end, start)),
        },
      };
    } else {
      // Convert to Arc
      const chord = subtract(end, start);
      const chordLen = magnitude(chord);

      if (chordLen < 1e-6) {
        // Fallback to line (point) to avoid NaN if start ~= end
        return {
          type: "line",
          start: { x: start.x, y: start.y },
          end: { x: end.x, y: end.y },
          points: seg.points,
          line: {
            point: { x: start.x, y: start.y },
            direction: { x: 1, y: 0 },
          },
        };
      }

      const R = (Math.pow(chordLen / 2, 2) + seg.sagitta * seg.sagitta) /
        (2 * Math.abs(seg.sagitta));
      const midChord = scale(add(start, end), 0.5);
      const normal = { x: chord.y / chordLen, y: -chord.x / chordLen };
      const center = add(
        midChord,
        scale(normal, (R - Math.abs(seg.sagitta)) * (seg.sagitta > 0 ? -1 : 1)),
      );

      // Calculate angles
      const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
      const endAngle = Math.atan2(end.y - center.y, end.x - center.x);

      return {
        type: "arc",
        start: { x: start.x, y: start.y },
        end: { x: end.x, y: end.y },
        points: seg.points,
        arc: {
          center,
          radius: R,
          startAngle,
          endAngle,
          clockwise: seg.sagitta > 0, // Convention: positive sagitta = CW (Bulge Right relative to chord)
        },
      };
    }
  });
}
