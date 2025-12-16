import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  type BinaryImage,
  createBinaryImage,
  setPixelBin,
} from "../formats/binary.ts";
import { traceGraph } from "./tracer.ts";
import { simplifyGraph } from "./simplifier.ts";
import { PNG } from "pngjs";
import { decodeBase64 } from "@std/encoding/base64";
import { Buffer } from "node:buffer";

/**
 * Decode a base64 encoded PNG string to a BinaryImage.
 * Use this for test cases captured from the browser app.
 */
export function binaryFromBase64Png(base64: string): BinaryImage {
  // Remove data URL prefix if present
  const cleanBase64 = base64.replace(/^data:image\/png;base64,/, "");
  const pngData = decodeBase64(cleanBase64);
  const png = PNG.sync.read(Buffer.from(pngData));

  const width = png.width;
  const height = png.height;
  const img = createBinaryImage(width, height);

  // PNG data is RGBA, convert to binary (dark pixels = 1, light = 0)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = png.data[idx];
      const g = png.data[idx + 1];
      const b = png.data[idx + 2];
      // Consider dark pixels (< 128 luminance) as set
      const luminance = r * 0.299 + g * 0.587 + b * 0.114;
      if (luminance < 128) {
        setPixelBin(img, x, y, 1);
      }
    }
  }

  return img;
}

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

  // A full circle can be represented as:
  // - 1 arc segment (360° arc / full circle), or
  // - 2 arc segments (two halves)
  // Both are valid, but 1 segment is preferred
  assert(
    edge.segments.length >= 1 && edge.segments.length <= 2,
    `Should have 1-2 segments for circle, got ${edge.segments.length}`,
  );

  // All segments should be arcs
  for (const seg of edge.segments) {
    assertEquals(seg.type, "arc", "Circle should be represented as arc(s)");
  }

  // Get the first arc to verify geometry
  const s1 = edge.segments[0];
  if (s1.type === "arc") {
    const c1 = s1.arc.center;
    const r1 = s1.arc.radius;

    console.log("Segment 0:", s1.start, "->", s1.end);
    console.log("  Center:", c1, "Radius:", r1);

    // Expected center roughly (4, 3)
    // Expected radius roughly 3
    // Relaxed tolerance due to low resolution (radius 3 pixels)
    assertAlmostEquals(c1.x, 4, 1.5, "Center X");
    assertAlmostEquals(c1.y, 3, 1.5, "Center Y");
    assertAlmostEquals(r1, 3, 1.5, "Radius");
  }
});

Deno.test("simplifyGraph - Circle (Large)", () => {
  const pngData =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEcAAABHCAYAAABVsFofAAADGklEQVR4Aeybi26DMAxFOfv/f952Y1mgAomTBlogk8wrie/1iWmnSfv5HT+7BH6m8bNLYMDZRTNNA86AkyGQGfpI5wATxCLj/fCh0+DADOP/62GKBszrDqfxInAoHJgLW8J48ZC9Xa6DOV92UafBQ+CAFbEsrIffZT4wjR5593J0hQNm2IvYE+3x3DXANHvkfM3RDQ6Qcst0ujjp4HpA+pDvKfs2HDBTMqnoaS6aS7oKzQd06hJvwQEz4sa6OHojiXwogC5d1AwHSGXITLr4ooN7AvPYaq0JDpiomwiJnzzJvYF5bZGvhgMm5uItometcY9gnmt1q+CAibhordgn5rtXMO81HsJwwJK7WI3Ip+e2eg7DUYGtIlr7DQG2wVEvIThQlzQqfuY831iI1xKCoyI8ua6vGrU1FOEA6c8LVwWy5Rti3VOEs5X8ys9quicLB+7XNdpYAYJy92ThKNGTYxcO3LNrajZ7F05NkivOjbxaj4UT2dBNOHDpVypSd2jOJpzQygdMGnAym7yCA+OVcl4rOD7whHPpG+vRcEoNMOBkCA04A06GQGZodM6AkyGQGRqdM+BsE4D8L7yrzin9YrQtc8+nKzj3LLOtqiKctrT3WLUJZ7xatrmbcGzo3kfIfxir+sfCUfGl2IUzXq3pmf8YAuVXSl212zkafHr3ZOEIkALQ6RYBsa5RsUU46h5NfGIU4TgUuH73QLxrVHcIjncPXBcQ1HsPwRFFB6TrqwUYmNoawnAcCJiQ31/lXAtGdVXBcQG4DiCo+5wRFI8qOFp0HCBl7xdA+ucQ99uSuRqORFwQ0O3XBZgv99lqsAmOxFwYSDukZ98QQLLh/tJN46EZjvRkQKFrMFO6/kQAaZPkR9HDw1tw3ICbATPoz886A0nKfaSbDocucORDxhS6BtIu6vrIANORrqK3Vjc4bkwmPcDM+1iPM1hOsK9oafXIu5WjO5yliIwrYC4I1tfLNbAeh/mZ8nks1x1xfSgcN+zF7J1hu/it+Z7zjPMpcEqFLCGU5p45/hVwziy4RmvAydAacAacDIHM0B8AAAD//1mJUwMAAAAGSURBVAMAsniDkcxdvM0AAAAASUVORK5CYII=";

  const bin = binaryFromBase64Png(pngData);
  const graph = traceGraph(bin);

  // Debug: check initial segmentation before optimization
  console.log("Graph edges:", graph.edges.length);
  console.log("Edge 0 points:", graph.edges[0].points.length);

  const simplified = simplifyGraph(graph, (edgeId, nodes, segments, label) => {
    if (label === "Initial") {
      console.log(`\n${label}: ${segments.length} segments`);
      segments.forEach((s, i) => {
        const start = nodes[s.startIdx];
        const end = nodes[s.endIdx];
        console.log(
          `  ${i}: sagittaPt=(${s.sagittaPoint.x.toFixed(1)},${
            s.sagittaPoint.y.toFixed(1)
          }) start=(${start.x.toFixed(1)},${start.y.toFixed(1)}) end=(${
            end.x.toFixed(1)
          },${end.y.toFixed(1)}) pts=${s.points.length}`,
        );
      });
    }
  });

  // Should be a circle - either as a single arc (360°) or as a "circle" type
  assertEquals(simplified.edges.length, 1);
  const edge = simplified.edges[0];

  // For a full circle, we expect either:
  // - 1 "circle" segment, or
  // - 1 arc segment (360° arc)
  const summary = edge.segments.map((s, i) => {
    if (s.type === "arc") {
      return `arc ${i}: R=${s.arc.radius.toFixed(3)} start=(${
        s.start.x.toFixed(1)
      },${s.start.y.toFixed(1)}) end=(${s.end.x.toFixed(1)},${
        s.end.y.toFixed(1)
      }) cw=${s.arc.clockwise}`;
    } else if (s.type === "circle") {
      return `circle ${i}: R=${s.circle.radius.toFixed(3)} center=(${
        s.circle.center.x.toFixed(1)
      },${s.circle.center.y.toFixed(1)})`;
    }
    return `line ${i}: start=(${s.start.x.toFixed(1)},${
      s.start.y.toFixed(1)
    }) end=(${s.end.x.toFixed(1)},${s.end.y.toFixed(1)})`;
  }).join("\n");

  // Accept 1 or 2 segments for a circle
  if (edge.segments.length > 2) {
    throw new Error(
      `Expected 1-2 segments for circle, got ${edge.segments.length}:\n${summary}`,
    );
  }

  // Check that segments are arcs or circles (not lines)
  for (const s of edge.segments) {
    if (s.type === "line") {
      throw new Error(`Expected arc or circle segments, got line:\n${summary}`);
    }
  }
});
