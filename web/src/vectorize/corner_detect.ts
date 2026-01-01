/**
 * Corner detection module - identifies sharp angles between segments.
 * Corners absorb small intermediate segments and mark nearby pixels.
 */

import type { Point } from "./geometry.ts";
import { distance, magnitude, normalizeAngle } from "./geometry.ts";
import type { Segment } from "./simplifier.ts";

export interface Corner {
  /** The position of the corner */
  position: Point;
  /** Angle between incoming and outgoing segments (0 = endpoint, >0 = turn angle) */
  cornerAngle: number;
  /** Radius of influence for pixel inclusion */
  radius: number;
  /** Indices of segments involved (absorbs small segments between) */
  segmentIndices: number[];
}

export interface CornerSegmentPrimitive {
  type: "corner";
  /** Start point of the corner polyline (first point in points) */
  start: Point;
  /** End point of the corner polyline (last point in points) */
  end: Point;
  /** Sequence of pixels belonging to this corner */
  points: Point[];
  /** Corner metadata */
  position: Point;
  radius: number;
  cornerAngle: number;
  /** Original segment indices that contributed pixels to this corner */
  segmentIndices: number[];
  attachedSegments: number[];
}

export type SegmentPrimitive = Segment | CornerSegmentPrimitive;

export interface SegmentWithCorners {
  segment: Segment;
  /** True if this segment is absorbed into a corner */
  absorbedIntoCorner: boolean;
  /** Corner indices this segment contributes to */
  cornerIndices: number[];
}

/**
 * Get the direction vector at a point on a segment
 */
function getSegmentDirection(seg: Segment, atEnd: boolean): Point | null {
  if (seg.type === "line") {
    const dir = seg.line.direction;
    return atEnd ? { x: -dir.x, y: -dir.y } : dir;
  } else {
    // For arc, use tangent direction
    const arc = seg.arc;
    const angle = atEnd ? arc.endAngle : arc.startAngle;
    // Tangent is perpendicular to radius, rotated 90 degrees
    const dx = -Math.sin(angle);
    const dy = Math.cos(angle);
    // Reverse if going backwards (at the end of the arc)
    return atEnd ? { x: -dx, y: -dy } : { x: dx, y: dy };
  }
}

/**
 * Calculate angle between two direction vectors
 * Returns the interior angle (how much direction changes from dir1 to dir2)
 * 0 = no change (straight), π/2 = right angle, π = complete reversal
 */
function directionAngle(dir1: Point, dir2: Point): number {
  const m1 = magnitude(dir1);
  const m2 = magnitude(dir2);
  if (m1 < 1e-10 || m2 < 1e-10) return 0;

  const n1 = { x: dir1.x / m1, y: dir1.y / m1 };
  const n2 = { x: dir2.x / m2, y: dir2.y / m2 };

  // Calculate interior angle using atan2 for better handling
  const angle1 = Math.atan2(n1.y, n1.x);
  const angle2 = Math.atan2(n2.y, n2.x);

  console.log(
    ` directionAngle: dir1=(${dir1.x.toFixed(2)},${dir1.y.toFixed(2)}), dir2=(${
      dir2.x.toFixed(2)
    },${dir2.y.toFixed(2)}) -> angle1=${
      (angle1 * 180 / Math.PI).toFixed(1)
    }°, angle2=${(angle2 * 180 / Math.PI).toFixed(1)}°`,
  );

  // Get the signed difference
  let diff = angle2 - angle1;

  // Normalize to [-π, π]
  if (diff > Math.PI) diff -= 2 * Math.PI;
  if (diff < -Math.PI) diff += 2 * Math.PI;

  // Return absolute value (corner angle is magnitude of turn)
  return Math.abs(diff);
}

/**
 * Detect corners in a sequence of segments
 * @param segments The segments to analyze
 * @param cornerAngleThreshold Minimum turn angle to consider a corner (default π/6 = 30°)
 * @param minSegmentLength Minimum length to not absorb into corner (default 2 pixels)
 * @returns Detected corners and updated segment info
 */
export function detectCorners(
  segments: Segment[],
  cornerAngleThreshold = Math.PI / 6,
  minSegmentLength = 2,
): {
  corners: Corner[];
  segmentsWithCorners: SegmentWithCorners[];
  cornerSegments: CornerSegmentPrimitive[];
  segmentPrimitives: SegmentPrimitive[];
} {
  // Fast path: single closed arc (full circle) has no corners; keep segments as-is
  if (segments.length === 1 && isClosedArcSegment(segments[0])) {
    return {
      corners: [],
      segmentsWithCorners: [{
        segment: segments[0],
        absorbedIntoCorner: false,
        cornerIndices: [],
      }],
      cornerSegments: [],
      segmentPrimitives: [segments[0]],
    };
  }

  const corners: Corner[] = [];
  const segmentsWithCorners: SegmentWithCorners[] = segments.map((seg) => ({
    segment: seg,
    absorbedIntoCorner: false,
    cornerIndices: [],
  }));

  // Check each junction between consecutive segments
  for (let i = 0; i < segments.length - 1; i++) {
    const current = segments[i];
    const next = segments[i + 1];

    const inDir = getSegmentDirection(current, false);
    const outDir = getSegmentDirection(next, false);

    if (!outDir || !inDir) continue;

    const angle = directionAngle(inDir, outDir);

    // Calculate segment lengths for heuristic
    const currentLen = distance(current.start, current.end);
    const nextLen = distance(next.start, next.end);
    const avgLen = (currentLen + nextLen) / 2;

    console.log(
      `Corner detection at segment ${i}->${
        i + 1
      }: angle=${angle}, avgLen=${avgLen}`,
    );
    console.log(
      `  inDir=(${inDir.x.toFixed(2)},${inDir.y.toFixed(2)}), outDir=(${
        outDir.x.toFixed(2)
      },${outDir.y.toFixed(2)})`,
    );

    // Corner detection heuristic:
    // 1. Large angles (> threshold) are always corners
    // 2. Small angles on long segments might be corners if they create significant deviation
    //    Use sagitta formula: s = r(1 - cos(θ/2)) ≈ rθ²/8 for small θ
    //    For a segment of length L, r ≈ L/(2sin(θ/2)) ≈ L/θ
    //    So sagitta ≈ Lθ/8. We want sagitta > 2 pixels to be significant.
    // 3. Angles very close to 0 (< 5°) or π (straight continuation) are never corners
    const minDetectableAngle = Math.PI / 180 * 30; // ~5 degrees
    const isSignificantAngle = angle > minDetectableAngle;
    const isLargeAngle = angle > cornerAngleThreshold;
    // Sagitta approximation: s ≈ L*θ/8, want s > 2 pixels, so L*θ > 16
    const isSmallAngleOnLongSegment = angle > minDetectableAngle &&
      (angle * avgLen > 16);

    const isSharp = isSignificantAngle &&
      (isLargeAngle || isSmallAngleOnLongSegment);

    if (isSharp) {
      const cornerPos = current.end;
      const radius = 2; // Pixel radius of influence

      // Look backwards and forwards to absorb small segments
      let startIdx = i;
      let endIdx = i + 1;

      // Check if previous segment is small and can be absorbed
      if (i > 0) {
        const prevLen = distance(segments[i - 1].start, segments[i - 1].end);
        if (prevLen < minSegmentLength) {
          startIdx = i - 1;
          segmentsWithCorners[i - 1].absorbedIntoCorner = true;
        }
      }

      // Check if next segment is small and can be absorbed
      if (i + 2 < segments.length) {
        const nextLen = distance(segments[i + 1].start, segments[i + 1].end);
        if (nextLen < minSegmentLength) {
          endIdx = i + 2;
          segmentsWithCorners[i + 1].absorbedIntoCorner = true;
        }
      }

      const cornerIdx = corners.length;
      corners.push({
        position: cornerPos,
        cornerAngle: angle,
        radius,
        segmentIndices: Array.from(
          { length: endIdx - startIdx + 1 },
          (_, j) => startIdx + j,
        ),
      });

      // Mark segments involved in this corner
      for (
        let j = startIdx;
        j <= endIdx && j < segmentsWithCorners.length;
        j++
      ) {
        segmentsWithCorners[j].cornerIndices.push(cornerIdx);
      }
    }
  }

  // Also detect corners at path endpoints
  if (segments.length > 0) {
    const startCorner: Corner = {
      position: segments[0].start,
      cornerAngle: 0, // Endpoint
      radius: 2,
      segmentIndices: [0],
    };
    corners.push(startCorner);
    segmentsWithCorners[0].cornerIndices.push(corners.length - 1);

    const endCorner: Corner = {
      position: segments[segments.length - 1].end,
      cornerAngle: 0, // Endpoint
      radius: 2,
      segmentIndices: [segments.length - 1],
    };
    corners.push(endCorner);
    segmentsWithCorners[segments.length - 1].cornerIndices.push(
      corners.length - 1,
    );
  }

  if (true) {
    console.log(`Detected ${corners.length} corners:`);
    corners.forEach((c, i) => {
      console.log(
        ` Corner ${i}: angle=${
          (c.cornerAngle * 180 / Math.PI).toFixed(1)
        }°, pos={${c.position.x.toFixed(2)},${
          c.position.y.toFixed(2)
        }}, segments=[${c.segmentIndices.join(",")}]`,
      );
    });
  }

  // Merge corners that are very close together
  const mergeThreshold = 2.9;
  const mergedCorners: Corner[] = [];
  const merged = new Set<number>();

  for (let i = 0; i < corners.length; i++) {
    if (merged.has(i)) continue;

    const corner = corners[i];
    const nearbyCorners = [i];

    // Find all corners within merge threshold
    for (let j = i + 1; j < corners.length; j++) {
      if (merged.has(j)) continue;
      const dist = distance(corner.position, corners[j].position);
      console.log(`Distance between corner ${i} and ${j}: ${dist}`);
      if (dist < mergeThreshold) {
        nearbyCorners.push(j);
        merged.add(j);
      }
    }

    // Merge nearby corners
    if (nearbyCorners.length > 1) {
      // Average position
      let sumX = 0, sumY = 0;
      let maxAngle = 0;
      const allSegmentIndices = new Set<number>();

      for (const idx of nearbyCorners) {
        const c = corners[idx];
        sumX += c.position.x;
        sumY += c.position.y;
        maxAngle = Math.max(maxAngle, c.cornerAngle);
        c.segmentIndices.forEach((si) => allSegmentIndices.add(si));
      }

      mergedCorners.push({
        position: {
          x: sumX / nearbyCorners.length,
          y: sumY / nearbyCorners.length,
        },
        cornerAngle: maxAngle,
        radius: corner.radius,
        segmentIndices: Array.from(allSegmentIndices),
      });
    } else {
      mergedCorners.push(corner);
    }
  }

  const { cornerSegments, segmentPrimitives } = integrateCornerSegments(
    segments,
    mergedCorners,
  );

  return {
    corners: mergedCorners,
    segmentsWithCorners,
    cornerSegments,
    segmentPrimitives,
  };
}

function dedupeConsecutivePoints(points: Point[]): Point[] {
  if (points.length === 0) return points;
  const deduped: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = deduped[deduped.length - 1];
    const curr = points[i];
    if (distance(prev, curr) > 1e-9) {
      deduped.push(curr);
    }
  }
  return deduped;
}

function trimStartForCorner(
  points: Point[],
  corner: Corner,
): { remaining: Point[]; cornerPoints: Point[] } {
  let cutIndex = 0;
  while (
    cutIndex < points.length &&
    distance(points[cutIndex], corner.position) <= corner.radius
  ) {
    cutIndex++;
  }

  const remaining = points.slice(cutIndex);
  if (cutIndex === 0) {
    return { remaining, cornerPoints: [] };
  }

  const boundary = remaining[0] ?? points[points.length - 1];
  const cornerPoints = [...points.slice(0, cutIndex), boundary];
  return { remaining, cornerPoints };
}

function trimEndForCorner(
  points: Point[],
  corner: Corner,
): { remaining: Point[]; cornerPoints: Point[] } {
  let cutIndex = points.length - 1;
  while (
    cutIndex >= 0 &&
    distance(points[cutIndex], corner.position) <= corner.radius
  ) {
    cutIndex--;
  }

  const remaining = points.slice(0, cutIndex + 1);
  if (cutIndex === points.length - 1) {
    return { remaining, cornerPoints: [] };
  }

  const boundary = remaining[remaining.length - 1] ?? points[0];
  const cornerPoints = [boundary, ...points.slice(cutIndex + 1)];
  return { remaining, cornerPoints };
}

function rebuildSegmentWithPoints(seg: Segment, points: Point[]): Segment {
  if (points.length === 0) {
    return seg;
  }

  const start = points[0];
  const end = points[points.length - 1];

  if (seg.type === "line") {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return {
      type: "line",
      start,
      end,
      points,
      line: {
        point: start,
        direction: { x: dx / len, y: dy / len },
      },
    };
  }

  const center = seg.arc.center;
  const startAngleRaw = Math.atan2(start.y - center.y, start.x - center.x);
  const endAngleRaw = Math.atan2(end.y - center.y, end.x - center.x);
  const clockwise = seg.arc.clockwise;

  // Unwrap end angle to preserve direction
  const twoPi = 2 * Math.PI;
  let endAngle = endAngleRaw;
  if (clockwise) {
    while (endAngle > startAngleRaw) endAngle -= twoPi;
  } else {
    while (endAngle < startAngleRaw) endAngle += twoPi;
  }

  return {
    type: "arc",
    start,
    end,
    points,
    arc: {
      center,
      radius: seg.arc.radius,
      startAngle: normalizeAngle(startAngleRaw),
      endAngle,
      clockwise,
    },
  };
}

function integrateCornerSegments(
  segments: Segment[],
  corners: Corner[],
): {
  cornerSegments: CornerSegmentPrimitive[];
  segmentPrimitives: SegmentPrimitive[];
} {
  // Use reduced radius when trimming against endpoint corners to avoid over-shrinking
  const trimCorners = corners.map((c) => (
    c.cornerAngle === 0 ? { ...c, radius: Math.min(c.radius, 1.5) } : c
  ));

  // Track attachments of corners to segment ends
  const attachments: Array<{ start?: number; end?: number }> = segments.map(
    () => ({}),
  );

  trimCorners.forEach((corner, cornerIdx) => {
    for (const segIdx of corner.segmentIndices) {
      const seg = segments[segIdx];
      const distStart = distance(corner.position, seg.start);
      const distEnd = distance(corner.position, seg.end);
      const side: "start" | "end" = distStart <= distEnd ? "start" : "end";

      const existing = attachments[segIdx][side];
      if (existing === undefined) {
        attachments[segIdx][side] = cornerIdx;
      } else {
        // Prefer closer corner if multiple map to same side
        const existingCorner = corners[existing];
        const existingDist = side === "start"
          ? distance(existingCorner.position, seg.start)
          : distance(existingCorner.position, seg.end);
        const candidateDist = side === "start" ? distStart : distEnd;
        if (candidateDist < existingDist) {
          attachments[segIdx][side] = cornerIdx;
        }
      }
    }
  });

  const cornerStates = corners.map(() => ({
    beforePoints: [] as Point[],
    afterPoints: [] as Point[],
    attachedSegments: new Set<number>(),
  }));

  const keptSegments: Array<{ segment: Segment; originalIndex: number }> = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    let points = [...seg.points];

    const startCornerIdx = attachments[i].start;
    if (startCornerIdx !== undefined) {
      const { remaining, cornerPoints } = trimStartForCorner(
        points,
        corners[startCornerIdx],
      );
      points = remaining;
      if (cornerPoints.length > 0) {
        cornerStates[startCornerIdx].afterPoints.push(...cornerPoints);
        cornerStates[startCornerIdx].attachedSegments.add(i);
      }
    }

    const endCornerIdx = attachments[i].end;
    if (endCornerIdx !== undefined) {
      const { remaining, cornerPoints } = trimEndForCorner(
        points,
        corners[endCornerIdx],
      );
      points = remaining;
      if (cornerPoints.length > 0) {
        cornerStates[endCornerIdx].beforePoints.push(...cornerPoints);
        cornerStates[endCornerIdx].attachedSegments.add(i);
      }
    }

    if (points.length === 1) {
      // Preserve degenerate segment with zero length rather than drop it entirely
      points = [points[0], points[0]];
    }

    if (points.length >= 2) {
      keptSegments.push({
        segment: rebuildSegmentWithPoints(seg, dedupeConsecutivePoints(points)),
        originalIndex: i,
      });
    }
  }

  // Build corner segments with ordered points
  const cornerSegments: CornerSegmentPrimitive[] = corners.map(
    (corner, idx) => {
      const before = dedupeConsecutivePoints(cornerStates[idx].beforePoints);
      const after = dedupeConsecutivePoints(cornerStates[idx].afterPoints);

      const points: Point[] = dedupeConsecutivePoints([
        ...before,
        corner.position,
        ...after,
      ]);

      const start = points[0] ?? corner.position;
      const end = points[points.length - 1] ?? corner.position;

      return {
        type: "corner",
        start,
        end,
        points: points.length > 0 ? points : [corner.position],
        position: corner.position,
        radius: corner.radius,
        cornerAngle: corner.cornerAngle,
        segmentIndices: corner.segmentIndices,
        attachedSegments: Array.from(cornerStates[idx].attachedSegments),
      };
    },
  );

  // Decide where to place each corner segment in the sequence
  const cornerAnchorBefore = new Map<number, number[]>();
  const cornerAnchorAfter = new Map<number, number[]>();

  corners.forEach((corner, idx) => {
    let bestSeg = corner.segmentIndices[0];
    let bestDist = Infinity;
    let anchorBefore = false;
    for (const segIdx of corner.segmentIndices) {
      const seg = segments[segIdx];
      const distStart = distance(corner.position, seg.start);
      const distEnd = distance(corner.position, seg.end);
      const nearStart = distStart <= distEnd;
      const d = nearStart ? distStart : distEnd;
      if (d < bestDist || (Math.abs(d - bestDist) < 1e-9 && segIdx < bestSeg)) {
        bestDist = d;
        bestSeg = segIdx;
        anchorBefore = nearStart;
      }
    }

    const targetMap = anchorBefore ? cornerAnchorBefore : cornerAnchorAfter;
    const list = targetMap.get(bestSeg) ?? [];
    list.push(idx);
    targetMap.set(bestSeg, list);
  });

  const segmentPrimitives: SegmentPrimitive[] = [];
  const insertedCorners = new Set<number>();

  for (const kept of keptSegments) {
    const beforeList = cornerAnchorBefore.get(kept.originalIndex) ?? [];
    for (const cIdx of beforeList) {
      segmentPrimitives.push(cornerSegments[cIdx]);
      insertedCorners.add(cIdx);
    }

    segmentPrimitives.push(kept.segment);

    const afterList = cornerAnchorAfter.get(kept.originalIndex) ?? [];
    for (const cIdx of afterList) {
      if (!insertedCorners.has(cIdx)) {
        segmentPrimitives.push(cornerSegments[cIdx]);
        insertedCorners.add(cIdx);
      }
    }
  }

  // Append any corner segments whose anchor segment was fully absorbed
  corners.forEach((_, idx) => {
    if (!insertedCorners.has(idx)) {
      segmentPrimitives.push(cornerSegments[idx]);
      insertedCorners.add(idx);
    }
  });

  return { cornerSegments, segmentPrimitives };
}

function isClosedArcSegment(seg: Segment): boolean {
  if (seg.type !== "arc") return false;
  const closedEnds = distance(seg.start, seg.end) < 1e-3;
  const sweep = Math.abs(seg.arc.endAngle - seg.arc.startAngle);
  const isFullSweep = sweep > 1.9 * Math.PI;
  return closedEnds && isFullSweep;
}

/**
 * Check if a pixel is within the influence radius of any corner
 */
export function isPixelInCornerRegion(
  pixel: Point,
  corners: Corner[],
): Corner | null {
  for (const corner of corners) {
    if (distance(pixel, corner.position) <= corner.radius) {
      return corner;
    }
  }
  return null;
}
