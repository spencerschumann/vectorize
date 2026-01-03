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
 * Fit a line to a sequence of points using PCA and return the direction vector.
 * This uses covariance matrix eigenanalysis to find the best-fit direction,
 * making it robust to noise in the polyline.
 */
function fitLineDirection(points: Point[]): Point | null {
  if (points.length < 2) return null;

  // Compute centroid
  let cx = 0, cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= points.length;
  cy /= points.length;

  // Compute covariance matrix elements
  let cxx = 0, cyy = 0, cxy = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    cxx += dx * dx;
    cyy += dy * dy;
    cxy += dx * dy;
  }

  // Eigenvalue problem: find eigenvalues of [[cxx, cxy], [cxy, cyy]]
  const trace = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const lambda1 = trace / 2 + Math.sqrt(trace * trace / 4 - det);

  // Eigenvector for larger eigenvalue
  if (Math.abs(cxy) > 1e-10) {
    const vx = lambda1 - cyy;
    const vy = cxy;
    const len = Math.sqrt(vx * vx + vy * vy);
    return { x: vx / len, y: vy / len };
  } else if (Math.abs(cxx) > Math.abs(cyy)) {
    return { x: 1, y: 0 };
  } else {
    return { x: 0, y: 1 };
  }
}

/**
 * Detect corners in a sequence of segments using scale-space curvature detection.
 * Uses PCA-fitted directions and curvature concentration (angle / length) with
 * peak detection to identify true corners robustly.
 *
 * @param segments The segments to analyze
 * @param windowLength Arc length window size
 * @param curvatureThreshold Minimum curvature (angle/length) for a corner
 * @returns Detected corners and updated segment info
 */
export function detectCorners(
  segments: Segment[],
  windowLength = 10,
  curvatureThreshold = 0.01,
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

  // Flatten segments into a continuous sequence of points (deduplicate boundaries)
  const allPoints: Point[] = [];
  const segmentStartIndices: number[] = [];

  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const seg = segments[segIdx];
    segmentStartIndices.push(allPoints.length);

    // Add all points from this segment, but skip the first point if it duplicates the last
    const startIdx = (segIdx > 0 && allPoints.length > 0 &&
        distance(allPoints[allPoints.length - 1], seg.points[0]) < 1e-6)
      ? 1
      : 0;
    allPoints.push(...seg.points.slice(startIdx));
  }

  const segmentsWithCorners: SegmentWithCorners[] = segments.map((seg) => ({
    segment: seg,
    absorbedIntoCorner: false,
    cornerIndices: [],
  }));

  // Check if path is closed
  const isClosed = allPoints.length > 2 &&
    distance(allPoints[0], allPoints[allPoints.length - 1]) < 1;

  // Step 1: Compute curvature κ(i) = θ(i) / ℓ(i) at each vertex
  interface CurvaturePoint {
    index: number;
    position: Point;
    curvature: number;
    turningAngle: number;
    arcLength: number;
  }

  const curvatures: CurvaturePoint[] = [];

  // For closed paths, also evaluate wraparound (index 0); for open paths skip endpoints
  const startIdx = isClosed ? 0 : 1;
  const endIdx = isClosed ? allPoints.length : allPoints.length - 1;

  for (let i = startIdx; i < endIdx; i++) {
    // Walk backward to accumulate arc length (with wraparound for closed paths)
    let backDist = 0;
    let backIdx = i - 1;
    const backPoints = [allPoints[i]];
    while (backDist < windowLength) {
      // Wraparound for closed paths
      if (backIdx < 0) {
        if (!isClosed) break;
        backIdx = allPoints.length - 1;
      }

      backPoints.unshift(allPoints[backIdx]);

      // Calculate distance to next point backward
      const prevIdx = backIdx - 1 < 0
        ? (isClosed ? allPoints.length - 1 : -1)
        : backIdx - 1;
      if (prevIdx < 0 || prevIdx >= allPoints.length) break;

      backDist += distance(allPoints[backIdx], allPoints[prevIdx]);
      backIdx--;

      // Prevent infinite loop
      if (backPoints.length > allPoints.length) break;
    }

    // Walk forward to accumulate arc length (with wraparound for closed paths)
    let fwdDist = 0;
    let fwdIdx = i + 1;
    const fwdPoints = [allPoints[i]];
    while (fwdDist < windowLength) {
      // Wraparound for closed paths
      if (fwdIdx >= allPoints.length) {
        if (!isClosed) break;
        fwdIdx = 0;
      }

      fwdPoints.push(allPoints[fwdIdx]);

      // Calculate distance to next point forward
      const nextIdx = fwdIdx + 1 >= allPoints.length
        ? (isClosed ? 0 : allPoints.length)
        : fwdIdx + 1;
      if (nextIdx >= allPoints.length && !isClosed) break;

      fwdDist += distance(
        allPoints[fwdIdx],
        allPoints[nextIdx % allPoints.length],
      );
      fwdIdx++;

      // Prevent infinite loop
      if (fwdPoints.length > allPoints.length) break;
    }

    // Step 1a: Fit lines using PCA to get robust directions
    const backDir = fitLineDirection(backPoints);
    const fwdDir = fitLineDirection(fwdPoints);

    if (!backDir || !fwdDir) continue;

    // Align directions with point sequence to ensure consistency
    const backFirstToLast = {
      x: backPoints[backPoints.length - 1].x - backPoints[0].x,
      y: backPoints[backPoints.length - 1].y - backPoints[0].y,
    };
    const fwdFirstToLast = {
      x: fwdPoints[fwdPoints.length - 1].x - fwdPoints[0].x,
      y: fwdPoints[fwdPoints.length - 1].y - fwdPoints[0].y,
    };

    // Flip directions if they point backwards
    if (backDir.x * backFirstToLast.x + backDir.y * backFirstToLast.y < 0) {
      backDir.x = -backDir.x;
      backDir.y = -backDir.y;
    }
    if (fwdDir.x * fwdFirstToLast.x + fwdDir.y * fwdFirstToLast.y < 0) {
      fwdDir.x = -fwdDir.x;
      fwdDir.y = -fwdDir.y;
    }

    // Compute turning angle between fitted directions
    const dotProd = backDir.x * fwdDir.x + backDir.y * fwdDir.y;
    const clampedDot = Math.max(-1, Math.min(1, dotProd));
    const turningAngle = Math.acos(clampedDot);

    // Total arc length in window
    const totalArcLength = backDist + fwdDist;
    if (totalArcLength < 0.1) continue;

    // Step 1b: Compute curvature concentration κ = θ / ℓ
    const curvature = turningAngle / totalArcLength;

    curvatures.push({
      index: i,
      position: allPoints[i],
      curvature,
      turningAngle,
      arcLength: totalArcLength,
    });
  }

  // Step 2: Find local maxima in curvature signal (peak detection)
  const corners: Corner[] = [];
  const peakRadius = Math.max(3, Math.round(windowLength / 2));

  for (let i = 0; i < curvatures.length; i++) {
    const cp = curvatures[i];

    // Check if this is a local maximum and exceeds threshold
    if (cp.curvature > curvatureThreshold) {
      let isLocalMax = true;

      // Check neighbors within peakRadius
      for (let j = 0; j < curvatures.length; j++) {
        if (i === j) continue;
        const neighbor = curvatures[j];
        const dist = Math.abs(cp.index - neighbor.index);

        if (dist <= peakRadius && neighbor.curvature > cp.curvature) {
          isLocalMax = false;
          break;
        }
      }

      if (isLocalMax) {
        corners.push({
          position: cp.position,
          cornerAngle: cp.turningAngle,
          radius: 2,
          segmentIndices: [],
        });
      }
    }
  }

  // Step 3: Map corners to segment indices
  for (const corner of corners) {
    const cornerSegIndices = new Set<number>();
    for (let i = 0; i < allPoints.length; i++) {
      if (distance(allPoints[i], corner.position) < 1e-6) {
        // Found the point in the flattened sequence
        for (let segIdx = 0; segIdx < segmentStartIndices.length; segIdx++) {
          const nextSegStart = segIdx + 1 < segmentStartIndices.length
            ? segmentStartIndices[segIdx + 1]
            : allPoints.length;
          if (i >= segmentStartIndices[segIdx] && i < nextSegStart) {
            cornerSegIndices.add(segIdx);
            if (segIdx > 0) cornerSegIndices.add(segIdx - 1);
            if (segIdx < segments.length - 1) cornerSegIndices.add(segIdx + 1);
            break;
          }
        }
        break;
      }
    }
    corner.segmentIndices = Array.from(cornerSegIndices);
  }

  // Step 4: Mark segments as absorbed if their midpoint is within corner radius
  for (let segIdx = 0; segIdx < segments.length; segIdx++) {
    const seg = segments[segIdx];
    const midpoint = {
      x: (seg.start.x + seg.end.x) / 2,
      y: (seg.start.y + seg.end.y) / 2,
    };

    for (let cornerIdx = 0; cornerIdx < corners.length; cornerIdx++) {
      if (
        distance(midpoint, corners[cornerIdx].position) <=
          corners[cornerIdx].radius
      ) {
        segmentsWithCorners[segIdx].absorbedIntoCorner = true;
        segmentsWithCorners[segIdx].cornerIndices.push(cornerIdx);
        if (!corners[cornerIdx].segmentIndices.includes(segIdx)) {
          corners[cornerIdx].segmentIndices.push(segIdx);
        }
      }
    }
  }

  // Step 5: Add endpoint corners for open paths (for noise filtering)
  if (!isClosed && segments.length > 0 && allPoints.length > 0) {
    // For open paths, add endpoint corners for noise filtering
    const startCorner: Corner = {
      position: allPoints[0],
      cornerAngle: 0, // Endpoint marker
      radius: 2,
      segmentIndices: [0],
    };
    corners.push(startCorner);
    segmentsWithCorners[0].cornerIndices.push(corners.length - 1);

    const endCorner: Corner = {
      position: allPoints[allPoints.length - 1],
      cornerAngle: 0, // Endpoint marker
      radius: 2,
      segmentIndices: [segments.length - 1],
    };
    corners.push(endCorner);
    segmentsWithCorners[segments.length - 1].cornerIndices.push(
      corners.length - 1,
    );
  }

  const { cornerSegments, segmentPrimitives } = integrateCornerSegments(
    segments,
    corners,
  );

  return {
    corners,
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
