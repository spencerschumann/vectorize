import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  type BinaryImage,
  createBinaryImage,
  setPixelBin,
} from "../formats/binary.ts";
import { traceGraph } from "./tracer.ts";
import { simplifyGraph } from "./simplifier.ts";

function binaryFromAscii(ascii: string): BinaryImage {
  // Remove leading empty line if present (common in template strings)
  const lines = ascii.split("\n");
  if (lines[0].trim() === "") lines.shift();

  // Remove trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }

  const height = lines.length;
  const width = lines.reduce((max, line) => Math.max(max, line.length), 0);

  const img = createBinaryImage(width, height);

  lines.forEach((line, y) => {
    line = line.trimEnd().trimStart();
    for (let x = 0; x < line.length; x++) {
      const char = line[x];
      if (char !== "." && char !== " ") {
        setPixelBin(img, x, y, 1);
      }
    }
  });

  return img;
}

Deno.test("simplifyGraph - horizontal line", () => {
  const ascii = `
    ..........
    .#####....
    ..........
    `;
  const bin = binaryFromAscii(ascii);
  const graph = traceGraph(bin);
  const simplified = simplifyGraph(graph);

  assertEquals(simplified.edges.length, 1);
  const edge = simplified.edges[0];
  assertEquals(edge.segments.length, 1);

  const segment = edge.segments[0];
  assertEquals(segment.type, "line");

  if (segment.type === "line") {
    // Check start and end points
    // The line is at y=1, x from 1 to 5 (5 pixels: 1,2,3,4,5)
    // Wait, traceGraph might order them 1->5 or 5->1 depending on scan order.
    // Scan order is y then x. So it finds 1,1 first.
    // Then it traces neighbors.
    // So it should be 1,1 -> ... -> 5,1.

    // Let's check coordinates
    // y should be 1
    assertEquals(segment.start.y, 1);
    assertEquals(segment.end.y, 1);

    // x should be 1 and 5 (or 5 and 1)
    const minX = Math.min(segment.start.x, segment.end.x);
    const maxX = Math.max(segment.start.x, segment.end.x);
    assertEquals(minX, 1);
    assertEquals(maxX, 5);

    // Check direction
    // Horizontal line: direction should be (1, 0) or (-1, 0)
    assertAlmostEquals(Math.abs(segment.line.direction.x), 1);
    assertAlmostEquals(segment.line.direction.y, 0);
  }
});

Deno.test("simplifyGraph - L-shape (corner)", () => {
  const ascii = `
    #.........
    #.........
    #.........
    #.........
    #.........
    ##########
    `;
  const bin = binaryFromAscii(ascii);
  const graph = traceGraph(bin);

  // Should be 1 edge (top to right)
  assertEquals(graph.edges.length, 1);

  const simplified = simplifyGraph(graph);
  const edge = simplified.edges[0];

  // Should be split into 2 segments (vertical and horizontal)
  assertEquals(edge.segments.length, 2);

  const s1 = edge.segments[0];
  const s2 = edge.segments[1];

  assertEquals(s1.type, "line");
  assertEquals(s2.type, "line");

  // Check directions (one vertical, one horizontal)
  // We don't know order, but one is (0,1) and other is (1,0)
  const dirs = [s1, s2].map(
    (s) => (s.type === "line" ? s.line.direction : { x: 0, y: 0 }),
  );
  const hasVertical = dirs.some((d) => Math.abs(d.y) > 0.9);
  const hasHorizontal = dirs.some((d) => Math.abs(d.x) > 0.9);

  assertEquals(hasVertical, true);
  assertEquals(hasHorizontal, true);
});

Deno.test("simplifyGraph - Circle (Small)", () => {
  const ascii = `
    ...###...
    ..#...#..
    .#.....#.
    .#.....#.
    .#.....#.
    ..#...#..
    ...###...
    `;
  const bin = binaryFromAscii(ascii);
  const graph = traceGraph(bin);
  
  const simplified = simplifyGraph(graph);
  const edge = simplified.edges[0];
  
  // Check for NaNs
  for (const seg of edge.segments) {
    if (seg.type === "arc") {
      if (Number.isNaN(seg.arc.center.x) || Number.isNaN(seg.arc.center.y)) {
        throw new Error("Arc center is NaN");
      }
    }
  }
});
