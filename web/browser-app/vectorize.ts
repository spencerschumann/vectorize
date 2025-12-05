/**
 * Vectorization module - converts skeletonized binary images to vector paths
 */

import type { BinaryImage } from "../src/formats/binary.ts";

export interface Vertex {
  x: number;
  y: number;
  id: number;
  neighbors: number[]; // Store neighbor IDs instead of references
}

export interface VectorPath {
  vertices: number[]; // Store vertex IDs
  closed: boolean;
}

export interface VectorizedImage {
  width: number;
  height: number;
  paths: VectorPath[];
  vertices: Map<number, Vertex>; // Map from ID to vertex
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
  const getUnvisitedNeighbors = (x: number, y: number): Array<[number, number]> => {
    const neighbors: Array<[number, number]> = [];
    
    // Cardinal directions first
    const cardinalOffsets: Array<[number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
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
    const diagonalOffsets: Array<[number, number]> = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
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
            if (cx >= 0 && cx < width && cy >= 0 && cy < height && isPixelSet(binary, cx, cy)) {
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
      const currentId = forward ? pathVertices[pathVertices.length - 1] : pathVertices[0];
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
      extendPath(pathVertices, true);   // Extend forward
      extendPath(pathVertices, false);  // Extend backward
      
      // Add all paths, even single pixels (they're isolated points)
      paths.push({
        vertices: pathVertices,
        closed: false,
      });
    }
  }
  
  console.log(`Vectorization: ${totalPixels} skeleton pixels, visited ${visited.size}, traced ${paths.length} paths`);
  
  // Simplify paths using Douglas-Peucker
  // Use threshold 0.7 to remove stair-step vertices (which are ~0.28-0.56 pixels from diagonal)
  // while preserving real corners
  const simplifiedPaths = paths.map(path => douglasPeucker(path, vertices, 0.9));
  
  // Count vertices before and after simplification
  const totalVerticesBefore = paths.reduce((sum, p) => sum + p.vertices.length, 0);
  const totalVerticesAfter = simplifiedPaths.reduce((sum, p) => sum + p.vertices.length, 0);
  console.log(`Vectorization: Simplified from ${totalVerticesBefore} to ${totalVerticesAfter} path vertices (${((1 - totalVerticesAfter/totalVerticesBefore) * 100).toFixed(1)}% reduction)`);
  
  return {
    width,
    height,
    paths: simplifiedPaths,
    vertices,
  };
}

/**
 * Douglas-Peucker algorithm to simplify a path by removing unnecessary vertices
 */
function douglasPeucker(path: VectorPath, vertices: Map<number, Vertex>, epsilon: number): VectorPath {
  if (path.vertices.length <= 2) {
    return path;
  }
  
  const vertexCoords = path.vertices.map(id => vertices.get(id)!);
  const simplified = douglasPeuckerRecursive(vertexCoords, epsilon);
  
  return {
    vertices: simplified.map(v => v.id),
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
    const left = douglasPeuckerRecursive(points.slice(0, maxIndex + 1), epsilon);
    const right = douglasPeuckerRecursive(points.slice(maxIndex), epsilon);
    
    // Concatenate, removing duplicate middle point
    return [...left.slice(0, -1), ...right];
  } else {
    // All points are close to the line, keep only endpoints
    return [start, end];
  }
}

function perpendicularDistance(point: Vertex, lineStart: Vertex, lineEnd: Vertex): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  
  // If the line segment is a point, return distance to that point
  if (dx === 0 && dy === 0) {
    return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
  }
  
  // Calculate perpendicular distance using cross product
  const numerator = Math.abs(dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x);
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
 * Convert vectorized image to SVG path data
 */
export function vectorizedToSVG(vectorized: VectorizedImage): string {
  const { width, height, paths, vertices } = vectorized;
  
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">\n`;
  svg += `  <rect width="${width}" height="${height}" fill="white"/>\n`;
  
  // Draw each path
  for (const path of paths) {
    if (path.vertices.length === 0) continue;
    
    const firstVertex = vertices.get(path.vertices[0]);
    if (!firstVertex) continue;
    
    let pathData = `M ${firstVertex.x} ${firstVertex.y}`;
    
    for (let i = 1; i < path.vertices.length; i++) {
      const vertex = vertices.get(path.vertices[i]);
      if (vertex) {
        pathData += ` L ${vertex.x} ${vertex.y}`;
      }
    }
    
    if (path.closed) {
      pathData += ' Z';
    }
    
    svg += `  <path d="${pathData}" fill="none" stroke="black" stroke-width="0.5"/>\n`;
  }
  
  svg += '</svg>';
  
  return svg;
}

/**
 * Render vectorized image as SVG overlay on top of canvas
 */
export function renderVectorizedToSVG(
  vectorized: VectorizedImage,
  svgElement: SVGSVGElement,
) {
  const { width, height, paths, vertices } = vectorized;
  
  // Set SVG size and viewBox to match image
  svgElement.setAttribute('width', width.toString());
  svgElement.setAttribute('height', height.toString());
  svgElement.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svgElement.style.display = 'block';
  
  // Clear existing paths
  svgElement.innerHTML = '';
  
  // Draw each path as an SVG path element
  for (const path of paths) {
    if (path.vertices.length === 0) continue;
    
    const firstVertex = vertices.get(path.vertices[0]);
    if (!firstVertex) continue;
    
    // Shift by 0.5 pixels to align with pixel centers
    let pathData = `M ${firstVertex.x + 0.5} ${firstVertex.y + 0.5}`;
    
    for (let i = 1; i < path.vertices.length; i++) {
      const vertex = vertices.get(path.vertices[i]);
      if (vertex) {
        pathData += ` L ${vertex.x + 0.5} ${vertex.y + 0.5}`;
      }
    }
    
    if (path.closed) {
      pathData += ' Z';
    }
    
    const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathElement.setAttribute('d', pathData);
    pathElement.setAttribute('fill', 'none');
    pathElement.setAttribute('stroke', 'red');
    pathElement.setAttribute('stroke-width', '0.5');
    pathElement.setAttribute('vector-effect', 'non-scaling-stroke');
    svgElement.appendChild(pathElement);
  }
  
  // Draw vertices as circles (only vertices used in paths)
  const usedVertexIds = new Set<number>();
  for (const path of paths) {
    for (const vid of path.vertices) {
      usedVertexIds.add(vid);
    }
  }
  
  for (const vertexId of usedVertexIds) {
    const vertex = vertices.get(vertexId);
    if (!vertex) continue;
    
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', (vertex.x + 0.5).toString());
    circle.setAttribute('cy', (vertex.y + 0.5).toString());
    circle.setAttribute('r', '0.5');
    circle.setAttribute('fill', 'blue');
    circle.setAttribute('vector-effect', 'non-scaling-stroke');
    svgElement.appendChild(circle);
  }
}

/**
 * Render vectorized image to canvas for display (deprecated - use renderVectorizedToSVG)
 */
export function renderVectorizedToCanvas(
  vectorized: VectorizedImage,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
) {
  const { width, height, vertices } = vectorized;
  
  // Set canvas size
  canvas.width = width;
  canvas.height = height;
  
  // Clear canvas with white background
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, width, height);
  
  // Draw vertices as small dots
  ctx.fillStyle = 'black';
  for (const vertex of vertices.values()) {
    ctx.fillRect(vertex.x, vertex.y, 1, 1);
  }
  
  // Draw connections between neighbors
  ctx.strokeStyle = 'red';
  ctx.lineWidth = 0.5;
  
  const drawnConnections = new Set<string>();
  
  for (const vertex of vertices.values()) {
    for (const neighborId of vertex.neighbors) {
      // Create unique key for this connection (both directions)
      const key1 = `${vertex.id}-${neighborId}`;
      const key2 = `${neighborId}-${vertex.id}`;
      
      if (!drawnConnections.has(key1) && !drawnConnections.has(key2)) {
        const neighbor = vertices.get(neighborId);
        if (neighbor) {
          ctx.beginPath();
          ctx.moveTo(vertex.x + 0.5, vertex.y + 0.5);
          ctx.lineTo(neighbor.x + 0.5, neighbor.y + 0.5);
          ctx.stroke();
          
          drawnConnections.add(key1);
        }
      }
    }
  }
}
