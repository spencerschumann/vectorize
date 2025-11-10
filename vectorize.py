from svgpathtools import svg2paths, wsvg, parse_path
from shapely.geometry import LineString, Point
from shapely.ops import linemerge
import numpy as np
import argparse

# PARAMETERS
d_tol = 20.0      # max distance for merging endpoints
a_tol = 10       # max angle difference (degrees) for merging collinear segments
simplify_tol = 1.01  # Douglas–Peucker tolerance

def line_angle(a, b):
    v = np.array(b) - np.array(a)
    return np.degrees(np.arctan2(v[1], v[0]))

def simplify_segments(segments):
    simplified = []
    for s in segments:
        ls = LineString(s)
        simplified.append(list(ls.simplify(simplify_tol, preserve_topology=False).coords))
    return simplified

def merge_collinear(segments, merge_dist_tol=1.0, angle_tol=10.0):
    """Merge collinear segments that have endpoints within merge_dist_tol distance.
    Only merges open paths at their endpoints.
    
    Args:
        segments: List of line segments, each a list of points
        merge_dist_tol: Maximum distance between endpoints to consider merging
        angle_tol: Maximum angle difference in degrees to consider segments collinear
    """
    if not segments:
        return []

    # Helper to get endpoints info for a segment
    def get_endpoint_info(seg):
        """Return list of endpoint info tuples for a segment if it's open"""
        if len(seg) > 1 and seg[0] != seg[-1]:
            return [
                (seg[0][0], seg[0][1], True, seg[0], seg[1]),  # start point info
                (seg[-1][0], seg[-1][1], False, seg[-1], seg[-2])  # end point info
            ]
        return []

    # Keep merging until no more merges are possible
    while True:
        # Create a fresh copy and track used segments
        merged = segments.copy()
        used = set()
        merged_any = False

        # Get endpoints for all open paths
        endpoints = []
        for i, seg in enumerate(segments):
            for x, y, is_start, pt, next_pt in get_endpoint_info(seg):
                endpoints.append((x, y, is_start, i, pt, next_pt))

        # Sort by x coordinate for faster nearby point finding
        endpoints.sort()

        # Try to merge segments
        for i, (x1, y1, is_start1, seg_idx1, pt1, next_pt1) in enumerate(endpoints):
            if seg_idx1 in used:
                continue

            # Look at nearby endpoints
            j = i + 1
            # TODO: need binary search or similar on sorted x for efficiency
            while j < len(endpoints):
                x2, y2, is_start2, seg_idx2, pt2, next_pt2 = endpoints[j]

                # Break if beyond possible merge distance in x
                if x2 - x1 > merge_dist_tol:
                    break

                # TODO: won't this skip self-closing merges?
                # Skip if same segment or either segment already used
                if seg_idx1 == seg_idx2 or seg_idx2 in used:
                    j += 1
                    continue

                # Check if points are close enough
                dist = np.sqrt((x2 - x1)**2 + (y2 - y1)**2)
                if dist < merge_dist_tol:
                    seg1, seg2 = merged[seg_idx1], merged[seg_idx2]

                    # Calculate angles for each segment
                    ang1 = line_angle(pt1, next_pt1)
                    ang2 = line_angle(pt2, next_pt2)

                    # Normalize angle difference to -180 to 180 range
                    ang_diff = (ang1 - ang2 + 180) % 360 - 180

                    # Check if segments are collinear (within tolerance)
                    if abs(ang_diff) < angle_tol or abs(abs(ang_diff) - 180) < angle_tol:
                        # Create merged segment with correct orientation
                        merged_coords = []
                        
                        # Determine orientations based on angle difference
                        # If angles are nearly opposite (diff close to 180), we need to reverse one segment
                        reverse1 = is_start1
                        reverse2 = is_start2 if abs(ang_diff) < angle_tol else not is_start2

                        # Build merged path
                        if reverse1:
                            merged_coords.extend(list(reversed(seg1)))
                        else:
                            merged_coords.extend(seg1)
                            
                        if reverse2:
                            merged_coords.extend(list(reversed(seg2))[1:])  # Skip first point to avoid duplication
                        else:
                            merged_coords.extend(seg2[1:])  # Skip first point to avoid duplication

                        merged[seg_idx1] = merged_coords
                        used.add(seg_idx2)
                        merged_any = True
                        break  # Move to next i since we found a merge

                j += 1

        # Get list of segments that haven't been used in merges
        result = [seg for i, seg in enumerate(merged) if i not in used]
        
        # If we didn't merge anything this round, we're done
        if not merged_any:
            break
            
        # Otherwise, try another round with the merged segments
        segments = result

    return segments

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
        # Extract points from each segment and handle line commands properly
        current_points = []
        
        for seg in path:
            start_point = (seg.start.real, seg.start.imag)
            
            # If this is a line segment and we have a current sequence
            if hasattr(seg, 'end') and current_points:
                # Check if this is a continuation of the current path
                if current_points[-1] == start_point:
                    current_points.append((seg.end.real, seg.end.imag))
                else:
                    # This is a new subpath - save the previous one and start new
                    if len(current_points) > 1:
                        segments.append(current_points)
                    current_points = [start_point, (seg.end.real, seg.end.imag)]
            else:
                # This is the first segment or a move command
                if current_points and len(current_points) > 1:
                    segments.append(current_points)
                current_points = [start_point, (seg.end.real, seg.end.imag)]
        
        # Add the last segment if it has more than one point
        if len(current_points) > 1:
            segments.append(current_points)
    
    return segments

def main(input_svg, output_svg):
    paths, attrs = svg2paths(input_svg)
    segments = svg_lines_to_segments(paths)
    segments = simplify_segments(segments)
    #segments = snap_endpoints(segments)
    segments = merge_collinear(segments, merge_dist_tol=d_tol, angle_tol=a_tol)

    # Build SVG output - convert segments back to path objects
    out_paths = []
    for seg in segments:
        if len(seg) < 2:
            continue  # Skip segments with less than 2 points
            
        # Create path data string
        path_data = 'M ' + f"{seg[0][0]},{seg[0][1]}"
        for point in seg[1:]:
            path_data += f" L {point[0]},{point[1]}"
        
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
        wsvg([], filename=output_svg)
    else:
        wsvg(out_paths, filename=output_svg)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Clean SVG lines into simplified paths.")
    parser.add_argument("input_svg", nargs="?", default="input.svg", help="Input SVG file")
    parser.add_argument("output_svg", nargs="?", default="output_clean.svg", help="Output SVG file")
    args = parser.parse_args()
    main(args.input_svg, args.output_svg)
