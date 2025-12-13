/**
 * Key vertex detection for vectorization
 * Identifies important vertices based on path structure and curvature
 */

import type { VectorPath, Vertex } from "../vectorize.ts";

export interface KeyVertex {
  vertexId: number;
  x: number;
  y: number;
  reason: "endpoint" | "junction" | "curvature";
}

export interface CurvatureDebugInfo {
  x: number;
  y: number;
  directionX: number; // Perpendicular to fitted line
  directionY: number;
  magnitude: number; // Curvature value
}

/**
 * Callback function for collecting debug information during curvature calculation
 */
export type DebugCallback = (
  x: number,
  y: number,
  directionX: number,
  directionY: number,
  magnitude: number,
) => void;

/**
 * Detect key vertices in a path
 * @param path The path to analyze
 * @param vertices Map of all vertices
 * @param windowSize Number of segments to use for curvature calculation (default 5)
 * @param debugCallback Optional callback for collecting curvature debug info
 * @returns Object with key vertices and curvature debug info
 */
export function detectKeyVertices(
  path: VectorPath,
  vertices: Map<number, Vertex>,
  windowSize: number = 5,
  debugCallback?: DebugCallback,
): { keyVertices: KeyVertex[]; curvatureDebug: CurvatureDebugInfo[] } {
  const keyVertices: KeyVertex[] = [];
  const curvatureDebug: CurvatureDebugInfo[] = [];
  const coords = path.vertices.map((id) => vertices.get(id)!);

  if (coords.length === 0) {
    return { keyVertices, curvatureDebug };
  }

  // Endpoints are key vertices (unless path is closed)
  if (!path.closed) {
    const start = coords[0];
    keyVertices.push({
      vertexId: start.id,
      x: start.x,
      y: start.y,
      reason: "endpoint",
    });

    if (coords.length > 1) {
      const end = coords[coords.length - 1];
      keyVertices.push({
        vertexId: end.id,
        x: end.x,
        y: end.y,
        reason: "endpoint",
      });
    }
  }

  // Need at least windowSize + 1 points for curvature analysis
  if (coords.length < windowSize + 1) {
    return { keyVertices, curvatureDebug };
  }

  // Collect debug info if callback provided
  const collectDebug = debugCallback ||
    ((x, y, dx, dy, mag) => {
      curvatureDebug.push({
        x,
        y,
        directionX: dx,
        directionY: dy,
        magnitude: mag,
      });
    });

  // Calculate curvature at each point using sliding window
  const curvatures = calculatePathCurvature(
    coords,
    windowSize,
    path.closed,
    collectDebug,
  );

  // Find local maxima in curvature
  const curvatureThreshold = 2.2; // Minimum curvature to consider
  const localMaxima = findLocalMaxima(
    curvatures,
    curvatureThreshold,
    path.closed,
  );

  // Add curvature-based key vertices
  for (const index of localMaxima) {
    const vertex = coords[index];
    // Don't duplicate endpoints
    if (!keyVertices.some((kv) => kv.vertexId === vertex.id)) {
      keyVertices.push({
        vertexId: vertex.id,
        x: vertex.x,
        y: vertex.y,
        reason: "curvature",
      });
    }
  }

  return { keyVertices, curvatureDebug };
}

/**
 * Segment data for sliding window calculation
 */
interface SegmentData {
  length: number;
  midX: number;
  midY: number;
  ax: number; // A.x relative to centroid
  ay: number; // A.y relative to centroid
  bx: number; // B.x relative to centroid
  by: number; // B.y relative to centroid
}

/**
 * Calculate curvature at each point in the path using sliding window
 * Uses a simple list-based approach for efficiency
 * @param points Array of vertices in the path
 * @param windowSize Number of segments to use for line fitting
 * @param closed Whether the path is closed (wraps around)
 * @param debugCallback Optional callback for collecting debug information
 * @returns Array of curvature values
 */
function calculatePathCurvature(
  points: Vertex[],
  windowSize: number,
  closed: boolean,
  debugCallback?: DebugCallback,
): number[] {
  const curvatures: number[] = [];
  const n = points.length;

  if (n < 2) {
    return curvatures;
  }

  // Helper to get point with wrapping for closed paths
  const getPoint = (idx: number): Vertex => {
    if (closed) {
      return points[((idx % n) + n) % n];
    }
    return points[Math.max(0, Math.min(n - 1, idx))];
  };

  // Pre-compute all segments (including wrap-around for closed paths)
  const segments: SegmentData[] = [];
  const numSegments = closed ? n : n - 1;

  for (let i = 0; i < numSegments; i++) {
    const A = getPoint(i);
    const B = getPoint(i + 1);
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    segments.push({
      length,
      midX: (A.x + B.x) / 2,
      midY: (A.y + B.y) / 2,
      ax: 0, // Will be updated when we know centroid
      ay: 0,
      bx: 0,
      by: 0,
    });
  }

  // Process each point
  for (let i = 0; i < n; i++) {
    const halfWindow = Math.floor(windowSize / 2);

    // Collect segments in window (with wrapping for closed paths)
    const windowSegments: SegmentData[] = [];
    const segmentIndices: number[] = [];

    for (let offset = -halfWindow; offset <= halfWindow; offset++) {
      let segIdx: number;
      if (closed) {
        segIdx = ((i + offset) % numSegments + numSegments) % numSegments;
      } else {
        segIdx = Math.max(0, Math.min(numSegments - 1, i + offset));
      }

      // Avoid duplicates in non-closed paths
      if (!segmentIndices.includes(segIdx)) {
        windowSegments.push(segments[segIdx]);
        segmentIndices.push(segIdx);
      }
    }

    // Calculate weighted centroid
    let totalLength = 0;
    let weightedCx = 0;
    let weightedCy = 0;

    for (const seg of windowSegments) {
      totalLength += seg.length;
      weightedCx += seg.length * seg.midX;
      weightedCy += seg.length * seg.midY;
    }

    const centroidX = weightedCx / totalLength;
    const centroidY = weightedCy / totalLength;

    // Update segment positions relative to centroid and compute covariance
    let covXX = 0;
    let covXY = 0;
    let covYY = 0;

    for (let j = 0; j < segmentIndices.length; j++) {
      const seg = windowSegments[j];
      const segIdx = segmentIndices[j];
      const A = getPoint(segIdx);
      const B = getPoint(segIdx + 1);

      const ax = A.x - centroidX;
      const ay = A.y - centroidY;
      const bx = B.x - centroidX;
      const by = B.y - centroidY;

      const L = seg.length;
      covXX += (L / 3) * (ax * ax + ax * bx + bx * bx);
      covXY += (L / 3) * (ax * ay + ax * by + bx * by);
      covYY += (L / 3) * (ay * ay + ay * by + by * by);
    }

    // Eigenvalue decomposition to get principal direction
    const trace = covXX + covYY;
    const det = covXX * covYY - covXY * covXY;
    const lambda1 = trace / 2 + Math.sqrt(Math.max(0, trace * trace / 4 - det));

    // Eigenvector for largest eigenvalue
    let dx: number, dy: number;
    if (Math.abs(covXY) > 1e-10) {
      dx = lambda1 - covYY;
      dy = covXY;
    } else if (covXX > covYY) {
      dx = 1;
      dy = 0;
    } else {
      dx = 0;
      dy = 1;
    }

    // Normalize direction
    const dirLength = Math.sqrt(dx * dx + dy * dy);
    if (dirLength > 1e-10) {
      dx /= dirLength;
      dy /= dirLength;
    }

    // Calculate curvature: distance from line
    const currentPoint = points[i];
    const windowStart = getPoint(i - halfWindow);
    const windowEnd = getPoint(i + halfWindow);

    const dist1 = Math.abs(
      (currentPoint.x - centroidX) * dy - (currentPoint.y - centroidY) * dx,
    );
    const dist2 = Math.abs(
      (windowStart.x - centroidX) * dy - (windowStart.y - centroidY) * dx,
    );
    const dist3 = Math.abs(
      (windowEnd.x - centroidX) * dy - (windowEnd.y - centroidY) * dx,
    );

    // filter out distances that are too small
    // Use approximately sqrt(2)/2 as threshold, to filter out diagonal pixel artifacts
    const threshold = Math.SQRT2 / 2;
    const filteredDist1 = dist1 < threshold ? 0 : dist1;
    const filteredDist2 = dist2 < threshold ? 0 : dist2;
    const filteredDist3 = dist3 < threshold ? 0 : dist3;

    const totalCurvature = filteredDist1 + filteredDist2 + filteredDist3;
    curvatures.push(totalCurvature);

    // Call debug callback if provided
    if (debugCallback) {
      debugCallback(
        currentPoint.x,
        currentPoint.y,
        dy, // Perpendicular to line direction
        -dx, // Perpendicular to line direction
        totalCurvature,
      );
    }
  }

  return curvatures;
}

/**
 * Find local maxima in an array of values
 * @param values Array of values to analyze
 * @param threshold Minimum value to consider as a maximum
 * @param closed Whether the path is closed (wraps around)
 * @returns Indices of local maxima
 */
function findLocalMaxima(
  values: number[],
  threshold: number,
  closed: boolean,
): number[] {
  const maxima: number[] = [];
  const n = values.length;

  // For open paths, skip first and last points (no neighbors to compare)
  // For closed paths, check all points but only up to n-1 to avoid duplicate detection
  // at the wrap-around point (since point 0's window includes point n-1)
  const start = closed ? 0 : 1;
  const end = closed ? n - 1 : n - 1;

  for (let i = start; i < end; i++) {
    const curr = values[i];

    // Skip if below threshold
    if (curr < threshold) {
      continue;
    }

    // Check if local maximum (with wrapping for closed paths)
    let prev: number, next: number;

    if (closed) {
      prev = values[(i - 1 + n) % n];
      next = values[(i + 1) % n];
    } else {
      prev = values[i - 1];
      next = values[i + 1];
    }

    if (curr > prev && curr > next) {
      maxima.push(i);
    }
  }

  return maxima;
}
