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
  LEARNING_RATE: 0.01,
  ITERATIONS: 50,
  SPLIT_THRESHOLD: 1.0, // Lower threshold to catch corners like L-shapes
  MERGE_THRESHOLD: 0.2,
  ALIGNMENT_STRENGTH: 0.5,
  SMOOTHNESS_STRENGTH: 0.2,
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
  sagittaPoint: Point; // Point on the curve at the "bulge" - defines the arc curvature
  points: Point[]; // Original pixels
}

/**
 * Compute circle center and radius from 3 points (start, sagittaPoint, end).
 * Returns null if points are collinear (line case).
 * Special case: if start == end (full circle), returns circle with sagittaPoint as diameter opposite.
 */
function circleFrom3Points(
  p1: Point,
  p2: Point,
  p3: Point,
): { center: Point; radius: number } | null {
  // Special case: full circle (p1 == p3)
  const startEndDist = distance(p1, p3);
  if (startEndDist < 1e-6) {
    // Full circle: p1 and p3 are the same point, p2 is the opposite point on the circle
    // Center is midpoint of p1 and p2, radius is half the distance
    const center = scale(add(p1, p2), 0.5);
    const radius = distance(p1, p2) / 2;
    if (radius < 1e-6) return null; // Degenerate
    return { center, radius };
  }

  // Check for collinearity using cross product
  const v1 = subtract(p2, p1);
  const v2 = subtract(p3, p1);
  const crossProd = cross(v1, v2);

  if (Math.abs(crossProd) < 1e-6) {
    return null; // Collinear - treat as line
  }

  // Circle through 3 points using perpendicular bisector intersection
  const ax = p1.x, ay = p1.y;
  const bx = p2.x, by = p2.y;
  const cx = p3.x, cy = p3.y;

  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-10) {
    return null;
  }

  const ux = ((ax * ax + ay * ay) * (by - cy) +
    (bx * bx + by * by) * (cy - ay) +
    (cx * cx + cy * cy) * (ay - by)) /
    d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) +
    (bx * bx + by * by) * (ax - cx) +
    (cx * cx + cy * cy) * (bx - ax)) /
    d;

  const center = { x: ux, y: uy };
  const radius = distance(center, p1);

  return { center, radius };
}

/**
 * Compute the signed sagitta (scalar) from start, sagittaPoint, end.
 * This is used for determining if segment is line-like.
 */
function computeSagitta(start: Point, sagittaPoint: Point, end: Point): number {
  const chord = subtract(end, start);
  const chordLen = magnitude(chord);
  if (chordLen < 1e-6) {
    // start == end (closed loop) - sagitta is distance to sagittaPoint
    return distance(start, sagittaPoint);
  }

  const midChord = scale(add(start, end), 0.5);
  const toSagitta = subtract(sagittaPoint, midChord);

  // Normal to chord (pointing "left")
  const normal = { x: -chord.y / chordLen, y: chord.x / chordLen };
  // Signed distance along normal
  return dot(toSagitta, normal);
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

  // Determine if the edge is a closed loop
  const startP = edge.original.points[0];
  const endP = edge.original.points[edge.original.points.length - 1];
  const isClosed = distance(startP, endP) < 1e-4;

  if (initialSegments && initialSegments.length > 0) {
    // Initialize from existing segments
    const firstSeg = initialSegments[0];

    // Handle circle specially - it has no start/end points
    if (firstSeg.type === "circle") {
      // For a circle, create a single segment with start=end (same node index)
      const circleCenter = firstSeg.circle.center;
      const circleRadius = firstSeg.circle.radius;
      const circlePoints = firstSeg.points;

      // Project first point onto the fitted circle to get exact start point
      const p0 = circlePoints[0];
      const dirToP0 = normalize(subtract(p0, circleCenter));
      const startOnCircle = add(circleCenter, scale(dirToP0, circleRadius));

      nodes.push({ x: startOnCircle.x, y: startOnCircle.y, fixed: false });

      // SagittaPoint is opposite side of circle (at exact radius)
      const opposite = add(circleCenter, scale(dirToP0, -circleRadius));

      segments.push({
        startIdx: 0,
        endIdx: 0, // Same node index for full circle
        sagittaPoint: opposite,
        points: circlePoints,
      });
    } else {
      // Normal case: lines and arcs with start/end
      const firstP = firstSeg.start;
      nodes.push({ x: firstP.x, y: firstP.y, fixed: false });

      for (let i = 0; i < initialSegments.length; i++) {
        const seg = initialSegments[i];
        if (seg.type === "circle") continue; // Skip circles in mixed lists

        const segEnd = seg.end;
        nodes.push({ x: segEnd.x, y: segEnd.y, fixed: false });

        // Calculate sagittaPoint from the segment
        let sagittaPoint: Point;
        if (seg.type === "arc") {
          // Use the midpoint of the arc (point on arc at middle angle)
          const midIdx = Math.floor(seg.points.length / 2);
          sagittaPoint = seg.points[midIdx];
        } else {
          // Line: sagittaPoint is on the chord (midpoint)
          sagittaPoint = scale(add(seg.start, seg.end), 0.5);
        }

        segments.push({
          startIdx: i,
          endIdx: i + 1,
          sagittaPoint,
          points: seg.points,
        });
      }
    }
  } else {
    // Create initial single segment
    nodes.push({ x: startP.x, y: startP.y, fixed: false });
    nodes.push({ x: endP.x, y: endP.y, fixed: false });

    // Initial sagittaPoint: midpoint of points (not chord)
    const midIdx = Math.floor(edge.original.points.length / 2);
    const sagittaPoint = edge.original.points[midIdx];

    segments.push({
      startIdx: 0,
      endIdx: 1,
      sagittaPoint,
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
    optimizeParameters(nodes, segments, isClosed);
    if (onIteration) {
      onIteration(
        JSON.parse(JSON.stringify(nodes)),
        JSON.parse(JSON.stringify(segments)),
        `Iteration ${loopCount} - Optimized`,
      );
    }

    // B. Split Pass
    const newSegments: OptSegment[] = [];
    let splitOccurred = false;

    for (const seg of segments) {
      const maxErr = getMaxError(seg, nodes);
      if (maxErr > CONFIG.SPLIT_THRESHOLD && seg.points.length > 4) {
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
      optimizeParameters(nodes, segments, isClosed);
      if (onIteration) {
        onIteration(
          JSON.parse(JSON.stringify(nodes)),
          JSON.parse(JSON.stringify(segments)),
          `Iteration ${loopCount} - Re-optimized`,
        );
      }
    }
  }

  // Final Polish
  optimizeParameters(nodes, segments, isClosed);
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

function optimizeParameters(
  nodes: OptNode[],
  segments: OptSegment[],
  isClosed: boolean = false,
) {
  const MAX_GRAD = 1000; // Gradient clipping threshold

  for (let iter = 0; iter < CONFIG.ITERATIONS; iter++) {
    // Check for NaN/Inf at start of iteration
    for (let ni = 0; ni < nodes.length; ni++) {
      if (!isFinite(nodes[ni].x) || !isFinite(nodes[ni].y)) {
        return; // Stop optimization on numerical explosion
      }
    }
    for (let si = 0; si < segments.length; si++) {
      const sp = segments[si].sagittaPoint;
      if (!isFinite(sp.x) || !isFinite(sp.y)) {
        return; // Stop optimization on numerical explosion
      }
    }

    // Calculate Gradients
    const nodeGrads = nodes.map(() => ({ x: 0, y: 0 }));
    const sagittaGrads = segments.map(() => ({ x: 0, y: 0 }));

    const h = 0.01;

    // 1. Fidelity Gradients
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const pStart = nodes[seg.startIdx];
      const pEnd = nodes[seg.endIdx];

      // Numerical gradient for sagittaPoint
      const errBase = getSegmentErrorWithPoints(
        seg.points,
        pStart,
        seg.sagittaPoint,
        pEnd,
      );

      // Gradient for sagittaPoint.x
      const sagPlusX = { ...seg.sagittaPoint, x: seg.sagittaPoint.x + h };
      const sagMinusX = { ...seg.sagittaPoint, x: seg.sagittaPoint.x - h };
      const errSagXPlus = getSegmentErrorWithPoints(
        seg.points,
        pStart,
        sagPlusX,
        pEnd,
      );
      const errSagXMinus = getSegmentErrorWithPoints(
        seg.points,
        pStart,
        sagMinusX,
        pEnd,
      );
      sagittaGrads[i].x += ((errSagXPlus - errSagXMinus) / (2 * h)) *
        CONFIG.FIDELITY_WEIGHT;

      // Gradient for sagittaPoint.y
      const sagPlusY = { ...seg.sagittaPoint, y: seg.sagittaPoint.y + h };
      const sagMinusY = { ...seg.sagittaPoint, y: seg.sagittaPoint.y - h };
      const errSagYPlus = getSegmentErrorWithPoints(
        seg.points,
        pStart,
        sagPlusY,
        pEnd,
      );
      const errSagYMinus = getSegmentErrorWithPoints(
        seg.points,
        pStart,
        sagMinusY,
        pEnd,
      );
      sagittaGrads[i].y += ((errSagYPlus - errSagYMinus) / (2 * h)) *
        CONFIG.FIDELITY_WEIGHT;

      // For full circle (startIdx == endIdx), the node defines a point on the circle
      // and must be perturbed together with end (same node).
      // For regular segments, perturb start and end separately.
      const isFullCircle = seg.startIdx === seg.endIdx;

      // Gradient for start node (and end if full circle)
      if (!pStart.fixed) {
        const pStartXPlus = { ...pStart, x: pStart.x + h };
        const pStartXMinus = { ...pStart, x: pStart.x - h };
        // For full circle: end moves with start
        const errXPlus = getSegmentErrorWithPoints(
          seg.points,
          pStartXPlus,
          seg.sagittaPoint,
          isFullCircle ? pStartXPlus : pEnd,
        );
        const errXMinus = getSegmentErrorWithPoints(
          seg.points,
          pStartXMinus,
          seg.sagittaPoint,
          isFullCircle ? pStartXMinus : pEnd,
        );
        nodeGrads[seg.startIdx].x += ((errXPlus - errXMinus) / (2 * h)) *
          CONFIG.FIDELITY_WEIGHT;

        const pStartYPlus = { ...pStart, y: pStart.y + h };
        const pStartYMinus = { ...pStart, y: pStart.y - h };
        const errYPlus = getSegmentErrorWithPoints(
          seg.points,
          pStartYPlus,
          seg.sagittaPoint,
          isFullCircle ? pStartYPlus : pEnd,
        );
        const errYMinus = getSegmentErrorWithPoints(
          seg.points,
          pStartYMinus,
          seg.sagittaPoint,
          isFullCircle ? pStartYMinus : pEnd,
        );
        nodeGrads[seg.startIdx].y += ((errYPlus - errYMinus) / (2 * h)) *
          CONFIG.FIDELITY_WEIGHT;
      }

      // Gradient for end node (skip if full circle - already handled above)
      if (!isFullCircle && !pEnd.fixed) {
        const pEndXPlus = { ...pEnd, x: pEnd.x + h };
        const pEndXMinus = { ...pEnd, x: pEnd.x - h };
        const errXPlus = getSegmentErrorWithPoints(
          seg.points,
          pStart,
          seg.sagittaPoint,
          pEndXPlus,
        );
        const errXMinus = getSegmentErrorWithPoints(
          seg.points,
          pStart,
          seg.sagittaPoint,
          pEndXMinus,
        );
        nodeGrads[seg.endIdx].x += ((errXPlus - errXMinus) / (2 * h)) *
          CONFIG.FIDELITY_WEIGHT;

        const pEndYPlus = { ...pEnd, y: pEnd.y + h };
        const pEndYMinus = { ...pEnd, y: pEnd.y - h };
        const errYPlus = getSegmentErrorWithPoints(
          seg.points,
          pStart,
          seg.sagittaPoint,
          pEndYPlus,
        );
        const errYMinus = getSegmentErrorWithPoints(
          seg.points,
          pStart,
          seg.sagittaPoint,
          pEndYMinus,
        );
        nodeGrads[seg.endIdx].y += ((errYPlus - errYMinus) / (2 * h)) *
          CONFIG.FIDELITY_WEIGHT;
      }
    }

    // 2. Alignment Gradients (only for line-like segments)
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const pStart = nodes[seg.startIdx];
      const pEnd = nodes[seg.endIdx];

      const sagitta = computeSagitta(pStart, seg.sagittaPoint, pEnd);
      if (Math.abs(sagitta) < 1.0) {
        const dx = pEnd.x - pStart.x;
        const dy = pEnd.y - pStart.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 1e-4) {
          if (!pStart.fixed) {
            const costXPlus = alignmentCost(
              { ...pStart, x: pStart.x + h },
              pEnd,
            );
            const costXMinus = alignmentCost(
              { ...pStart, x: pStart.x - h },
              pEnd,
            );
            nodeGrads[seg.startIdx].x += ((costXPlus - costXMinus) / (2 * h)) *
              CONFIG.ALIGNMENT_STRENGTH;

            const costYPlus = alignmentCost(
              { ...pStart, y: pStart.y + h },
              pEnd,
            );
            const costYMinus = alignmentCost(
              { ...pStart, y: pStart.y - h },
              pEnd,
            );
            nodeGrads[seg.startIdx].y += ((costYPlus - costYMinus) / (2 * h)) *
              CONFIG.ALIGNMENT_STRENGTH;
          }
          if (!pEnd.fixed) {
            const costXPlus = alignmentCost(pStart, { ...pEnd, x: pEnd.x + h });
            const costXMinus = alignmentCost(pStart, {
              ...pEnd,
              x: pEnd.x - h,
            });
            nodeGrads[seg.endIdx].x += ((costXPlus - costXMinus) / (2 * h)) *
              CONFIG.ALIGNMENT_STRENGTH;

            const costYPlus = alignmentCost(pStart, { ...pEnd, y: pEnd.y + h });
            const costYMinus = alignmentCost(pStart, {
              ...pEnd,
              y: pEnd.y - h,
            });
            nodeGrads[seg.endIdx].y += ((costYPlus - costYMinus) / (2 * h)) *
              CONFIG.ALIGNMENT_STRENGTH;
          }
        }
      }
    }

    // Clip gradients to prevent explosion
    for (let i = 0; i < nodeGrads.length; i++) {
      nodeGrads[i].x = Math.max(-MAX_GRAD, Math.min(MAX_GRAD, nodeGrads[i].x));
      nodeGrads[i].y = Math.max(-MAX_GRAD, Math.min(MAX_GRAD, nodeGrads[i].y));
    }
    for (let i = 0; i < sagittaGrads.length; i++) {
      sagittaGrads[i].x = Math.max(
        -MAX_GRAD,
        Math.min(MAX_GRAD, sagittaGrads[i].x),
      );
      sagittaGrads[i].y = Math.max(
        -MAX_GRAD,
        Math.min(MAX_GRAD, sagittaGrads[i].y),
      );
    }

    // Sync gradients for closed loops
    if (isClosed && nodes.length > 1) {
      const last = nodes.length - 1;
      const sumX = nodeGrads[0].x + nodeGrads[last].x;
      const sumY = nodeGrads[0].y + nodeGrads[last].y;
      nodeGrads[0].x = sumX;
      nodeGrads[0].y = sumY;
      nodeGrads[last].x = sumX;
      nodeGrads[last].y = sumY;
    }

    // Apply Gradients to nodes
    for (let i = 0; i < nodes.length; i++) {
      if (!nodes[i].fixed) {
        nodes[i].x -= nodeGrads[i].x * CONFIG.LEARNING_RATE;
        nodes[i].y -= nodeGrads[i].y * CONFIG.LEARNING_RATE;
      }
    }

    // Sync positions for closed loops
    if (isClosed && nodes.length > 1) {
      const last = nodes.length - 1;
      const avgX = (nodes[0].x + nodes[last].x) / 2;
      const avgY = (nodes[0].y + nodes[last].y) / 2;
      nodes[0].x = avgX;
      nodes[0].y = avgY;
      nodes[last].x = avgX;
      nodes[last].y = avgY;
    }

    // Apply Gradients to sagittaPoints
    for (let i = 0; i < segments.length; i++) {
      segments[i].sagittaPoint.x -= sagittaGrads[i].x * CONFIG.LEARNING_RATE;
      segments[i].sagittaPoint.y -= sagittaGrads[i].y * CONFIG.LEARNING_RATE;
    }
  }
}

function alignmentCost(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return 0;
  return Math.pow((dx * dy) / lenSq, 2) * 10;
}

/**
 * Compute segment error using 3 points (start, sagittaPoint, end) to define the curve.
 */
function getSegmentErrorWithPoints(
  points: Point[],
  start: Point,
  sagittaPoint: Point,
  end: Point,
): number {
  let error = 0;

  const circle = circleFrom3Points(start, sagittaPoint, end);

  if (!circle) {
    // Collinear - use line distance
    for (const p of points) {
      error += distancePointToLineSegmentSq(p, start, end);
    }
  } else {
    // Arc distance - distance to circle
    for (const p of points) {
      const d = Math.abs(distance(p, circle.center) - circle.radius);
      error += d * d;
    }
  }

  return error;
}

function getMaxError(seg: OptSegment, nodes: OptNode[]): number {
  const start = nodes[seg.startIdx];
  const end = nodes[seg.endIdx];
  let maxErr = 0;

  const circle = circleFrom3Points(start, seg.sagittaPoint, end);

  if (!circle) {
    for (const p of seg.points) {
      const d = Math.sqrt(distancePointToLineSegmentSq(p, start, end));
      if (d > maxErr) maxErr = d;
    }
  } else {
    for (const p of seg.points) {
      const d = Math.abs(distance(p, circle.center) - circle.radius);
      if (d > maxErr) maxErr = d;
    }
  }

  return maxErr;
}

function splitSegment(
  seg: OptSegment,
  nodes: OptNode[],
): { left: OptSegment; right: OptSegment } {
  const start = nodes[seg.startIdx];
  const end = nodes[seg.endIdx];
  let maxErr = -1;
  let splitIdx = -1;

  const circle = circleFrom3Points(start, seg.sagittaPoint, end);

  for (let i = 0; i < seg.points.length; i++) {
    const p = seg.points[i];
    let d = 0;
    if (!circle) {
      d = Math.sqrt(distancePointToLineSegmentSq(p, start, end));
    } else {
      d = Math.abs(distance(p, circle.center) - circle.radius);
    }

    if (d > maxErr) {
      maxErr = d;
      splitIdx = i;
    }
  }

  // Create new node at split point
  const splitPoint = seg.points[splitIdx];
  const newNodeIdx = nodes.length;
  nodes.push({ x: splitPoint.x, y: splitPoint.y, fixed: false });

  const leftPoints = seg.points.slice(0, splitIdx + 1);
  const rightPoints = seg.points.slice(splitIdx);

  // Compute sagittaPoints for each half (midpoint of their points)
  const leftMidIdx = Math.floor(leftPoints.length / 2);
  const rightMidIdx = Math.floor(rightPoints.length / 2);

  return {
    left: {
      startIdx: seg.startIdx,
      endIdx: newNodeIdx,
      sagittaPoint: leftPoints[leftMidIdx],
      points: leftPoints,
    },
    right: {
      startIdx: newNodeIdx,
      endIdx: seg.endIdx,
      sagittaPoint: rightPoints[rightMidIdx],
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
    const start: Point = { x: nodes[seg.startIdx].x, y: nodes[seg.startIdx].y };
    const end: Point = { x: nodes[seg.endIdx].x, y: nodes[seg.endIdx].y };

    // Compute the sagitta (perpendicular distance from sagittaPoint to chord)
    const sagitta = computeSagitta(start, seg.sagittaPoint, end);
    const chordLen = distance(start, end);

    // Treat as line if:
    // - sagitta is very small (nearly collinear points)
    // - or sagitta relative to chord length is tiny (nearly straight)
    const isLine = Math.abs(sagitta) < 0.5 ||
      (chordLen > 1e-4 && Math.abs(sagitta) / chordLen < 0.05);

    if (isLine) {
      // Line
      const dir = chordLen > 1e-6
        ? normalize(subtract(end, start))
        : { x: 1, y: 0 };

      return {
        type: "line" as const,
        start,
        end,
        points: seg.points,
        line: {
          point: start,
          direction: dir,
        },
      };
    }

    const circle = circleFrom3Points(start, seg.sagittaPoint, end);

    if (!circle || circle.radius > 10000) {
      // Fallback to line
      const dir = magnitude(subtract(end, start)) > 1e-6
        ? normalize(subtract(end, start))
        : { x: 1, y: 0 };

      return {
        type: "line" as const,
        start,
        end,
        points: seg.points,
        line: {
          point: start,
          direction: dir,
        },
      };
    } else {
      // Arc
      const startAngle = Math.atan2(
        start.y - circle.center.y,
        start.x - circle.center.x,
      );
      const endAngle = Math.atan2(
        end.y - circle.center.y,
        end.x - circle.center.x,
      );

      // Determine clockwise by checking if sagittaPoint is on left or right of chord
      const chord = subtract(end, start);
      const toSagitta = subtract(seg.sagittaPoint, start);
      const crossProd = cross(chord, toSagitta);
      const clockwise = crossProd < 0;

      return {
        type: "arc" as const,
        start,
        end,
        points: seg.points,
        arc: {
          center: circle.center,
          radius: circle.radius,
          startAngle,
          endAngle,
          clockwise,
        },
      };
    }
  });
}
