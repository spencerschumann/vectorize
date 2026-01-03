/**
 * Shared test cases for strokes, reusable by Deno tests and debug UI.
 */

import type { RasterContext, PipelineOptions } from "./test_pipeline_core.ts";

export type CaseKind = "canvas" | "base64";

export interface CanvasCase {
  name: string;
  kind: "canvas";
  width: number;
  height: number;
  draw: (ctx: RasterContext) => void;
  pipeline: PipelineOptions;
  fit: {
    tolerance: number;
    curvatureLambda?: number;
  };
  /** Whether the browser UI supports this case (base64 PNG decode is Deno-only) */
  browserSupported?: boolean;
}

export type TestCase = CanvasCase; // extendable later for base64 cases

export const TEST_CASES: TestCase[] = [
  {
    name: "Line (thick)",
    kind: "canvas",
    width: 64,
    height: 32,
    draw: (ctx) => {
      ctx.strokeStyle = "black";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(4, 16);
      ctx.lineTo(60, 16);
      ctx.stroke();
    },
    pipeline: { dpEpsilon: 0.75, rawTolerance: 2.5 },
    fit: { tolerance: 3.0 },
    browserSupported: true,
  },
  {
    name: "L shape",
    kind: "canvas",
    width: 64,
    height: 64,
    draw: (ctx) => {
      ctx.fillStyle = "black";
      // 6-pixel line width built with filled rectangles
      ctx.fillRect(10, 10, 40, 6);
      ctx.fillRect(10, 10, 6, 40);
    },
    pipeline: { dpEpsilon: 0.75, rawTolerance: 5.5 },
    fit: { tolerance: 3.5 },
    browserSupported: true,
  },
  {
    name: "Quarter arc",
    kind: "canvas",
    width: 128,
    height: 128,
    draw: (ctx) => {
      ctx.strokeStyle = "black";
      ctx.lineWidth = 5;
      ctx.beginPath();
      const cx = 50;
      const cy = 20;
      const r = 44;
      // Start directly on the arc at 90 degrees (top-right of center)
      ctx.moveTo(cx + r * Math.cos(Math.PI / 2), cy + r * Math.sin(Math.PI / 2));
      for (let angle = Math.PI / 2; angle <= Math.PI; angle += 0.1) {
        ctx.lineTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
      }
      ctx.stroke();
    },
    pipeline: { dpEpsilon: 1.0, rawTolerance: 3.0 },
    fit: { tolerance: 5.0, curvatureLambda: 50.0 },
    browserSupported: true,
  },
];
