import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  type BinaryImage,
  createBinaryImage,
  setPixelBin,
} from "../formats/binary.ts";
import { traceGraph } from "./tracer.ts";
import { SimplifiedEdge, simplifyGraph } from "./simplifier.ts";
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

function summarizeEdge(edge: SimplifiedEdge): string {
  return edge.segments.map((s, i) => {
    if (s.type === "arc") {
      return `arc ${i}: R=${s.arc.radius.toFixed(3)} start=(${
        s.start.x.toFixed(1)
      },${s.start.y.toFixed(1)}) end=(${s.end.x.toFixed(1)},${
        s.end.y.toFixed(1)
      }) cw=${s.arc.clockwise}`;
    }
    return `line ${i}: start=(${s.start.x.toFixed(1)},${
      s.start.y.toFixed(1)
    }) end=(${s.end.x.toFixed(1)},${s.end.y.toFixed(1)})`;
  }).join("\n");
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
  assertEquals(
    edge.segments.length,
    2,
    `Expected 2 segments, got ${edge.segments.length}:\n${summarizeEdge(edge)}`,
  );

  const s1 = edge.segments[0];
  const s2 = edge.segments[1];

  assertEquals(
    s1.type,
    "line",
    `First segment should be line:\n${summarizeEdge(edge)}`,
  );
  assertEquals(
    s2.type,
    "line",
    `Second segment should be line:\n${summarizeEdge(edge)}`,
  );

  // Check directions (one vertical, one horizontal)
  // We don't know order, but one is (0,1) and other is (1,0)
  const dirs = [s1, s2].map(
    (s) => (s.type === "line" ? s.line.direction : { x: 0, y: 0 }),
  );
  const hasVertical = dirs.some((d) => Math.abs(d.y) > 0.9);
  const hasHorizontal = dirs.some((d) => Math.abs(d.x) > 0.9);

  assertEquals(
    hasVertical,
    true,
    `Should have a vertical segment:\n${summarizeEdge(edge)}`,
  );
  assertEquals(
    hasHorizontal,
    true,
    `Should have a horizontal segment:\n${summarizeEdge(edge)}`,
  );
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
    assertAlmostEquals(c1.x, 4, 0.001, "Center X");
    assertAlmostEquals(c1.y, 3, 0.001, "Center Y");
    assertAlmostEquals(r1, 3, 0.1, "Radius");
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

  const simplified = simplifyGraph(graph);

  // Should be a circle - either as a single arc (360°) or as a "circle" type
  assertEquals(simplified.edges.length, 1);
  const edge = simplified.edges[0];

  // For a full circle, we expect either:
  // - 1 "circle" segment, or
  // - 1 arc segment (360° arc)
  const summary = summarizeEdge(edge);

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

Deno.test("simplifyGraph - Square", () => {
  // Square (86x91) with hollow center - large rectangle outline
  const pngData =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFYAAABbCAYAAADpyHIpAAABy0lEQVR4AezcQXLCQAxEUYv73znJJJW1NF38AjOfKrOx1DCP3rDx48sXIvC4fCECwiKs1yWssJAAFGtjhYUEoFgbKywkAMXa2HeAraqr6rwrsR83tqqun/9+R15V9Wu78zaCrfpD3Qk+fXYEezpScn5hE7XBjrADpGRE2ERtsCPsACkZETZRG+wIO0BKRoRN1AY7wg6QkhFhE7XBzvGwA6NoRNiIrV8StjeKJoSN2PolYXujaELYiK1fErY3iiaEjdj6JWF7o2hC2IitXxK2N4omhI3Y+qWPhO2PzU8ICxkLKywkAMXaWGEhASjWxgoLCUCxNlZYSACKtbHCQgJQ7G0aC50fixUWohVWWEgAirWxwkICUKyNFRYSgGJtrLCQABRrY4WFBKDYlzYWOtNbxAoL/QzCCgsJQLE2VlhIAIq1scJCAlCsjRUWEoBibaywkAAU+/TGQt/zdrHCQj+ZsMJCAlCsjRUWEoBibaywkAAUO2rsejZ31f5zqqHvfIvYEew6yT9uVR33ZPl19mWwc41hV+j6gBOvdfbdawt2N/zk+RHsyUDp2YVN5Zo9YRug9LawqVyzJ2wDlN4WNpVr9oRtgNLbwqZyzd43AAAA///UUFKLAAAABklEQVQDAHKv131FvUd9AAAAAElFTkSuQmCC";

  const bin = binaryFromBase64Png(pngData);
  const graph = traceGraph(bin);

  // Square should produce 1 edge
  assertEquals(graph.edges.length, 1);

  const simplified = simplifyGraph(graph);
  const simplEdge = simplified.edges[0];

  // Debug output
  console.log(`Square segments: ${simplEdge.segments.length}`);
  for (let i = 0; i < Math.min(5, simplEdge.segments.length); i++) {
    const s = simplEdge.segments[i];
    console.log(
      `  [${i}] ${s.type}${
        s.type === "arc" ? ` R=${s.arc.radius.toFixed(1)}` : ""
      }`,
    );
  }

  // A hollow square (rectangle outline) should be represented as multiple segments
  // The exact number depends on how the corners and sides are segmented.
  // For a large smooth rectangle, we expect primarily line segments forming the 4 sides,
  // though anti-aliasing or tracing artifacts may cause additional small segments.
  // Accept 4-30 segments as valid (4 perfect sides, or more with corner artifacts)
  assert(
    simplEdge.segments.length >= 4 && simplEdge.segments.length <= 30,
    `Square should have 4-30 segments, got ${simplEdge.segments.length}`,
  );

  // Most segments should be lines (sides of the square)
  const lineCount = simplEdge.segments.filter((s) => s.type === "line").length;
  assert(
    lineCount >= simplEdge.segments.length * 0.5,
    `Expected mostly lines for square sides, got ${lineCount}/${simplEdge.segments.length} lines`,
  );

  console.log(
    `Square test passed: ${simplEdge.segments.length} segments, ${lineCount} lines`,
  );
});

Deno.test("simplifyGraph - Zigzag line", () => {
  const pngData =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGgAAACxCAYAAAAoLfhGAAAD4klEQVR4Aeyc3U7lMAwGCe//zmfbVZGqKmSzVmIPh0Gt+hv76wzmks+XP2gCnx/+oAmUCWqtocFQwpUJogCg51AQ3JCCFAQnAI/nBCkITgAezwnaImhdUQWtY7mlkoK2YF1XVEHrWG6ppKAtWNcVVdA6llsqKWgL1nVFFbSO5ZZKCtqCdV1RBa1juaWSgm5YiacKIlq5ZVLQDQbxVEFEK7dMCrrBIJ4qiGjllklBNxjEUwURrdwyKegGg3iqIKKVW6Y3EHT7mjc8VRBcqoIUBCcAj+cEKQhOAB7PCVIQnAA8nhOkIDgBeLyyCYJzwcRTEEZFP4iC+lwwdxWEUdEPoqA+F8xdBWFU9IMoqM8Fc1dBGBX9IArqc8HcVRBGRT/IfwrqF/HuPgIK2sd2SWUFLcG4r4iC9rFdUllBSzDuK6KgfWyXVFbQEoz7iihoH9sllRW0BOO+Igrax3a+8uBNBQ3gEB4piGBhkEFBAziERwoiWBhkUNAADuGRgggWBhkUNIBDeKQggoVBBgUN4BAeKShuIWWlglIwx5soKM4uZaWCUjDHmygozi5lpYJSMMebKCjOLmWlglIwx5soKM4uZaWCUjDHm/w+QXFWJSsVVIJ9vqmC5lmVvKmgEuzzTRU0z6rkTQWVYJ9vqqB5ViVvKqgE+3xTBc2zKnlTQSXY55v+FEHzX/RmbyoILlRBCoITgMdzghQEJwCP5wQpCE4AHs8JUhCcADze3gmCf/xPiKcguCUFKQhOAB7PCVIQnAA8nhOkIDgBeDwnSEFwAvB4vQmCR/5d8RQE960gBcEJwOM5QQqCE4DHc4IUBCcAj+cEKQhOIC1erJETFOOWtkpBaahjjRQU45a2SkFpqGONFBTjlrZKQWmoY40UFOOWtkpBaahjjRQU45a2SkH/QF39uEzQ6/X6aK1Vfz++f5mgLzKtKemLRe9YKuicojNUa0o6OfT2UkFnoFPSubfW/v7Ja411PDNW7uWCvj7+lETbz2yttfNQtmMElREYND5/YQaPUx4pKAVzvImC4uxSViooBXO8yZsKigOhrVQQzcgjj4IeQGiXCqIZeeRR0AMI7VJBNCOPPAp6AKFdKohm5JFHQQ8gtEsF0Yw88qAEPbJ5eRBQ0AGBvCmIbOfIpqADAnlTENnOkU1BBwTypiCynSObgg4I5E1BZDtHNgUdEMjbAkHkz/v52RQEd6ggBcEJwOM5QQqCE4DHc4IUBCcAj+cEKQhOgBrvyuUEXSCoBwVRzVy5FHSBoB4URDVz5VLQBYJ6UBDVzJVLQRcI6kFBVDNXLgVdIL47VP+3EQV9ZyZ2f/mqPwAAAP//y9/TfgAAAAZJREFUAwDHkiDh4eYnAwAAAABJRU5ErkJggg==";
  const bin = binaryFromBase64Png(pngData);
  const graph = traceGraph(bin);
  const simplified = simplifyGraph(graph);

  assertEquals(simplified.edges.length, 1);
  const edge = simplified.edges[0];

  // Just dump segment info for debugging for now
  console.log(`Zigzag segments: ${summarizeEdge(edge)}`);
});
