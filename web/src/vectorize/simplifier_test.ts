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
    assertAlmostEquals(segment.start.y, 1, 0.05);
    assertAlmostEquals(segment.end.y, 1, 0.05);

    // x should be 1 and 5 (or 5 and 1)
    const minX = Math.min(segment.start.x, segment.end.x);
    const maxX = Math.max(segment.start.x, segment.end.x);
    assertAlmostEquals(minX, 1, 0.05);
    assertAlmostEquals(maxX, 5, 0.05);

    // Check direction
    // Horizontal line: direction should be (1, 0) or (-1, 0)
    assertAlmostEquals(Math.abs(segment.line.direction.x), 1, 1e-3);
    assertAlmostEquals(segment.line.direction.y, 0, 1e-3);
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

  // Check geometry
  assertEquals(
    edge.segments.length,
    2,
    "Should have 2 segments (halves of circle)",
  );
  const s1 = edge.segments[0];
  const s2 = edge.segments[1];

  assertEquals(s1.type, "arc");
  assertEquals(s2.type, "arc");

  if (s1.type === "arc" && s2.type === "arc") {
    const c1 = s1.arc.center;
    const c2 = s2.arc.center;
    const r1 = s1.arc.radius;
    const r2 = s2.arc.radius;

    console.log("Segment 0:", s1.start, "->", s1.end);
    console.log("  Center:", c1, "Radius:", r1);
    console.log("Segment 1:", s2.start, "->", s2.end);
    console.log("  Center:", c2, "Radius:", r2);

    // Expected center roughly (4, 3)
    // Expected radius roughly 3
    // Relaxed tolerance due to low resolution (radius 3 pixels)
    assertAlmostEquals(c1.x, 4, 1.0, "Center X1");
    assertAlmostEquals(c1.y, 3, 1.0, "Center Y1");
    assertAlmostEquals(r1, 3, 1.0, "Radius 1");

    assertAlmostEquals(c2.x, 4, 1.0, "Center X2");
    assertAlmostEquals(c2.y, 3, 1.0, "Center Y2");
    assertAlmostEquals(r2, 3, 1.0, "Radius 2");

    // Check connectivity
    assertAlmostEquals(s1.end.x, s2.start.x, 0.1, "S1 end matches S2 start X");
    assertAlmostEquals(s1.end.y, s2.start.y, 0.1, "S1 end matches S2 start Y");
    assertAlmostEquals(s2.end.x, s1.start.x, 0.1, "S2 end matches S1 start X");
    assertAlmostEquals(s2.end.y, s1.start.y, 0.1, "S2 end matches S1 start Y");

    // Check that they sweep opposite sides
    // To form a closed circle, both segments must have the same winding direction (both CW or both CCW)
    // If one is CW and one is CCW, they would be tracing the same arc back and forth (double coverage)
    assertEquals(
      s1.arc.clockwise,
      s2.arc.clockwise,
      "Both halves should be same winding (CW/CCW) to form a circle",
    );

    // Calculate sweep angles
    const getSweep = (start: number, end: number, cw: boolean) => {
      let diff = end - start;
      if (cw && diff > 0) diff -= 2 * Math.PI;
      if (!cw && diff < 0) diff += 2 * Math.PI;
      return Math.abs(diff);
    };

    const sweep1 = getSweep(
      s1.arc.startAngle,
      s1.arc.endAngle,
      s1.arc.clockwise,
    );
    const sweep2 = getSweep(
      s2.arc.startAngle,
      s2.arc.endAngle,
      s2.arc.clockwise,
    );

    console.log("Sweep 1:", sweep1 * 180 / Math.PI);
    console.log("Sweep 2:", sweep2 * 180 / Math.PI);

    // Each should be roughly 180 degrees (pi)
    assertAlmostEquals(sweep1, Math.PI, 1.0, "Sweep 1 should be ~180 deg");
    assertAlmostEquals(sweep2, Math.PI, 1.0, "Sweep 2 should be ~180 deg");

    // Total sweep should be 2*PI
    assertAlmostEquals(
      sweep1 + sweep2,
      2 * Math.PI,
      0.5,
      "Total sweep should be 360 deg",
    );
  }
});
