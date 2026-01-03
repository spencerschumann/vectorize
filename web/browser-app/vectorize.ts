/**
 * Vectorization module - converts skeletonized binary images to vector paths
 */

import type { BinaryImage } from "../src/formats/binary.ts";
import { traceGraph } from "../src/vectorize/tracer.ts";
import { simplifyGraph } from "../src/vectorize/simplifier.ts";
import {
  arcEndPoint,
  arcStartPoint,
  distance,
  projectPointOnLine,
} from "../src/vectorize/geometry.ts";
import {
  isClockwiseAngles,
  isLargeArc,
  signedSweep,
} from "../src/vectorize/arc_fit.ts";
import { Point } from "../src/vectorize/geometry.ts";
import {
  type Corner,
  detectCorners,
  type SegmentPrimitive,
} from "../src/vectorize/corner_detect.ts";

export interface SimplifiedPath {
  points: Array<{ x: number; y: number }>; // Just coordinates after simplification
  closed: boolean;
  segments: SegmentPrimitive[]; // Segment information for rendering arcs + corners
  corners?: Corner[]; // Detected corners for this path
}

export interface VectorizedImage {
  width: number;
  height: number;
  paths: SimplifiedPath[]; // Use SimplifiedPath after vectorization
}

/**
 * Convert a skeletonized binary image to vertices and connected paths
 * Single-pass algorithm that traces complete paths
 */
export function vectorizeSkeleton(binary: BinaryImage): VectorizedImage {
  const graph = traceGraph(binary);
  const simplified = simplifyGraph(graph);

  console.log("Running vectorizeSkeleton()...");

  const paths: SimplifiedPath[] = simplified.edges.map((edge, index) => {
    console.log(`>>> Path ${index}: ${edge.segments.length} segments`);
    edge.segments.forEach((seg, segIndex) => {
      if (seg.type === "line") {
        console.log(
          `  [${segIndex}] LINE: (${seg.start.x.toFixed(2)}, ${
            seg.start.y.toFixed(2)
          }) -> (${seg.end.x.toFixed(2)}, ${seg.end.y.toFixed(2)})`,
        );
      } else {
        console.log(
          `  [${segIndex}] ARC: (${seg.start.x.toFixed(2)}, ${
            seg.start.y.toFixed(2)
          }) -> (${seg.end.x.toFixed(2)}, ${seg.end.y.toFixed(2)}) R=${
            seg.arc.radius.toFixed(2)
          } CW=${seg.arc.clockwise}`,
        );
      }
    });

    // Collect all points from segments for the 'points' property
    const allPoints: Array<{ x: number; y: number }> = [];
    for (const seg of edge.segments) {
      allPoints.push(...seg.points);
    }

    // Determine if closed
    const firstSeg = edge.segments[0];
    const lastSeg = edge.segments[edge.segments.length - 1];
    const first = firstSeg.start;
    const last = lastSeg.end;
    const closed = Math.abs(first.x - last.x) < 1e-4 &&
      Math.abs(first.y - last.y) < 1e-4;

    // Detect corners for this path
    console.log("CALLING detectCorners()");
    const { corners, segmentPrimitives } = detectCorners(edge.segments);

    // Log the corners
    console.log(`Detected ${corners.length} corners:`);
    for (const corner of corners) {
      console.log(
        `  Corner at (${corner.position.x.toFixed(2)}, ${
          corner.position.y.toFixed(2)
        }) with angle ${corner.cornerAngle.toFixed(2)} and radius ${
          corner.radius.toFixed(2)
        }`,
      );
    }

    return {
      points: allPoints,
      closed,
      segments: segmentPrimitives,
      corners,
    };
  });

  return {
    width: binary.width,
    height: binary.height,
    paths,
  };
}

export function renderVectorizedToSVG(
  image: VectorizedImage,
  svgElement: SVGElement,
  width?: number,
  height?: number,
) {
  // Clear existing content
  while (svgElement.firstChild) {
    svgElement.removeChild(svgElement.firstChild);
  }

  if (width && height) {
    svgElement.setAttribute("viewBox", `0 0 ${width} ${height}`);
  } else {
    svgElement.setAttribute(
      "viewBox",
      `0 0 ${image.width} ${image.height}`,
    );
  }

  for (const path of image.paths) {
    // Layer for overlays (pixels + debug text) so they sit above strokes
    const overlayLayer = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "g",
    );
    overlayLayer.setAttribute("class", "overlay-layer");
    svgElement.appendChild(overlayLayer);

    // Map corner position to overlay for click toggles
    const cornerOverlayByKey = new Map<string, SVGGElement>();

    // Draw corners first (so they appear under the paths)
    if (path.corners) {
      for (const corner of path.corners) {
        const circle = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "circle",
        );
        circle.setAttribute("cx", (corner.position.x + 0.5).toString());
        circle.setAttribute("cy", (corner.position.y + 0.5).toString());
        circle.setAttribute("r", "3");
        circle.setAttribute("fill", "orange");
        circle.setAttribute("fill-opacity", "0.5");
        circle.setAttribute("vector-effect", "non-scaling-stroke");
        circle.style.cursor = "pointer";
        svgElement.appendChild(circle);

        const key = `${corner.position.x.toFixed(5)},${
          corner.position.y.toFixed(5)
        }`;
        circle.addEventListener("click", () => {
          const grp = cornerOverlayByKey.get(key);
          if (!grp) return;
          const visible = grp.getAttribute("data-visible") === "true";
          grp.setAttribute("data-visible", visible ? "false" : "true");
          grp.setAttribute("display", visible ? "none" : "inline");
        });
      }
    }

    // Draw segments
    let d = "";
    let points: Point[] = [];
    if (path.segments && path.segments.length > 0) {
      /*const first = path.segments[0];
      const firstX = first.start.x;
      const firstY = first.start.y;
      let projectedFirst = {x: firstX, y: firstY};
      if (first.type == 'arc') {
        projectedFirst = arcStartPoint(first.arc);
      } else if (first.type == 'line') {
        projectedFirst = projectPointOnLine(first.start, first.line);
      }
      d += `M ${projectedFirst.x + 0.5} ${projectedFirst.y + 0.5} `;*/

      path.segments.forEach((seg, segIndex) => {
        // For debug, draw each segment separately for now
        let projectedStart = { x: seg.start.x, y: seg.start.y };
        let projectedEnd = { x: seg.end.x, y: seg.end.y };
        let segD = "";

        if (seg.type == "corner") {
          if (seg.points.length > 0) {
            const firstCornerPoint = seg.points[0];
            segD += `M ${firstCornerPoint.x + 0.5} ${
              firstCornerPoint.y + 0.5
            } `;
            for (let i = 1; i < seg.points.length; i++) {
              const pt = seg.points[i];
              segD += `L ${pt.x + 0.5} ${pt.y + 0.5} `;
            }
            // Do not add all corner pixels to the generic vertex dots; keeps the view uncluttered
          }
          d += segD;
          const overlay = createSegmentOverlay(
            overlayLayer,
            segD,
            seg.points,
            describeSegment(seg, segIndex),
            "corner",
          );
          const key = `${seg.position.x.toFixed(5)},${
            seg.position.y.toFixed(5)
          }`;
          cornerOverlayByKey.set(key, overlay);
          return;
        }

        if (seg.type == "arc") {
          projectedStart = arcStartPoint(seg.arc);
          projectedEnd = arcEndPoint(seg.arc);
          console.log(
            "Arc with center=",
            seg.arc.center,
            " radius=",
            seg.arc.radius,
            " startAngle=",
            seg.arc.startAngle / Math.PI,
            "π",
            " endAngle=",
            seg.arc.endAngle / Math.PI,
            "π",
            " clockwise=",
            seg.arc.clockwise,
            " from ",
            seg.start,
            " to ",
            seg.end,
            " projected to ",
            projectedStart,
            " to ",
            projectedEnd,
          );
        } else if (seg.type == "line") {
          projectedStart = projectPointOnLine(seg.start, seg.line);
          projectedEnd = projectPointOnLine(seg.end, seg.line);
          console.log(
            "Line from ",
            seg.start,
            " to ",
            seg.end,
            " projected to ",
            projectedStart,
            " to ",
            projectedEnd,
          );
        }

        points.push(projectedStart);
        points.push(projectedEnd);
        segD += `M ${projectedStart.x + 0.5} ${projectedStart.y + 0.5} `;

        if (seg.type === "line") {
          segD += `L ${projectedEnd.x + 0.5} ${projectedEnd.y + 0.5} `;
        } else if (seg.type === "arc") {
          const r = seg.arc.radius;
          const sweepAngle = Math.abs(signedSweep(seg.arc));
          const isNearFullCircle = sweepAngle > 1.9 * Math.PI;

          let arcPath = "";
          if (isNearFullCircle) {
            // For near-complete circles (sweep > ~340°), split into two arcs
            // First arc: start -> opposite point
            const angle = seg.arc.startAngle;
            const clockwise = isClockwiseAngles(seg.arc);
            const midAngle = angle + (clockwise ? -Math.PI : Math.PI);
            const midX = seg.arc.center.x + r * Math.cos(midAngle);
            const midY = seg.arc.center.y + r * Math.sin(midAngle);

            // First semicircle
            arcPath += `A ${r} ${r} 0 1 ${clockwise ? 0 : 1}
              ${midX + 0.5} ${midY + 0.5} `;
            // Second semicircle to end point
            arcPath += `A ${r} ${r} 0 1 ${clockwise ? 0 : 1} 
              ${projectedEnd.x + 0.5} ${projectedEnd.y + 0.5} `;
          } else {
            // Regular arc
            const largeArc = isLargeArc(seg.arc) ? 1 : 0;
            const sweep = isClockwiseAngles(seg.arc) ? 0 : 1;
            arcPath += `A ${r} ${r} 0 ${largeArc} ${sweep}
              ${projectedEnd.x + 0.5} ${projectedEnd.y + 0.5} `;
          }
          console.log("  Arc path: ", arcPath);
          segD += arcPath;
        }

        d += segD;
        createSegmentOverlay(
          overlayLayer,
          segD,
          seg.points,
          describeSegment(seg, segIndex),
          "segment",
        );
      });
      /*if (path.closed) {
        d += "Z";
      }*/
    } else {
      // Fallback to points if no segments (shouldn't happen with new simplifier)
      if (path.points.length > 0) {
        d += `M ${path.points[0].x + 0.5} ${path.points[0].y + 0.5} `;
        for (let i = 1; i < path.points.length; i++) {
          d += `L ${path.points[i].x + 0.5} ${path.points[i].y + 0.5} `;
        }
        if (path.closed) d += "Z";
      }
    }

    // Create path element
    const pathEl = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    pathEl.setAttribute("d", d);
    pathEl.setAttribute("fill", "none");
    pathEl.setAttribute("stroke", "red");
    pathEl.setAttribute("stroke-width", "1");
    pathEl.setAttribute("vector-effect", "non-scaling-stroke");
    svgElement.appendChild(pathEl);

    // Draw vertices (endpoints of segments)
    if (points) {
      for (const point of points) {
        const sx = point.x;
        const sy = point.y;
        const circle = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "circle",
        );
        circle.setAttribute("cx", (sx + 0.5).toString());
        circle.setAttribute("cy", (sy + 0.5).toString());
        circle.setAttribute("r", "0.5");
        circle.setAttribute("fill", "blue");
        circle.setAttribute("vector-effect", "non-scaling-stroke");
        svgElement.appendChild(circle);
      }
    } else {
      for (const seg of path.segments) {
        const sx = seg.start.x;
        const sy = seg.start.y;
        const circle = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "circle",
        );
        circle.setAttribute("cx", (sx + 0.5).toString());
        circle.setAttribute("cy", (sy + 0.5).toString());
        circle.setAttribute("r", "0.5");
        circle.setAttribute("fill", "blue");
        circle.setAttribute("vector-effect", "non-scaling-stroke");
        svgElement.appendChild(circle);
      }
      // Draw last endpoint
      if (path.segments.length > 0) {
        const last = path.segments[path.segments.length - 1];
        const ex = last.end.x;
        const ey = last.end.y;
        const circle = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "circle",
        );
        circle.setAttribute("cx", (ex + 0.5).toString());
        circle.setAttribute("cy", (ey + 0.5).toString());
        circle.setAttribute("r", "0.5");
        circle.setAttribute("fill", "blue");
        circle.setAttribute("vector-effect", "non-scaling-stroke");
        svgElement.appendChild(circle);
      }
    }

    // Bring overlays to the front so hit-targets and highlights sit above paths
    svgElement.appendChild(overlayLayer);
  }
}

function describeSegment(seg: SegmentPrimitive, index: number): string {
  const len = distance(seg.start, seg.end).toFixed(2);
  if (seg.type === "line") {
    return `#${index} line len=${len}`;
  }
  if (seg.type === "arc") {
    const sweepDeg = (Math.abs(signedSweep(seg.arc)) * 180 / Math.PI).toFixed(
      1,
    );
    return `#${index} arc len=${len} r=${
      seg.arc.radius.toFixed(2)
    } sweep=${sweepDeg}deg`;
  }
  const angleDeg = (seg.cornerAngle * 180 / Math.PI).toFixed(1);
  return `#${index} corner angle=${angleDeg}° r=${seg.radius.toFixed(2)}`;
}

function createSegmentOverlay(
  layer: SVGElement,
  pathD: string,
  pixels: Point[],
  label: string,
  kind: "segment" | "corner",
): SVGGElement {
  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "g");
  overlay.setAttribute("class", `segment-overlay overlay-${kind}`);
  overlay.setAttribute("display", "none");
  overlay.setAttribute("data-visible", "false");

  const highlight = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  highlight.setAttribute("d", pathD);
  highlight.setAttribute("fill", "none");
  highlight.setAttribute("stroke", kind === "corner" ? "#ff9800" : "#00bcd4");
  highlight.setAttribute("stroke-width", kind === "corner" ? "2.5" : "1.6");
  highlight.setAttribute("vector-effect", "non-scaling-stroke");
  highlight.setAttribute("stroke-opacity", "0.7");
  overlay.appendChild(highlight);

  const pixelGroup = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "g",
  );
  pixels.forEach((p) => {
    const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    c.setAttribute("cx", (p.x + 0.5).toString());
    c.setAttribute("cy", (p.y + 0.5).toString());
    c.setAttribute("r", "0.6");
    c.setAttribute("fill", kind === "corner" ? "#f57c00" : "#2979ff");
    c.setAttribute("fill-opacity", "0.9");
    c.setAttribute("vector-effect", "non-scaling-stroke");
    pixelGroup.appendChild(c);
  });
  overlay.appendChild(pixelGroup);

  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  const anchor = pixels[0] ?? { x: 0, y: 0 };
  const boxPadding = 2.5;
  const textX = anchor.x + 6;
  const textY = anchor.y - 6;
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("x", (textX - boxPadding).toString());
  bg.setAttribute("y", (textY - 6 - boxPadding).toString());
  bg.setAttribute("rx", "2");
  bg.setAttribute("ry", "2");
  bg.setAttribute("fill", "rgba(0,0,0,0.65)");
  bg.setAttribute("stroke", kind === "corner" ? "#ffb74d" : "#4fc3f7");
  bg.setAttribute("stroke-width", "0.5");
  overlay.appendChild(bg);

  text.setAttribute("x", textX.toString());
  text.setAttribute("y", textY.toString());
  text.setAttribute("fill", "#f7f7f7");
  text.setAttribute("font-size", "4");
  text.setAttribute("font-family", "monospace");
  text.textContent = label;
  overlay.appendChild(text);

  // Adjust box width after text is in the DOM
  const bbox = text.getBBox();
  bg.setAttribute("width", (bbox.width + 2 * boxPadding).toString());
  bg.setAttribute("height", (bbox.height + 2 * boxPadding).toString());

  const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
  hit.setAttribute("d", pathD);
  hit.setAttribute("fill", "none");
  hit.setAttribute("stroke", "rgba(0,0,0,0)");
  hit.setAttribute("stroke-width", "8");
  hit.setAttribute("vector-effect", "non-scaling-stroke");
  hit.setAttribute("pointer-events", "stroke");
  hit.style.cursor = "pointer";
  hit.addEventListener("click", () => {
    const visible = overlay.getAttribute("data-visible") === "true";
    overlay.setAttribute("data-visible", visible ? "false" : "true");
    overlay.setAttribute("display", visible ? "none" : "inline");
  });

  // Hit target first so it sits above highlights; overlay visuals are toggled separately
  layer.appendChild(hit);
  layer.appendChild(overlay);

  return overlay;
}
