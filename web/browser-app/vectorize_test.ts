/**
 * Unit tests for vectorization and Douglas-Peucker simplification
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

// Mock Vertex interface
interface Vertex {
  x: number;
  y: number;
  id: number;
}

// Douglas-Peucker implementation (copied from vectorize.ts)
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

function douglasPeucker(vertices: Vertex[], epsilon: number): Vertex[] {
  if (vertices.length <= 2) {
    return vertices;
  }
  
  // Find the point with maximum distance from the line between first and last
  let maxDistance = 0;
  let maxIndex = 0;
  const end = vertices.length - 1;
  
  for (let i = 1; i < end; i++) {
    const distance = perpendicularDistance(vertices[i], vertices[0], vertices[end]);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }
  
  // If max distance is greater than epsilon, recursively simplify
  if (maxDistance > epsilon) {
    const left = douglasPeucker(vertices.slice(0, maxIndex + 1), epsilon);
    const right = douglasPeucker(vertices.slice(maxIndex), epsilon);
    
    // Concatenate results, avoiding duplicate middle point
    return left.slice(0, -1).concat(right);
  } else {
    // All points between first and last can be removed
    return [vertices[0], vertices[end]];
  }
}

Deno.test("Douglas-Peucker: straight horizontal line", () => {
  const vertices: Vertex[] = [
    { x: 0, y: 0, id: 0 },
    { x: 1, y: 0, id: 1 },
    { x: 2, y: 0, id: 2 },
    { x: 3, y: 0, id: 3 },
  ];
  
  const simplified = douglasPeucker(vertices, 0);
  assertEquals(simplified.length, 2);
  assertEquals(simplified[0], vertices[0]);
  assertEquals(simplified[1], vertices[3]);
});

Deno.test("Douglas-Peucker: straight vertical line", () => {
  const vertices: Vertex[] = [
    { x: 0, y: 0, id: 0 },
    { x: 0, y: 1, id: 1 },
    { x: 0, y: 2, id: 2 },
    { x: 0, y: 3, id: 3 },
  ];
  
  const simplified = douglasPeucker(vertices, 0);
  assertEquals(simplified.length, 2);
  assertEquals(simplified[0], vertices[0]);
  assertEquals(simplified[1], vertices[3]);
});

Deno.test("Douglas-Peucker: straight diagonal line", () => {
  const vertices: Vertex[] = [
    { x: 0, y: 0, id: 0 },
    { x: 1, y: 1, id: 1 },
    { x: 2, y: 2, id: 2 },
    { x: 3, y: 3, id: 3 },
  ];
  
  const simplified = douglasPeucker(vertices, 0);
  assertEquals(simplified.length, 2);
  assertEquals(simplified[0], vertices[0]);
  assertEquals(simplified[1], vertices[3]);
});

Deno.test("Douglas-Peucker: stair-step pattern (alternating H/V) should NOT simplify at epsilon=0", () => {
  const vertices: Vertex[] = [
    { x: 0, y: 0, id: 0 },  // Start
    { x: 1, y: 0, id: 1 },  // Right
    { x: 1, y: 1, id: 2 },  // Up (corner)
    { x: 2, y: 1, id: 3 },  // Right
    { x: 2, y: 2, id: 4 },  // Up (corner)
    { x: 3, y: 2, id: 5 },  // End
  ];
  
  const simplified = douglasPeucker(vertices, 0);
  // Stair-step should keep all corner vertices at epsilon=0
  // because each segment is perpendicular to the overall line
  assertEquals(simplified.length, 6, "Stair-step should keep all vertices at epsilon=0");
});

Deno.test("Douglas-Peucker: stair-step pattern at epsilon=0.5", () => {
  const vertices: Vertex[] = [
    { x: 0, y: 0, id: 0 },  // Start
    { x: 1, y: 0, id: 1 },  // Right
    { x: 1, y: 1, id: 2 },  // Up (corner)
    { x: 2, y: 1, id: 3 },  // Right
    { x: 2, y: 2, id: 4 },  // Up (corner)
    { x: 3, y: 2, id: 5 },  // End
  ];
  
  const simplified = douglasPeucker(vertices, 0.5);
  // With epsilon=0.5, small corners might be removed
  console.log("Simplified stair-step (epsilon=0.5):", simplified.length, "vertices");
  console.log("Vertices:", simplified.map(v => `(${v.x},${v.y})`).join(" -> "));
});

Deno.test("Douglas-Peucker: corner that should be kept", () => {
  const vertices: Vertex[] = [
    { x: 0, y: 0, id: 0 },
    { x: 5, y: 0, id: 1 },
    { x: 5, y: 5, id: 2 },
  ];
  
  const simplified = douglasPeucker(vertices, 0);
  assertEquals(simplified.length, 3, "90-degree corner should always be kept");
});

Deno.test("Perpendicular distance: point on line", () => {
  const point = { x: 1, y: 1, id: 1 };
  const start = { x: 0, y: 0, id: 0 };
  const end = { x: 2, y: 2, id: 2 };
  
  const distance = perpendicularDistance(point, start, end);
  assertEquals(distance, 0, "Point on line should have distance 0");
});

Deno.test("Perpendicular distance: point off line", () => {
  const point = { x: 1, y: 0, id: 1 };
  const start = { x: 0, y: 0, id: 0 };
  const end = { x: 2, y: 0, id: 2 };
  
  const distance = perpendicularDistance(point, start, end);
  assertEquals(distance, 0, "Point on horizontal line should have distance 0");
});

Deno.test("Perpendicular distance: stair-step corner from diagonal line", () => {
  // Line from (0,0) to (3,2) - the overall diagonal
  const start = { x: 0, y: 0, id: 0 };
  const end = { x: 3, y: 2, id: 5 };
  
  // Intermediate stair-step points
  const corner1 = { x: 1, y: 0, id: 1 };  // After first horizontal
  const corner2 = { x: 1, y: 1, id: 2 };  // After first vertical
  const corner3 = { x: 2, y: 1, id: 3 };  // After second horizontal
  const corner4 = { x: 2, y: 2, id: 4 };  // After second vertical
  
  console.log("\nStair-step perpendicular distances from (0,0) to (3,2):");
  console.log("  (1,0):", perpendicularDistance(corner1, start, end).toFixed(3));
  console.log("  (1,1):", perpendicularDistance(corner2, start, end).toFixed(3));
  console.log("  (2,1):", perpendicularDistance(corner3, start, end).toFixed(3));
  console.log("  (2,2):", perpendicularDistance(corner4, start, end).toFixed(3));
});
