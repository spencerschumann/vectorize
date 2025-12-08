/**
 * Vectorization module - converts skeletonized binary images to vector paths
 */

import type { BinaryImage } from "../src/formats/binary.ts";

export interface Vertex {
  x: number;
  y: number;
  id: number; // Only used during tracing
  neighbors: number[]; // Only used during tracing
}

export interface VectorPath {
  vertices: number[]; // Vertex IDs during tracing
  closed: boolean;
}

export interface SimplifiedPath {
  points: Array<{ x: number; y: number }>; // Just coordinates after simplification
  closed: boolean;
}

export interface VectorizedImage {
  width: number;
  height: number;
  paths: SimplifiedPath[]; // Use SimplifiedPath after vectorization
}

/**
 * Convert a skeletonized binary image to vertices and connected paths
 * Single-pass algorithm that traces complete paths
 */
export function vectorizeSkeleton(binary: BinaryImage): VectorizedImage {
  const { width, height } = binary;

  // Helper to get vertex ID from coordinates
  const getVertexId = (x: number, y: number) => y * width + x;

  const paths: VectorPath[] = [];
  const visited = new Set<number>();
  const vertices = new Map<number, Vertex>();

  // Helper to get unvisited neighbors (cardinal first, then diagonal)
  const getUnvisitedNeighbors = (
    x: number,
    y: number,
  ): Array<[number, number]> => {
    const neighbors: Array<[number, number]> = [];

    // Cardinal directions first
    const cardinalOffsets: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [
      -1,
      0,
    ]];
    for (const [dx, dy] of cardinalOffsets) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nId = getVertexId(nx, ny);
        if (isPixelSet(binary, nx, ny) && !visited.has(nId)) {
          neighbors.push([nx, ny]);
        }
      }
    }

    // Then diagonals (only if no stair-step path exists)
    const diagonalOffsets: Array<[number, number]> = [[-1, -1], [1, -1], [
      -1,
      1,
    ], [1, 1]];
    for (const [dx, dy] of diagonalOffsets) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nId = getVertexId(nx, ny);
        if (isPixelSet(binary, nx, ny) && !visited.has(nId)) {
          // Check if there's a stair-step path to this diagonal
          const hasStairStep = cardinalOffsets.some(([cdx, cdy]) => {
            const cx = x + cdx;
            const cy = y + cdy;
            if (
              cx >= 0 && cx < width && cy >= 0 && cy < height &&
              isPixelSet(binary, cx, cy)
            ) {
              const dcx = nx - cx;
              const dcy = ny - cy;
              return Math.abs(dcx) + Math.abs(dcy) === 1;
            }
            return false;
          });

          if (!hasStairStep) {
            neighbors.push([nx, ny]);
          }
        }
      }
    }

    return neighbors;
  };

  // Helper to extend path in one direction
  const extendPath = (pathVertices: number[], forward: boolean): void => {
    while (true) {
      const currentId = forward
        ? pathVertices[pathVertices.length - 1]
        : pathVertices[0];
      const currentVertex = vertices.get(currentId);
      if (!currentVertex) break;

      const neighbors = getUnvisitedNeighbors(currentVertex.x, currentVertex.y);

      // Stop if no neighbors
      if (neighbors.length === 0) break;

      // Always continue into the first available neighbor
      // (even at junctions - this ensures paths connect through junction points)
      const [nx, ny] = neighbors[0];
      const nextId = getVertexId(nx, ny);

      // Add vertex to map if not already there
      if (!vertices.has(nextId)) {
        vertices.set(nextId, { x: nx, y: ny, id: nextId, neighbors: [] });
      }

      visited.add(nextId);

      if (forward) {
        pathVertices.push(nextId);
      } else {
        pathVertices.unshift(nextId);
      }

      // After adding the next pixel, if IT has multiple unvisited neighbors, stop
      // (it's a junction and will be the start point for other paths)
      const nextNeighbors = getUnvisitedNeighbors(nx, ny);
      if (nextNeighbors.length > 1) break;
    }
  };

  // Iterate through all pixels to find paths
  // Optimize by checking entire bytes at once
  let totalPixels = 0;

  for (let byteIdx = 0; byteIdx < binary.data.length; byteIdx++) {
    const byte = binary.data[byteIdx];
    if (byte === 0) continue; // Skip empty bytes

    // Check each bit in this byte
    const startPixelIdx = byteIdx * 8;
    for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
      if ((byte & (1 << (7 - bitIdx))) === 0) continue;

      const pixelIdx = startPixelIdx + bitIdx;
      const x = pixelIdx % width;
      const y = Math.floor(pixelIdx / width);

      if (y >= height) break; // Past end of image

      totalPixels++;
      const id = getVertexId(x, y);
      if (visited.has(id)) continue;

      // Start a new path
      const pathVertices: number[] = [id];
      visited.add(id);

      // Add vertex to map if not already there
      if (!vertices.has(id)) {
        vertices.set(id, { x, y, id, neighbors: [] });
      }

      // Extend in both directions
      extendPath(pathVertices, true); // Extend forward
      extendPath(pathVertices, false); // Extend backward

      // Add all paths, even single pixels (they're isolated points)
      paths.push({
        vertices: pathVertices,
        closed: false,
      });
    }
  }

  console.log(
    `Vectorization: ${totalPixels} skeleton pixels, visited ${visited.size}, traced ${paths.length} paths`,
  );

  // Mark paths as closed if endpoints are within 1 pixel
  for (const path of paths) {
    if (path.vertices.length >= 3) {
      const startV = vertices.get(path.vertices[0])!;
      const endV = vertices.get(path.vertices[path.vertices.length - 1])!;
      if (
        Math.abs(startV.x - endV.x) <= 1 && Math.abs(startV.y - endV.y) <= 1
      ) {
        path.closed = true;
        if (startV.x !== endV.x || startV.y !== endV.y) {
          // If endpoints are different but close, connect them
          path.vertices.push(path.vertices[0]);
        }
      }
    }
  }

  // First, run a light Douglas-Peucker pass to simplify trivial cases
  const dpPaths = paths.map((path) => douglasPeucker(path, vertices, 0.1));
  const totalDPBefore = paths.reduce((sum, p) => sum + p.vertices.length, 0);
  const totalDPAfter = dpPaths.reduce((sum, p) => sum + p.vertices.length, 0);
  console.log(
    `Vectorization: DP pass simplified from ${totalDPBefore} to ${totalDPAfter} vertices`,
  );

  // Apply segmented linear regression to simplify paths
  const simplifiedPaths = dpPaths.map((path) =>
    segmentedLinearRegression(path, vertices, width, 0.75)
  );

  const totalVerticesBefore = dpPaths.reduce(
    (sum, p) => sum + p.vertices.length,
    0,
  );
  const totalVerticesAfter = simplifiedPaths.reduce(
    (sum, p) => sum + p.vertices.length,
    0,
  );
  console.log(
    `Vectorization: SLR simplified from ${totalVerticesBefore} to ${totalVerticesAfter} vertices (${
      ((1 - totalVerticesAfter / totalVerticesBefore) * 100).toFixed(1)
    }% reduction)`,
  );

  // Convert to SimplifiedPath (just coordinates, no IDs)
  const finalPaths: SimplifiedPath[] = simplifiedPaths.map((path) => ({
    points: path.vertices.map((id) => {
      const v = vertices.get(id);
      return v ? { x: v.x, y: v.y } : { x: 0, y: 0 }; // Fallback for missing vertices
    }),
    closed: path.closed,
  }));

  return {
    width,
    height,
    paths: finalPaths,
  };
}

/**
 * Segmented Linear Regression with continuous weighting
 * Recursively fits lines to path segments, splitting at worst outliers
 * Exported for testing
 */
export function segmentedLinearRegression(
  path: VectorPath,
  vertices: Map<number, Vertex>,
  width: number,
  epsilon: number,
): VectorPath {
  if (path.vertices.length <= 2) {
    return path;
  }

  let coords = path.vertices.map((id) => vertices.get(id)!);

  // For closed paths, remove the duplicate endpoint before processing
  let wasClosed = path.closed;
  if (wasClosed && coords.length > 2) {
    // TODO: improve this by splitting at the point furthest from the start/end
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first.x === last.x && first.y === last.y) {
      coords = coords.slice(0, -1); // Remove duplicate endpoint
    }
  }

  const simplified = slrRecursive(coords, epsilon, width, wasClosed);

  // Add any new projected vertices to the map
  for (const vertex of simplified) {
    if (!vertices.has(vertex.id)) {
      vertices.set(vertex.id, vertex);
    }
  }

  // For closed paths, add back the duplicate endpoint
  const resultVertices = simplified.map((v) => v.id);
  if (wasClosed && simplified.length > 0) {
    resultVertices.push(simplified[0].id); // Close the path
  }

  return {
    vertices: resultVertices,
    closed: wasClosed,
  };
}

function slrRecursive(
  points: Vertex[],
  epsilon: number,
  width: number,
  isClosed: boolean = false,
): Vertex[] {
  if (points.length <= 2) {
    return points;
  }

  // Fit a line to all segments using continuous weighting
  const { direction, centroid, maxError } = fitLineToSegments(points);

  if (maxError <= epsilon) {
    // Good fit - project endpoints onto fitted line
    const start = points[0];
    const end = points[points.length - 1];

    // Project onto line through centroid with given direction
    const projStart = projectOntoLine(start, centroid, direction);
    const projEnd = projectOntoLine(end, centroid, direction);

    // debug output: show points, centroid, direction,
    console.log(
      `\n=== SLR: Good fit (error ${maxError.toFixed(2)} <= ${epsilon}) ===`,
    );
    console.log(`Points: ${points.map((p) => `(${p.x},${p.y})`).join(", ")}`);
    console.log(
      `Centroid: (${centroid.x.toFixed(2)}, ${centroid.y.toFixed(2)})`,
    );
    console.log(
      `Direction: (${direction.x.toFixed(3)}, ${direction.y.toFixed(3)})`,
    );
    console.log(
      `Projected start: (${projStart.x.toFixed(2)}, ${projStart.y.toFixed(2)})`,
    );
    console.log(
      `Projected end: (${projEnd.x.toFixed(2)}, ${projEnd.y.toFixed(2)})`,
    );

    // Create new vertices for projected endpoints
    const startId = projStart.y * width + projStart.x;
    const endId = projEnd.y * width + projEnd.x;

    return [
      { ...projStart, id: startId, neighbors: [] },
      { ...projEnd, id: endId, neighbors: [] },
    ];
  }

  // Line doesn't fit well enough - split using DP method
  // Find worst outlier from straight line between endpoints
  const start = points[0];
  const end = points[points.length - 1];

  let maxDist = 0;
  let maxDistIndex = 1;

  // Calculate perpendicular distance from each interior point to line segment
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lineLen = Math.sqrt(dx * dx + dy * dy);

  if (lineLen < 1e-10) {
    // Degenerate case: start and end are the same point
    return [start, end];
  }

  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    // Perpendicular distance from point to line
    const dist = Math.abs(
      (end.y - start.y) * p.x - (end.x - start.x) * p.y + end.x * start.y -
        end.y * start.x,
    ) / lineLen;

    if (dist > maxDist) {
      maxDist = dist;
      maxDistIndex = i;
    }
  }

  // Split at the worst outlier
  const left = slrRecursive(
    points.slice(0, maxDistIndex + 1),
    epsilon,
    width,
    false,
  );
  const right = slrRecursive(points.slice(maxDistIndex), epsilon, width, false);

  // Merge with intersection
  if (left.length > 1 && right.length > 1) {
    // Find intersection of the two line segments
    const intersection = findLineIntersection(
      left[left.length - 2],
      left[left.length - 1],
      right[0],
      right[1],
    );

    if (intersection) {
      const intId = intersection.y * width + intersection.x;
      const intVertex = { ...intersection, id: intId, neighbors: [] };

      return [
        ...left.slice(0, -1),
        intVertex,
        ...right.slice(1),
      ];
    }
  }

  // Fallback: simple concatenation without duplicate middle point
  return [...left.slice(0, -1), ...right];
}

/**
 * Fit a line to path segments using continuous weighting
 */
export function fitLineToSegments(points: Vertex[]): {
  direction: { x: number; y: number };
  centroid: { x: number; y: number };
  maxError: number;
  maxErrorIndex: number;
} {
  // Compute continuous centroid weighted by segment lengths
  let totalLength = 0;
  let weightedCx = 0;
  let weightedCy = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const A = points[i];
    const B = points[i + 1];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const L = Math.sqrt(dx * dx + dy * dy);

    const segmentCentroid = {
      x: (A.x + B.x) / 2,
      y: (A.y + B.y) / 2,
    };

    totalLength += L;
    weightedCx += L * segmentCentroid.x;
    weightedCy += L * segmentCentroid.y;
  }

  const centroid = {
    x: weightedCx / totalLength,
    y: weightedCy / totalLength,
  };

  // Compute continuous second moment / covariance tensor
  let covXX = 0;
  let covXY = 0;
  let covYY = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const A = points[i];
    const B = points[i + 1];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const L = Math.sqrt(dx * dx + dy * dy);

    // Relative positions from overall centroid
    const Ax = A.x - centroid.x;
    const Ay = A.y - centroid.y;
    const Bx = B.x - centroid.x;
    const By = B.y - centroid.y;

    // Segment contribution to covariance: (L/3) * [AA^T + AB^T + BB^T]
    // This is the integral along the line segment from A to B
    covXX += (L / 3) * (Ax * Ax + Ax * Bx + Bx * Bx);
    covXY += (L / 3) * (Ax * Ay + Ax * By + Bx * By);
    covYY += (L / 3) * (Ay * Ay + Ay * By + By * By);
  }

  // Eigenvalue decomposition to get principal direction
  const trace = covXX + covYY;
  const det = covXX * covYY - covXY * covXY;
  const lambda1 = trace / 2 + Math.sqrt(Math.max(0, trace * trace / 4 - det));

  // Eigenvector for largest eigenvalue
  let dx, dy;
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
  dx /= dirLength;
  dy /= dirLength;

  const direction = { x: dx, y: dy };

  // Calculate max perpendicular error (excluding endpoints)
  let maxError = 0;
  let maxErrorIndex = 1; // Start at 1 to skip first endpoint

  for (let i = 1; i < points.length - 1; i++) { // Exclude first and last points
    const p = points[i];
    const vx = p.x - centroid.x;
    const vy = p.y - centroid.y;
    const error = Math.abs(vx * dy - vy * dx); // Perpendicular distance

    if (error > maxError) {
      maxError = error;
      maxErrorIndex = i;
    }
  }

  return { direction, centroid, maxError, maxErrorIndex };
}

/**
 * Project a point onto a line defined by a point and direction
 */
function projectOntoLine(
  point: { x: number; y: number },
  linePoint: { x: number; y: number },
  direction: { x: number; y: number },
): { x: number; y: number } {
  const vx = point.x - linePoint.x;
  const vy = point.y - linePoint.y;
  const t = vx * direction.x + vy * direction.y;

  return {
    x: linePoint.x + t * direction.x,
    y: linePoint.y + t * direction.y,
  };
}

/**
 * Find intersection of two line segments defined by their endpoints
 */
function findLineIntersection(
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): { x: number; y: number } | null {
  const dx1 = a2.x - a1.x;
  const dy1 = a2.y - a1.y;
  const dx2 = b2.x - b1.x;
  const dy2 = b2.y - b1.y;

  const denom = dx1 * dy2 - dy1 * dx2;

  if (Math.abs(denom) < 1e-10) {
    // Parallel or collinear - return midpoint of closest endpoints
    return {
      x: Math.round((a2.x + b1.x) / 2),
      y: Math.round((a2.y + b1.y) / 2),
    };
  }

  const dx3 = b1.x - a1.x;
  const dy3 = b1.y - a1.y;

  const t = (dx3 * dy2 - dy3 * dx2) / denom;

  return {
    x: Math.round(a1.x + t * dx1),
    y: Math.round(a1.y + t * dy1),
  };
}

/**
 * Douglas-Peucker algorithm to simplify a path by removing unnecessary vertices
 */
function douglasPeucker(
  path: VectorPath,
  vertices: Map<number, Vertex>,
  epsilon: number,
): VectorPath {
  if (path.vertices.length <= 2) {
    return path;
  }

  const vertexCoords = path.vertices.map((id) => vertices.get(id)!);
  const simplified = douglasPeuckerRecursive(vertexCoords, epsilon);

  return {
    vertices: simplified.map((v) => v.id),
    closed: path.closed,
  };
}

function douglasPeuckerRecursive(points: Vertex[], epsilon: number): Vertex[] {
  if (points.length <= 2) {
    return points;
  }

  // Find the point with the maximum distance from the line
  let maxDistance = 0;
  let maxIndex = 0;
  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistance(points[i], start, end);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }

  // If max distance is greater than epsilon, recursively simplify
  if (maxDistance > epsilon) {
    const left = douglasPeuckerRecursive(
      points.slice(0, maxIndex + 1),
      epsilon,
    );
    const right = douglasPeuckerRecursive(points.slice(maxIndex), epsilon);

    // Concatenate, removing duplicate middle point
    return [...left.slice(0, -1), ...right];
  } else {
    // All points are close to the line, keep only endpoints
    return [start, end];
  }
}

function perpendicularDistance(
  point: Vertex,
  lineStart: Vertex,
  lineEnd: Vertex,
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;

  // If the line segment is a point, return distance to that point
  if (dx === 0 && dy === 0) {
    return Math.sqrt(
      (point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2,
    );
  }

  // Calculate perpendicular distance using cross product
  const numerator = Math.abs(
    dy * point.x - dx * point.y + lineEnd.x * lineStart.y -
      lineEnd.y * lineStart.x,
  );
  const denominator = Math.sqrt(dx * dx + dy * dy);

  return numerator / denominator;
}

/**
 * Trace a path between two vertices, following the skeleton
 */
/**
 * Check if a pixel is set in a binary image
 */
function isPixelSet(binary: BinaryImage, x: number, y: number): boolean {
  const pixelIndex = y * binary.width + x;
  const byteIndex = Math.floor(pixelIndex / 8);
  const bitIndex = 7 - (pixelIndex % 8);

  if (byteIndex >= binary.data.length) return false;

  return (binary.data[byteIndex] & (1 << bitIndex)) !== 0;
}

/**
 * Render vectorized image as SVG overlay on top of canvas
 */
export function renderVectorizedToSVG(
  vectorized: VectorizedImage,
  svgElement: SVGSVGElement,
) {
  const { width, height, paths } = vectorized;

  // Set SVG size and viewBox to match image
  svgElement.setAttribute("width", width.toString());
  svgElement.setAttribute("height", height.toString());
  svgElement.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svgElement.style.display = "block";

  // Clear existing paths
  svgElement.innerHTML = "";

  // Draw each path as an SVG path element
  for (const path of paths) {
    if (path.points.length === 0) continue;

    const firstPoint = path.points[0];

    // Shift by 0.5 pixels to align with pixel centers
    let pathData = `M ${firstPoint.x + 0.5} ${firstPoint.y + 0.5}`;

    for (let i = 1; i < path.points.length; i++) {
      const point = path.points[i];
      pathData += ` L ${point.x + 0.5} ${point.y + 0.5}`;
    }

    if (path.closed) {
      pathData += " Z";
    }

    const pathElement = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    pathElement.setAttribute("d", pathData);
    pathElement.setAttribute("fill", "none");
    pathElement.setAttribute("stroke", "red");
    pathElement.setAttribute("stroke-width", "0.5");
    pathElement.setAttribute("vector-effect", "non-scaling-stroke");
    svgElement.appendChild(pathElement);
  }

  // Draw vertices as circles
  for (const path of paths) {
    for (const point of path.points) {
      const circle = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle",
      );
      circle.setAttribute("cx", (point.x + 0.5).toString());
      circle.setAttribute("cy", (point.y + 0.5).toString());
      circle.setAttribute("r", "0.5");
      circle.setAttribute("fill", "#00aa00");
      circle.setAttribute("vector-effect", "non-scaling-stroke");
      svgElement.appendChild(circle);
    }
  }
}
