/**
 * End-to-end tests using real raster data to drive the optimizer.
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { PNG } from "npm:pngjs@7.0.0";
import { Buffer } from "node:buffer";
import { buildStrokesFromBase64, buildStrokesFromCanvas } from "./test_pipeline.ts";
import { globalFit } from "./global_fitter.ts";
import type { BinaryImage } from "../formats/binary.ts";
import { getPixelBin } from "../formats/binary.ts";
import { renderDebugLayers } from "./debug_render.ts";
import { TEST_CASES } from "./cases.ts";

// Set to true to emit debug visualizations
// Can be enabled via: DEBUG_VIS=1 deno test ... (Git Bash)
// Or just toggle this constant to true for debugging
const DEBUG_VIS = Deno.env.get("DEBUG_VIS") === "1" || false;

// Helper to run a canvas case
async function runCanvasCase(
  name: string,
  width: number,
  height: number,
  draw: (ctx: any) => void,
  pipelineOpts: { dpEpsilon: number; rawTolerance: number },
  fitOpts: { tolerance: number; curvatureLambda?: number },
  debugPrefix: string,
) {
  const { strokes, skeleton } = buildStrokesFromCanvas(width, height, draw, pipelineOpts);
  assertEquals(strokes.length >= 1, true);

  for (let i = 0; i < strokes.length; i++) {
    const stroke = strokes[i];
    const result = globalFit(stroke, fitOpts);
    assertExists(result.primitives);
    assertEquals(result.primitives.length >= 1, true);

    if (DEBUG_VIS) {
      const dataUrl = await renderDebugLayers({
        skeleton,
        dpPath: stroke.dpPoints,
        primitives: result.primitives,
        rawPixels: stroke.rawPixels,
      }, {
        filename: `output/${debugPrefix}_${i}.png`,
        lineWidth: 2,
      });
      console.log(`\n${name} debug (${stroke.dpPoints.length} DP, ${result.primitives.length} prims):`);
      console.log(dataUrl);
    }
  }
}

function binaryToBase64PngRGBA(binary: BinaryImage): string {
  const width = binary.width;
  const height = binary.height;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const v = getPixelBin(binary, x, y) === 1 ? 0 : 255;
      data[idx] = v;
      data[idx + 1] = v;
      data[idx + 2] = v;
      data[idx + 3] = 255;
    }
  }
  const buf = PNG.sync.write({ width, height, data });
  return `data:image/png;base64,${Buffer.from(buf).toString("base64")}`;
}

Deno.test("pipeline - canvas line then global fit", async () => {
  const c = TEST_CASES.find((c) => c.name === "Line (thick)");
  if (!c) throw new Error("missing case");
  await runCanvasCase(
    c.name,
    c.width,
    c.height,
    c.draw,
    c.pipeline,
    c.fit,
    "debug_line_stroke",
  );
});

Deno.test("pipeline - base64 (L shape) then global fit", async () => {
  const c = TEST_CASES.find((c) => c.name === "L shape");
  if (!c) throw new Error("missing case");

  // First build via canvas, then encode to PNG base64 to exercise the base64 path
  const canvasBuild = buildStrokesFromCanvas(
    c.width,
    c.height,
    c.draw,
    c.pipeline,
  );

  const base64 = binaryToBase64PngRGBA(canvasBuild.skeleton);
  const { strokes, skeleton } = buildStrokesFromBase64(base64, c.pipeline);

  assertEquals(strokes.length >= 1, true);

  for (let i = 0; i < strokes.length; i++) {
    const stroke = strokes[i];
    const result = globalFit(stroke, c.fit);
    assertExists(result.primitives);
    assertEquals(result.primitives.length >= 1, true);

    if (DEBUG_VIS) {
      const dataUrl = await renderDebugLayers({
        skeleton,
        dpPath: stroke.dpPoints,
        primitives: result.primitives,
        rawPixels: stroke.rawPixels,
      }, {
        filename: `output/debug_lshape_stroke_${i}.png`,
        lineWidth: 2,
      });
      console.log(`L shape debug: ${dataUrl.substring(0, 120)}...`);
    }
  }
});

Deno.test("pipeline - arc shape with visualization", async () => {
  const c = TEST_CASES.find((c) => c.name === "Quarter arc");
  if (!c) throw new Error("missing case");
  await runCanvasCase(
    c.name,
    c.width,
    c.height,
    c.draw,
    c.pipeline,
    { ...c.fit, tolerance: c.fit.tolerance, curvatureLambda: c.fit.curvatureLambda },
    "debug_arc_stroke",
  );
});
