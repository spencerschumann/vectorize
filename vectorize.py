from svgpathtools import svg2paths, wsvg, parse_path
from shapely.geometry import LineString, Point
from shapely.ops import linemerge
import numpy as np
import argparse

# PARAMETERS
d_tol = 1.0      # max distance for snapping endpoints
a_tol = 10       # max angle difference (degrees) for merging collinear segments
simplify_tol = 0  # Douglas–Peucker tolerance

def line_angle(a, b):
    v = np.array(b) - np.array(a)
    return np.degrees(np.arctan2(v[1], v[0]))

def simplify_segments(segments):
    simplified = []
    for s in segments:
        ls = LineString(s)
        simplified.append(list(ls.simplify(simplify_tol, preserve_topology=False).coords))
    return simplified

def merge_collinear(segments):
    merged = []
    used = set()
    for i, s1 in enumerate(segments):
        if i in used:
            continue
        ls1 = LineString(s1)
        for j, s2 in enumerate(segments):
            if j <= i or j in used:
                continue
            ls2 = LineString(s2)
            if ls1.distance(ls2) < d_tol:
                ang1 = line_angle(*s1[:2])
                ang2 = line_angle(*s2[:2])
                if abs(ang1 - ang2) < a_tol:
                    merged_line = linemerge([ls1, ls2])
                    if isinstance(merged_line, LineString):
                        used.add(j)
                        ls1 = merged_line
        merged.append(list(ls1.coords))
    return merged

def snap_endpoints(segments):
    all_pts = [p for seg in segments for p in [seg[0], seg[-1]]]
    for i, seg in enumerate(segments):
        for end_idx in [0, -1]:
            p = np.array(seg[end_idx])
            # find nearest endpoint in others
            for q in all_pts:
                if np.linalg.norm(p - q) < d_tol:
                    seg[end_idx] = tuple(q)
                    break
    return segments

def svg_lines_to_segments(paths):
    segments = []
    for path in paths:
        pts = [(seg.start.real, seg.start.imag) for seg in path]
        pts.append((path[-1].end.real, path[-1].end.imag))
        segments.append(pts)
    return segments

def main(input_svg, output_svg):
    paths, attrs = svg2paths(input_svg)
    segments = svg_lines_to_segments(paths)
    segments = simplify_segments(segments)
    #segments = snap_endpoints(segments)
    #segments = merge_collinear(segments)

    # Build SVG output - convert segments back to path objects
    out_paths = []
    for seg in segments:
        path_data = 'M ' + ' L '.join(f"{x},{y}" for x,y in seg)
        try:
            # Convert the path string back to a path object
            path_obj = parse_path(path_data)
            out_paths.append(path_obj)
        except Exception as e:
            print(f"Warning: Could not parse path {path_data}: {e}")
            continue
    
    # If no valid paths were created, create a minimal SVG
    if not out_paths:
        print("Warning: No valid paths found. Creating empty SVG.")
        wsvg([], filename=output_svg, attributes=[])
    else:
        wsvg(out_paths, filename=output_svg)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Clean SVG lines into simplified paths.")
    parser.add_argument("input_svg", nargs="?", default="input.svg", help="Input SVG file")
    parser.add_argument("output_svg", nargs="?", default="output_clean.svg", help="Output SVG file")
    args = parser.parse_args()
    main(args.input_svg, args.output_svg)
