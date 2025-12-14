import { assertEquals } from "@std/assert";
import { createBinaryImage, setPixelBin } from "../formats/binary.ts";
import { traceGraph } from "./tracer.ts";

Deno.test("traceGraph - single pixel", () => {
  const bin = createBinaryImage(10, 10);
  setPixelBin(bin, 5, 5, 1);
  const graph = traceGraph(bin);

  // Single pixel is an isolated node (degree 0)
  assertEquals(graph.nodes.size, 1);
  assertEquals(graph.edges.length, 0);

  const node = graph.nodes.values().next().value;
  if (!node) throw new Error("Node not found");
  assertEquals(node.point, { x: 5, y: 5 });
  assertEquals(node.edges.length, 0);
});

Deno.test("traceGraph - horizontal line", () => {
  const bin = createBinaryImage(10, 10);
  setPixelBin(bin, 2, 2, 1);
  setPixelBin(bin, 3, 2, 1);
  setPixelBin(bin, 4, 2, 1);
  const graph = traceGraph(bin);

  // Line has 2 endpoints (nodes) and 1 edge connecting them
  assertEquals(graph.nodes.size, 2);
  assertEquals(graph.edges.length, 1);

  const edge = graph.edges[0];
  assertEquals(edge.points.length, 3);
  // Points should be ordered
  const p1 = edge.points[0];
  const p3 = edge.points[2];

  // Check endpoints
  const n1 = graph.nodes.get(edge.nodeA);
  const n2 = graph.nodes.get(edge.nodeB);

  // Verify connectivity
  assertEquals(n1?.point, p1);
  assertEquals(n2?.point, p3);
});

Deno.test("traceGraph - square loop", () => {
  const bin = createBinaryImage(10, 10);
  // 2,2 - 3,2
  //  |     |
  // 2,3 - 3,3
  setPixelBin(bin, 2, 2, 1);
  setPixelBin(bin, 3, 2, 1);
  setPixelBin(bin, 3, 3, 1);
  setPixelBin(bin, 2, 3, 1);

  const graph = traceGraph(bin);

  // Loop has 0 nodes (all pixels degree 2) and 1 edge
  assertEquals(graph.nodes.size, 0);
  assertEquals(graph.edges.length, 1);

  const edge = graph.edges[0];
  assertEquals(edge.points.length, 5); // 4 points + 1 to close loop
  assertEquals(edge.nodeA, -1);
  assertEquals(edge.nodeB, -1);

  // Check closure
  assertEquals(edge.points[0], edge.points[4]);
});

Deno.test("traceGraph - diagonal line", () => {
  const bin = createBinaryImage(10, 10);
  setPixelBin(bin, 2, 2, 1);
  setPixelBin(bin, 3, 3, 1);
  setPixelBin(bin, 4, 4, 1);

  const graph = traceGraph(bin);
  assertEquals(graph.nodes.size, 2);
  assertEquals(graph.edges.length, 1);
  assertEquals(graph.edges[0].points.length, 3);
});

Deno.test("traceGraph - stair-step avoidance", () => {
  const bin = createBinaryImage(10, 10);
  // 2,2 - 3,2
  //       |
  //       3,3
  setPixelBin(bin, 2, 2, 1);
  setPixelBin(bin, 3, 2, 1);
  setPixelBin(bin, 3, 3, 1);

  const graph = traceGraph(bin);
  // Should be a single path 2,2 -> 3,2 -> 3,3
  // Endpoints at 2,2 and 3,3
  assertEquals(graph.nodes.size, 2);
  assertEquals(graph.edges.length, 1);

  const edge = graph.edges[0];
  assertEquals(edge.points.length, 3);

  // Verify it goes through 3,2
  const mid = edge.points[1];
  assertEquals(mid, { x: 3, y: 2 });
});

Deno.test("traceGraph - junction", () => {
  const bin = createBinaryImage(10, 10);
  //   2,1
  //    |
  // 1,2-2,2-3,2
  //    |
  //   2,3
  setPixelBin(bin, 2, 1, 1);
  setPixelBin(bin, 1, 2, 1);
  setPixelBin(bin, 2, 2, 1);
  setPixelBin(bin, 3, 2, 1);
  setPixelBin(bin, 2, 3, 1);

  const graph = traceGraph(bin);

  // 2,2 is a junction (degree 4).
  // 2,1; 1,2; 3,2; 2,3 are endpoints (degree 1).
  // Total nodes: 5.
  // Edges: 4 (connecting center to each arm).

  assertEquals(graph.nodes.size, 5);
  assertEquals(graph.edges.length, 4);

  // Find the center node
  let centerNodeId = -1;
  for (const node of graph.nodes.values()) {
    if (node.point.x === 2 && node.point.y === 2) {
      centerNodeId = node.id;
      break;
    }
  }

  // Verify center node has 4 edges
  const centerNode = graph.nodes.get(centerNodeId);
  if (!centerNode) throw new Error("Center node not found");
  assertEquals(centerNode.edges.length, 4);

  // Verify other nodes have 1 edge
  for (const node of graph.nodes.values()) {
    if (node.id !== centerNodeId) {
      assertEquals(node.edges.length, 1);
    }
  }
});
