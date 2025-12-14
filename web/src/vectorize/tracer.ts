import { type BinaryImage, getPixelBin } from "../formats/binary.ts";
import type { Point } from "./geometry.ts";

export interface GraphNode {
  id: number; // pixel ID (y * width + x)
  point: Point;
  edges: number[]; // indices into edges array
}

export interface GraphEdge {
  id: number;
  points: Point[]; // Ordered list of pixels in the edge
  nodeA: number; // Node ID at start (-1 if loop)
  nodeB: number; // Node ID at end (-1 if loop)
}

export interface Graph {
  nodes: Map<number, GraphNode>;
  edges: GraphEdge[];
}

/**
 * Traces connected paths in a binary image into a graph structure.
 * Converts raster pixels into vector paths with topology.
 */
export function traceGraph(binary: BinaryImage): Graph {
  const width = binary.width;
  const height = binary.height;
  const nodes = new Map<number, GraphNode>();
  const edges: GraphEdge[] = [];
  const visitedEdges = new Set<string>(); // Stores "id1-id2" for visited edge segments

  const getVertexId = (x: number, y: number) => y * width + x;

  const isPixelSet = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    return getPixelBin(binary, x, y) === 1;
  };

  const getNeighbors = (x: number, y: number): Point[] => {
    const neighbors: Point[] = [];

    // Cardinal directions first
    const cardinalOffsets: Point[] = [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ];

    for (const offset of cardinalOffsets) {
      const nx = x + offset.x;
      const ny = y + offset.y;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        if (isPixelSet(nx, ny)) {
          neighbors.push({ x: nx, y: ny });
        }
      }
    }

    // Then diagonals (only if no stair-step path exists)
    const diagonalOffsets: Point[] = [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: -1, y: 1 },
      { x: 1, y: 1 },
    ];

    for (const offset of diagonalOffsets) {
      const nx = x + offset.x;
      const ny = y + offset.y;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        if (isPixelSet(nx, ny)) {
          // Check if there's a stair-step path to this diagonal
          const hasStairStep = cardinalOffsets.some((cardinal) => {
            const cx = x + cardinal.x;
            const cy = y + cardinal.y;
            if (
              cx >= 0 && cx < width && cy >= 0 && cy < height &&
              isPixelSet(cx, cy)
            ) {
              const dcx = nx - cx;
              const dcy = ny - cy;
              return Math.abs(dcx) + Math.abs(dcy) === 1;
            }
            return false;
          });

          if (!hasStairStep) {
            neighbors.push({ x: nx, y: ny });
          }
        }
      }
    }

    return neighbors;
  };

  // Pass 1: Identify Nodes
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isPixelSet(x, y)) {
        const neighbors = getNeighbors(x, y);
        // A node is any pixel that is NOT a simple path continuation (degree 2)
        // Degree 0: Isolated point (Node)
        // Degree 1: Endpoint (Node)
        // Degree 3+: Junction (Node)
        if (neighbors.length !== 2) {
          const id = getVertexId(x, y);
          nodes.set(id, {
            id,
            point: { x, y },
            edges: [],
          });
        }
      }
    }
  }

  // Helper to get edge key
  const getEdgeKey = (id1: number, id2: number) => {
    return id1 < id2 ? `${id1}-${id2}` : `${id2}-${id1}`;
  };

  // Pass 2: Trace Edges from Nodes
  for (const node of nodes.values()) {
    const startNeighbors = getNeighbors(node.point.x, node.point.y);

    for (const neighbor of startNeighbors) {
      const neighborId = getVertexId(neighbor.x, neighbor.y);
      const edgeKey = getEdgeKey(node.id, neighborId);

      if (visitedEdges.has(edgeKey)) continue;

      // Start tracing a new edge
      const pathPoints: Point[] = [node.point, neighbor];
      visitedEdges.add(edgeKey);

      let currentId = neighborId;
      let currentPoint = neighbor;
      let prevId = node.id;

      while (true) {
        // If current point is a node, we are done
        if (nodes.has(currentId)) {
          const edgeIndex = edges.length;
          const endNode = nodes.get(currentId)!;

          // Add edge to graph
          edges.push({
            id: edgeIndex,
            points: pathPoints,
            nodeA: node.id,
            nodeB: endNode.id,
          });

          // Link nodes to edge
          node.edges.push(edgeIndex);
          // Avoid adding duplicate edge reference if startNode == endNode (loop back to self)
          if (node.id !== endNode.id) {
            endNode.edges.push(edgeIndex);
          } else {
            node.edges.push(edgeIndex);
          }
          break;
        }

        // Continue tracing
        const neighbors = getNeighbors(currentPoint.x, currentPoint.y);
        // Find the neighbor that is NOT the previous one
        const next = neighbors.find((n) => getVertexId(n.x, n.y) !== prevId);

        if (!next) {
          // Should not happen if logic is correct (degree 2 check)
          // But if it does, treat as endpoint (which should have been a node)
          break;
        }

        const nextId = getVertexId(next.x, next.y);
        const nextKey = getEdgeKey(currentId, nextId);

        visitedEdges.add(nextKey);
        pathPoints.push(next);

        prevId = currentId;
        currentId = nextId;
        currentPoint = next;
      }
    }
  }

  // Pass 3: Trace Isolated Loops (no nodes)
  // Populate visited pixels from existing edges
  const processedPixels = new Set<number>();
  for (const edge of edges) {
    for (const p of edge.points) {
      processedPixels.add(getVertexId(p.x, p.y));
    }
  }
  for (const node of nodes.values()) {
    processedPixels.add(node.id);
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const id = getVertexId(x, y);
      if (isPixelSet(x, y) && !processedPixels.has(id)) {
        // Found a start of a loop
        const pathPoints: Point[] = [{ x, y }];
        processedPixels.add(id);

        let currentPoint = { x, y };
        let currentId = id;
        let prevId = -1; // No previous for start

        // Trace forward
        while (true) {
          const neighbors = getNeighbors(currentPoint.x, currentPoint.y);
          let next: Point | undefined;

          if (prevId === -1) {
            next = neighbors[0]; // Pick any direction
          } else {
            next = neighbors.find((n) => getVertexId(n.x, n.y) !== prevId);
          }

          if (!next) break; // Should be closed loop

          const nextId = getVertexId(next.x, next.y);

          if (nextId === id && prevId !== -1) {
            // Closed the loop
            pathPoints.push(next);
            break;
          }

          if (processedPixels.has(nextId)) {
            break;
          }

          processedPixels.add(nextId);
          pathPoints.push(next);
          prevId = currentId;
          currentId = nextId;
          currentPoint = next;
        }

        const edgeIndex = edges.length;
        edges.push({
          id: edgeIndex,
          points: pathPoints,
          nodeA: -1,
          nodeB: -1,
        });
      }
    }
  }

  return { nodes, edges };
}
