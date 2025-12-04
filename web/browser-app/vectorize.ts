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
 * Only creates vertices at key points: endpoints, junctions, and corners
 */
export function vectorizeSkeleton(binary: BinaryImage): VectorizedImage {
  const { width, height } = binary;
  
  // Helper to get vertex ID from coordinates
  const getVertexId = (x: number, y: number) => y * width + x;
  
  // Count neighbors for each pixel (8-way connectivity)
  const countNeighbors = (x: number, y: number): number => {
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && isPixelSet(binary, nx, ny)) {
          count++;
        }
      }
    }
    return count;
  };
  
  // Check if a pixel is a corner (has 2 neighbors but they're not opposite)
  const isCorner = (x: number, y: number): boolean => {
    const neighbors: Array<[number, number]> = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && isPixelSet(binary, nx, ny)) {
          neighbors.push([dx, dy]);
        }
      }
    }
    
    if (neighbors.length !== 2) return false;
    
    // Check if neighbors are opposite (would make it a straight line, not a corner)
    const [dx1, dy1] = neighbors[0];
    const [dx2, dy2] = neighbors[1];
    
    // Opposite if both deltas are negatives of each other
    return !(dx1 === -dx2 && dy1 === -dy2);
  };
  
  // First pass: create vertices at key points
  // - Endpoints (1 neighbor)
  // - Corners (2 neighbors that aren't opposite)
  // - Junctions (3+ neighbors)
  const vertices = new Map<number, Vertex>();
  let vertexCount = 0;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isPixelSet(binary, x, y)) {
        const neighborCount = countNeighbors(x, y);
        
        // Create vertex at endpoints, corners, and junctions
        if (neighborCount === 1 || neighborCount >= 3 || (neighborCount === 2 && isCorner(x, y))) {
          const id = getVertexId(x, y);
          vertices.set(id, {
            x,
            y,
            id,
            neighbors: [],
          });
          vertexCount++;
          
          // Limit vertex count to prevent memory issues
          if (vertexCount > 100000) {
            console.warn("Vectorization: Too many vertices (>100k), aborting");
            return {
              width,
              height,
              paths: [],
              vertices: new Map(),
            };
          }
        }
      }
    }
  }
  
  console.log(`Vectorization: Created ${vertices.size} vertices at key points`);
  
  // Second pass: trace paths between vertices
  // Prioritize cardinal directions to avoid diagonal shortcuts through stair-steps
  const paths: VectorPath[] = [];
  
  for (const startVertex of vertices.values()) {
    // Check cardinal directions first (N, E, S, W)
    const cardinalOffsets = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (const [dx, dy] of cardinalOffsets) {
      const nx = startVertex.x + dx;
      const ny = startVertex.y + dy;
      
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && isPixelSet(binary, nx, ny)) {
        const path = tracePathBetweenVertices(binary, startVertex, nx, ny, vertices, width, height, getVertexId);
        
        if (path && path.vertices.length >= 2) {
          const isDuplicate = paths.some(p => 
            (p.vertices[0] === path.vertices[0] && p.vertices[p.vertices.length - 1] === path.vertices[path.vertices.length - 1]) ||
            (p.vertices[0] === path.vertices[path.vertices.length - 1] && p.vertices[p.vertices.length - 1] === path.vertices[0])
          );
          
          if (!isDuplicate) {
            paths.push(path);
          }
        }
      }
    }
    
    // Then check diagonal directions (NW, NE, SW, SE)
    // Only add diagonal paths if the target isn't already connected via cardinal stair-steps
    const diagonalOffsets = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
    for (const [dx, dy] of diagonalOffsets) {
      const nx = startVertex.x + dx;
      const ny = startVertex.y + dy;
      
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && isPixelSet(binary, nx, ny)) {
        // Check if there's a stair-step path (via cardinal neighbors) to this diagonal pixel
        const hasStairStep = cardinalOffsets.some(([cdx, cdy]) => {
          const cx = startVertex.x + cdx;
          const cy = startVertex.y + cdy;
          
          // Check if cardinal neighbor exists and connects to the diagonal pixel
          if (cx >= 0 && cx < width && cy >= 0 && cy < height && isPixelSet(binary, cx, cy)) {
            // Check if this cardinal neighbor connects to the diagonal pixel
            const dcx = nx - cx;
            const dcy = ny - cy;
            const cdx2 = nx - startVertex.x - cdx;
            const cdy2 = ny - startVertex.y - cdy;
            
            // If cardinal neighbor can reach diagonal pixel with one cardinal step, it's a stair-step
            return (Math.abs(dcx) + Math.abs(dcy) === 1);
          }
          return false;
        });
        
        // Skip diagonal if stair-step exists
        if (hasStairStep) continue;
        
        const path = tracePathBetweenVertices(binary, startVertex, nx, ny, vertices, width, height, getVertexId);
        
        if (path && path.vertices.length >= 2) {
          const isDuplicate = paths.some(p => 
            (p.vertices[0] === path.vertices[0] && p.vertices[p.vertices.length - 1] === path.vertices[path.vertices.length - 1]) ||
            (p.vertices[0] === path.vertices[path.vertices.length - 1] && p.vertices[p.vertices.length - 1] === path.vertices[0])
          );
          
          if (!isDuplicate) {
            paths.push(path);
          }
        }
      }
    }
  }
  
  console.log(`Vectorization: Traced ${paths.length} paths`);
  
  return {
    width,
    height,
    paths,
    vertices,
  };
}

/**
 * Trace a path between two vertices, following the skeleton
 */
function tracePathBetweenVertices(
  binary: BinaryImage,
  startVertex: Vertex,
  startX: number,
  startY: number,
  vertices: Map<number, Vertex>,
  width: number,
  height: number,
  getVertexId: (x: number, y: number) => number
): VectorPath | null {
  const pathVertices: number[] = [startVertex.id];
  const visited = new Set<number>();
  visited.add(startVertex.id);
  
  let x = startX;
  let y = startY;
  let prevX = startVertex.x;
  let prevY = startVertex.y;
  
  // Follow the skeleton until we hit another vertex
  let steps = 0;
  const maxSteps = 10000; // Prevent infinite loops
  
  while (steps++ < maxSteps) {
    const currentId = getVertexId(x, y);
    
    // Check if we reached another vertex
    if (vertices.has(currentId)) {
      pathVertices.push(currentId);
      return {
        vertices: pathVertices,
        closed: false,
      };
    }
    
    visited.add(currentId);
    
    // Find next pixel - prioritize cardinal directions over diagonals
    // This prevents diagonal shortcuts through stair-steps
    let nextX = -1;
    let nextY = -1;
    let found = false;
    
    // First, check cardinal directions (N, E, S, W)
    const cardinalOffsets = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (const [dx, dy] of cardinalOffsets) {
      const nx = x + dx;
      const ny = y + dy;
      
      // Skip previous position
      if (nx === prevX && ny === prevY) continue;
      
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        const nId = getVertexId(nx, ny);
        if (isPixelSet(binary, nx, ny) && !visited.has(nId)) {
          nextX = nx;
          nextY = ny;
          found = true;
          break;
        }
      }
    }
    
    // Only check diagonals if no cardinal direction available
    if (!found) {
      const diagonalOffsets = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      for (const [dx, dy] of diagonalOffsets) {
        const nx = x + dx;
        const ny = y + dy;
        
        // Skip previous position
        if (nx === prevX && ny === prevY) continue;
        
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const nId = getVertexId(nx, ny);
          if (isPixelSet(binary, nx, ny) && !visited.has(nId)) {
            nextX = nx;
            nextY = ny;
            found = true;
            break;
          }
        }
      }
    }
    
    if (!found) {
      // Dead end - shouldn't happen in well-skeletonized image
      return null;
    }
    
    prevX = x;
    prevY = y;
    x = nextX;
    y = nextY;
  }
  
  console.warn("Path tracing exceeded max steps");
  return null;
}

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
  
  // Draw vertices as circles
  for (const vertex of vertices.values()) {
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
