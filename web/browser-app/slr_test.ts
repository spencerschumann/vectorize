import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { segmentedLinearRegression, fitLineToSegments } from "./vectorize.ts";
import type { Vertex, VectorPath } from "./vectorize.ts";

// Helper to create a simple path from coordinates
function createPath(coords: Array<[number, number]>): { path: VectorPath; vertices: Map<number, Vertex> } {
  const vertices = new Map<number, Vertex>();
  const vertexIds: number[] = [];
  
  for (let i = 0; i < coords.length; i++) {
    const [x, y] = coords[i];
    const id = y * 10000 + x; // Simple ID scheme
    vertices.set(id, { x, y, id, neighbors: [] });
    vertexIds.push(id);
  }
  
  return {
    path: { vertices: vertexIds, closed: false },
    vertices,
  };
}

Deno.test("SLR: straight horizontal line should simplify to 2 points", () => {
  // Create a straight horizontal line with 10 points
  const coords: Array<[number, number]> = [];
  for (let x = 0; x < 10; x++) {
    coords.push([x, 5]);
  }
  
  const { path, vertices } = createPath(coords);
  
  console.log("\n=== Test: Straight horizontal line ===");
  console.log(`Input: ${coords.length} points along y=5 from x=0 to x=9`);
  
  const result = segmentedLinearRegression(path, vertices, 10000, 1.0);
  
  console.log(`Result: ${result.vertices.length} points`);
  console.log(`Expected: 2 points (endpoints)`);
  
  assertEquals(result.vertices.length, 2);
});

Deno.test("SLR: straight diagonal line should simplify to 2 points", () => {
  // Create a straight diagonal line
  const coords: Array<[number, number]> = [
    [0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6], [7, 7]
  ];
  
  const { path, vertices } = createPath(coords);
  
  console.log("\n=== Test: Straight diagonal line ===");
  console.log(`Input: ${coords.length} points along y=x from (0,0) to (7,7)`);
  
  const result = segmentedLinearRegression(path, vertices, 10000, 1.0);
  
  console.log(`Result: ${result.vertices.length} points`);
  console.log(`Expected: 2 points (endpoints)`);
  
  assertEquals(result.vertices.length, 2);
});

Deno.test("SLR: L-shape should preserve corner", () => {
  // Create an L-shape: horizontal then vertical
  const coords: Array<[number, number]> = [
    [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], // Horizontal
    [4, 1], [4, 2], [4, 3], [4, 4]         // Vertical
  ];
  
  const { path, vertices } = createPath(coords);
  
  console.log("\n=== Test: L-shape ===");
  console.log(`Input: ${coords.length} points forming L-shape`);
  
  const result = segmentedLinearRegression(path, vertices, 10000, 1.0);
  
  console.log(`Result: ${result.vertices.length} points`);
  console.log(`Expected: 3 points (start, corner, end)`);
  
  // Should have 3 points: start, corner, and end
  assertEquals(result.vertices.length, 3);
});

Deno.test("SLR: stair-step diagonal should simplify", () => {
  // Create a stair-step approximation of a diagonal
  const coords: Array<[number, number]> = [
    [0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3, 2], [3, 3], [4, 3], [4, 4]
  ];
  
  const { path, vertices } = createPath(coords);
  
  console.log("\n=== Test: Stair-step diagonal ===");
  console.log(`Input: ${coords.length} points in stair-step pattern`);
  
  const result = segmentedLinearRegression(path, vertices, 10000, 1.0);
  
  console.log(`Result: ${result.vertices.length} points`);
  console.log(`Expected: 2 points (simplified to straight line)`);
  console.log(`Max error from perfect diagonal should be ~0.7 pixels`);
  
  // With epsilon=2.0, stair-steps (max error ~0.7) should simplify to 2 points
  assertEquals(result.vertices.length, 2);
});

Deno.test("SLR: curved path should preserve curvature", () => {
  // Create a curved path (quarter circle approximation)
  const coords: Array<[number, number]> = [
    [0, 0], [1, 0], [2, 1], [3, 2], [4, 3], [4, 4], [4, 5], [3, 6], [2, 7], [1, 8], [0, 8]
  ];
  
  const { path, vertices } = createPath(coords);
  
  console.log("\n=== Test: Curved path ===");
  console.log(`Input: ${coords.length} points approximating a curve`);
  
  const result = segmentedLinearRegression(path, vertices, 10000, 1.0);
  
  console.log(`Result: ${result.vertices.length} points`);
  console.log(`Expected: Multiple points to preserve curve shape (should be > 2)`);
  
  // Curved path should not be simplified to just 2 points
  assertEquals(result.vertices.length > 2, true);
});

Deno.test("Continuous centroid calculation", () => {
  // Test that continuous centroid weighting works correctly
  // For a single segment, centroid should be at midpoint
  const coords: Array<[number, number]> = [
    [0, 0], [10, 0]
  ];
  
  const { path, vertices } = createPath(coords);
  
  console.log("\n=== Test: Single segment centroid ===");
  console.log(`Single segment from (0,0) to (10,0)`);
  
  const result = segmentedLinearRegression(path, vertices, 10000, 1.0);
  
  console.log(`Result: ${result.vertices.length} points - already minimal`);
  
  // Already 2 points, should stay 2 points
  assertEquals(result.vertices.length, 2);
});

Deno.test("Multiple segments centroid", () => {
  // Test centroid with multiple segments of different lengths
  // All collinear, should simplify to 2 points
  const coords: Array<[number, number]> = [
    [0, 0], [2, 0], [3, 0]
  ];
  
  const { path, vertices } = createPath(coords);
  
  console.log("\n=== Test: Multi-segment collinear ===");
  console.log(`Two segments: (0,0)→(2,0) and (2,0)→(3,0), both horizontal`);
  
  const result = segmentedLinearRegression(path, vertices, 10000, 1.0);
  
  console.log(`Result: ${result.vertices.length} points`);
  console.log(`Expected: 2 points (collinear segments should merge)`);
  
  assertEquals(result.vertices.length, 2);
});

// ========== fitLineToSegments Tests ==========

Deno.test("fitLineToSegments: horizontal line", () => {
  const points: Vertex[] = [
    { x: 0, y: 5, id: 50000, neighbors: [] },
    { x: 1, y: 5, id: 50001, neighbors: [] },
    { x: 2, y: 5, id: 50002, neighbors: [] },
    { x: 3, y: 5, id: 50003, neighbors: [] },
    { x: 4, y: 5, id: 50004, neighbors: [] },
  ];
  
  const result = fitLineToSegments(points);
  
  console.log("\n=== fitLineToSegments: horizontal line ===");
  console.log(`Centroid: (${result.centroid.x}, ${result.centroid.y})`);
  console.log(`Direction: (${result.direction.x}, ${result.direction.y})`);
  console.log(`Max error: ${result.maxError.toFixed(2)} at index ${result.maxErrorIndex}`);
  
  // Centroid should be at middle of line
  assertEquals(result.centroid.x, 2);
  assertEquals(result.centroid.y, 5);
  
  // Direction should be horizontal (1, 0) or (-1, 0)
  assertEquals(Math.abs(result.direction.x), 1);
  assertEquals(Math.abs(result.direction.y), 0);
  
  // Max error should be 0 for perfect line
  assertEquals(result.maxError, 0);
});

Deno.test("fitLineToSegments: vertical line", () => {
  const points: Vertex[] = [
    { x: 5, y: 0, id: 5, neighbors: [] },
    { x: 5, y: 1, id: 10005, neighbors: [] },
    { x: 5, y: 2, id: 20005, neighbors: [] },
    { x: 5, y: 3, id: 30005, neighbors: [] },
    { x: 5, y: 4, id: 40005, neighbors: [] },
  ];
  
  const result = fitLineToSegments(points);
  
  console.log("\n=== fitLineToSegments: vertical line ===");
  console.log(`Centroid: (${result.centroid.x}, ${result.centroid.y})`);
  console.log(`Direction: (${result.direction.x}, ${result.direction.y})`);
  console.log(`Max error: ${result.maxError.toFixed(2)} at index ${result.maxErrorIndex}`);
  
  // Centroid should be at middle
  assertEquals(result.centroid.x, 5);
  assertEquals(result.centroid.y, 2);
  
  // Direction should be vertical (0, 1) or (0, -1)
  assertEquals(Math.abs(result.direction.x), 0);
  assertEquals(Math.abs(result.direction.y), 1);
  
  // Max error should be 0 for perfect line
  assertEquals(result.maxError, 0);
});

Deno.test("fitLineToSegments: diagonal line", () => {
  const points: Vertex[] = [
    { x: 0, y: 0, id: 0, neighbors: [] },
    { x: 1, y: 1, id: 10001, neighbors: [] },
    { x: 2, y: 2, id: 20002, neighbors: [] },
    { x: 3, y: 3, id: 30003, neighbors: [] },
    { x: 4, y: 4, id: 40004, neighbors: [] },
  ];
  
  const result = fitLineToSegments(points);
  
  console.log("\n=== fitLineToSegments: diagonal line ===");
  console.log(`Centroid: (${result.centroid.x}, ${result.centroid.y})`);
  console.log(`Direction: (${result.direction.x}, ${result.direction.y})`);
  console.log(`Max error: ${result.maxError.toFixed(2)} at index ${result.maxErrorIndex}`);
  
  // Centroid should be at middle (with floating point tolerance)
  assertEquals(Math.abs(result.centroid.x - 2) < 0.0001, true);
  assertEquals(Math.abs(result.centroid.y - 2) < 0.0001, true);
  
  // Direction should be diagonal (±1/√2, ±1/√2)
  const sqrt2 = Math.sqrt(2);
  assertEquals(Math.abs(Math.abs(result.direction.x) - 1 / sqrt2) < 0.0001, true);
  assertEquals(Math.abs(Math.abs(result.direction.y) - 1 / sqrt2) < 0.0001, true);
  
  // Max error should be 0 for perfect line
  assertEquals(result.maxError, 0);
});

Deno.test("fitLineToSegments: L-shape with corner", () => {
  // L-shape with corner at origin: horizontal arm to left, vertical arm going up
  const points: Vertex[] = [
    { x: -3, y: 0, id: -3, neighbors: [] },
    { x: -2, y: 0, id: -2, neighbors: [] },
    { x: -1, y: 0, id: -1, neighbors: [] },
    { x: 0, y: 0, id: 0, neighbors: [] },      // Corner at origin
    { x: 0, y: 1, id: 10000, neighbors: [] },
    { x: 0, y: 2, id: 20000, neighbors: [] },
    { x: 0, y: 3, id: 30000, neighbors: [] },
  ];
  
  // Debug: compute what centroid should be
  let debugTotalLength = 0;
  let debugWeightedX = 0;
  let debugWeightedY = 0;
  console.log("\n=== fitLineToSegments: L-shape DEBUG ===");
  console.log("L-shape: horizontal from (-3,0) to (0,0), then vertical from (0,0) to (0,3)");
  for (let i = 0; i < points.length - 1; i++) {
    const A = points[i];
    const B = points[i + 1];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const L = Math.sqrt(dx * dx + dy * dy);
    const segCenterX = (A.x + B.x) / 2;
    const segCenterY = (A.y + B.y) / 2;
    debugTotalLength += L;
    debugWeightedX += L * segCenterX;
    debugWeightedY += L * segCenterY;
    console.log(`Segment ${i}: (${A.x},${A.y})→(${B.x},${B.y}), L=${L.toFixed(2)}, center=(${segCenterX.toFixed(2)},${segCenterY.toFixed(2)})`);
  }
  console.log(`Total length: ${debugTotalLength.toFixed(2)}`);
  console.log(`Expected centroid: (${(debugWeightedX/debugTotalLength).toFixed(2)}, ${(debugWeightedY/debugTotalLength).toFixed(2)})`);
  
  const result = fitLineToSegments(points);
  
  console.log(`Actual centroid: (${result.centroid.x.toFixed(2)}, ${result.centroid.y.toFixed(2)})`);
  console.log(`Direction: (${result.direction.x.toFixed(3)}, ${result.direction.y.toFixed(3)})`);
  console.log(`Max error: ${result.maxError.toFixed(2)} at index ${result.maxErrorIndex}`);
  
  // Max error should be significant (around 1.5-2.0) at the corner
  assertEquals(result.maxError > 1.0, true);
  
  // Max error should NOT be at endpoints
  assertEquals(result.maxErrorIndex > 0, true);
  assertEquals(result.maxErrorIndex < points.length - 1, true);
  
  console.log(`Max error is at interior point: ${result.maxErrorIndex} (not at 0 or ${points.length - 1})`);
});

Deno.test("fitLineToSegments: arc/curve", () => {
  // Create a gentle arc
  const points: Vertex[] = [];
  for (let i = 0; i <= 10; i++) {
    const x = i;
    const y = Math.round((i - 5) * (i - 5) / 5); // Parabola
    points.push({ x, y, id: y * 10000 + x, neighbors: [] });
  }
  
  const result = fitLineToSegments(points);
  
  console.log("\n=== fitLineToSegments: arc/curve ===");
  console.log(`Centroid: (${result.centroid.x.toFixed(2)}, ${result.centroid.y.toFixed(2)})`);
  console.log(`Direction: (${result.direction.x.toFixed(3)}, ${result.direction.y.toFixed(3)})`);
  console.log(`Max error: ${result.maxError.toFixed(2)} at index ${result.maxErrorIndex}`);
  
  // Max error should be significant
  assertEquals(result.maxError > 1.0, true);
  
  // Max error should NOT be at endpoints
  assertEquals(result.maxErrorIndex > 0, true);
  assertEquals(result.maxErrorIndex < points.length - 1, true);
  
  console.log(`Max error is at interior point: ${result.maxErrorIndex} (not at 0 or ${points.length - 1})`);
});

Deno.test("fitLineToSegments: stair-step pattern", () => {
  const points: Vertex[] = [
    { x: 0, y: 0, id: 0, neighbors: [] },
    { x: 1, y: 0, id: 1, neighbors: [] },
    { x: 1, y: 1, id: 10001, neighbors: [] },
    { x: 2, y: 1, id: 10002, neighbors: [] },
    { x: 2, y: 2, id: 20002, neighbors: [] },
    { x: 3, y: 2, id: 20003, neighbors: [] },
    { x: 3, y: 3, id: 30003, neighbors: [] },
  ];
  
  const result = fitLineToSegments(points);
  
  console.log("\n=== fitLineToSegments: stair-step ===");
  console.log(`Centroid: (${result.centroid.x.toFixed(2)}, ${result.centroid.y.toFixed(2)})`);
  console.log(`Direction: (${result.direction.x.toFixed(3)}, ${result.direction.y.toFixed(3)})`);
  console.log(`Max error: ${result.maxError.toFixed(2)} at index ${result.maxErrorIndex}`);
  
  // Should fit a diagonal line through the stair-step
  // Direction should be roughly diagonal
  assertEquals(Math.abs(result.direction.x) > 0.5, true);
  assertEquals(Math.abs(result.direction.y) > 0.5, true);
  
  // Max error should be small (< 1.0) for stair-step
  assertEquals(result.maxError < 1.0, true);
  
  // Max error should NOT be at endpoints
  assertEquals(result.maxErrorIndex > 0, true);
  assertEquals(result.maxErrorIndex < points.length - 1, true);
});

Deno.test("fitLineToSegments: 3 points should not error at endpoints", () => {
  const points: Vertex[] = [
    { x: 0, y: 0, id: 0, neighbors: [] },
    { x: 1, y: 1, id: 10001, neighbors: [] },
    { x: 2, y: 0, id: 2, neighbors: [] },
  ];
  
  const result = fitLineToSegments(points);
  
  console.log("\n=== fitLineToSegments: 3 points triangle ===");
  console.log(`Centroid: (${result.centroid.x.toFixed(2)}, ${result.centroid.y.toFixed(2)})`);
  console.log(`Direction: (${result.direction.x.toFixed(3)}, ${result.direction.y.toFixed(3)})`);
  console.log(`Max error: ${result.maxError.toFixed(2)} at index ${result.maxErrorIndex}`);
  
  // For 3 points, maxErrorIndex should be 1 (the middle point)
  assertEquals(result.maxErrorIndex, 1);
  
  console.log(`Max error correctly at middle point: ${result.maxErrorIndex}`);
});

Deno.test("SLR: closed rectangle path", () => {
  const coords: Array<[number, number]> = [
    [17, 22], [78, 22], [79, 23], [79, 91], 
    [78, 92], [17, 92], [15, 90], [15, 24], [17, 22]
  ];
  
  const { path, vertices } = createPath(coords);
  path.closed = true;
  
  console.log("\n=== Test: Closed rectangle path ===");
  console.log(`Input: ${coords.length} points forming a closed rectangle`);
  console.log(`Points: ${coords.map(c => `(${c[0]},${c[1]})`).join(', ')}`);
  
  // Debug: manually compute what fitLineToSegments would return
  const points = path.vertices.map(id => vertices.get(id)!);
  console.log("\n--- Testing fitLineToSegments on rectangle ---");
  const fitResult = fitLineToSegments(points);
  console.log(`Centroid: (${fitResult.centroid.x.toFixed(2)}, ${fitResult.centroid.y.toFixed(2)})`);
  console.log(`Direction: (${fitResult.direction.x.toFixed(3)}, ${fitResult.direction.y.toFixed(3)})`);
  console.log(`Max error: ${fitResult.maxError.toFixed(2)} at index ${fitResult.maxErrorIndex}`);
  console.log(`Epsilon threshold: 1.0`);
  console.log(`Will split: ${fitResult.maxError > 1.0}`);
  
  if (fitResult.maxError > 1.0) {
    // Debug DP-style splitting
    const start = points[0];
    const end = points[points.length - 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lineLen = Math.sqrt(dx * dx + dy * dy);
    console.log(`\n--- DP-style split calculation ---`);
    console.log(`Line from (${start.x},${start.y}) to (${end.x},${end.y}), length: ${lineLen.toFixed(2)}`);
    
    let maxDist = 0;
    let maxDistIndex = 1;
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i];
      const dist = Math.abs((end.y - start.y) * p.x - (end.x - start.x) * p.y + end.x * start.y - end.y * start.x) / lineLen;
      if (dist > maxDist) {
        maxDist = dist;
        maxDistIndex = i;
      }
      console.log(`Point ${i} (${p.x},${p.y}): distance ${dist.toFixed(2)}`);
    }
    console.log(`Max distance: ${maxDist.toFixed(2)} at index ${maxDistIndex} (${points[maxDistIndex].x},${points[maxDistIndex].y})`);
  }
  
  const result = segmentedLinearRegression(path, vertices, 10000, 1.0);
  
  console.log(`\nResult: ${result.vertices.length} points`);
  
  // Build a map of all vertices (original + any new ones created during processing)
  const allVertices = new Map(vertices);
  result.vertices.forEach(id => {
    if (!allVertices.has(id)) {
      console.log(`Warning: vertex ID ${id} not found in original vertices`);
    }
  });
  
  console.log(`Result points: ${result.vertices.map((id, idx) => {
    const v = allVertices.get(id);
    return v ? `(${v.x.toFixed(1)},${v.y.toFixed(1)})` : `[ID:${id}-missing]`;
  }).join(', ')}`);
  
  // Should simplify to approximately 4-5 corner points (rectangle has 4 true corners)
  // The exact count depends on how well the corners align
  console.log(`Expected: 4-5 points for rectangle corners`);
  assertEquals(result.vertices.length >= 4, true);
  assertEquals(result.vertices.length <= 6, true);
});

