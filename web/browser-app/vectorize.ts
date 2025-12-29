/**
 * Vectorization module - converts skeletonized binary images to vector paths
 */

import type { BinaryImage } from "../src/formats/binary.ts";
import { traceGraph } from "../src/vectorize/tracer.ts";
import { type Segment, simplifyGraph } from "../src/vectorize/simplifier.ts";
import {
  arcEndPoint,
  arcStartPoint,
  projectPointOnLine,
} from "../src/vectorize/geometry.ts";
import {
  isClockwiseAngles,
  isLargeArc,
  signedSweep,
} from "../src/vectorize/arc_fit.ts";
import { Point } from "../src/vectorize/geometry.ts";

export interface SimplifiedPath {
  points: Array<{ x: number; y: number }>; // Just coordinates after simplification
  closed: boolean;
  segments: Segment[]; // Segment information for rendering arcs
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

  const paths: SimplifiedPath[] = simplified.edges.map((edge, index) => {
    console.log(`Path ${index}: ${edge.segments.length} segments`);
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

    return {
      points: allPoints,
      closed,
      segments: edge.segments,
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

      for (const seg of path.segments) {
        // For debug, draw each segment separately for now
        let projectedStart = { x: seg.start.x, y: seg.start.y };
        let projectedEnd = { x: seg.end.x, y: seg.end.y };
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
        d += `M ${projectedStart.x + 0.5} ${projectedStart.y + 0.5} `;

        if (seg.type === "line") {
          d += `L ${projectedEnd.x + 0.5} ${projectedEnd.y + 0.5} `;
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
          d += arcPath;
        }
      }
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
  }
}
