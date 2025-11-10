from svgpathtools import svg2paths, wsvg, parse_path
from shapely.geometry import LineString, Point
from shapely.ops import linemerge
import numpy as np
import argparse
from path_index import PathIndex

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

def are_segments_collinear(seg1_end: tuple, seg1_dir: tuple, seg2_start: tuple, seg2_dir: tuple, angle_tol: float) -> bool:
    """Check if two segments are collinear at their potential merge point
    
    Args:
        seg1_end: Last two points of first segment if connecting at its end, or first two points if at start
        seg1_dir: Direction vector of first segment at connection point
        seg2_start: First two points of second segment if connecting at its start, or last two points if at end
        seg2_dir: Direction vector of second segment at connection point
        angle_tol: Maximum angle difference in degrees to consider collinear
        
    Returns:
        bool: True if segments are collinear within tolerance
    """
    # Compute angle between direction vectors
    dot = np.dot(seg1_dir, seg2_dir)
    angle = np.degrees(np.arccos(np.clip(abs(dot), -1.0, 1.0)))
    
    # Check if vectors are aligned (parallel or anti-parallel)
    return angle < angle_tol or abs(180 - angle) < angle_tol

def merge_paths(path1: list, path2: list, reverse1: bool, reverse2: bool) -> list:
    """Merge two paths with given orientations
    
    Args:
        path1: First path to merge
        path2: Second path to merge
        reverse1: Whether to reverse first path
        reverse2: Whether to reverse second path
        
    Returns:
        list: Merged path
    """
    result = []
    if reverse1:
        result.extend(reversed(path1))
    else:
        result.extend(path1)
        
    if reverse2:
        result.extend(reversed(path2[1:]))  # Skip first point to avoid duplication
    else:
        result.extend(path2[1:])  # Skip first point to avoid duplication
    
    return result

def handle_self_closing_paths(segments: list, merge_dist_tol: float) -> list:
    """Process paths that should close on themselves.
    A path should self-close if its endpoints are within merge_dist_tol.
    
    Args:
        segments: List of paths to process
        merge_dist_tol: Maximum distance for considering endpoints connected
        
    Returns:
        List of processed paths, with self-closing paths properly closed
    """
    result = []
    
    for path in segments:
        if len(path) < 3:  # Need at least 3 points for a closed path
            result.append(path)
            continue
            
        # Check if start and end points are close enough
        start = np.array(path[0])
        end = np.array(path[-1])
        
        if np.allclose(start, end):  # Already closed
            result.append(path)
            continue
            
        dist = np.linalg.norm(end - start)
        if dist <= merge_dist_tol:
            # Check if start and end segments are collinear
            start_dir = np.array(path[1]) - start
            end_dir = end - np.array(path[-2])
            start_dir = start_dir / np.linalg.norm(start_dir)
            end_dir = end_dir / np.linalg.norm(end_dir)
            
            if are_segments_collinear(path[:2], start_dir, path[-2:], -end_dir, a_tol):
                # Close the path by adding a copy of the start point
                closed_path = path + [tuple(start)]
                result.append(closed_path)
            else:
                result.append(path)
        else:
            result.append(path)
            
    return result

def merge_collinear(segments: list, merge_dist_tol: float = 1.0, angle_tol: float = 10.0) -> list:
    """Merge collinear segments that have endpoints within merge_dist_tol distance.
    
    Args:
        segments: List of line segments, each a list of points
        merge_dist_tol: Maximum distance between endpoints to consider merging
        angle_tol: Maximum angle difference in degrees to consider segments collinear
        
    Returns:
        list: List of merged path segments
    """
    if not segments:
        return []
        
    # First try to close any paths that should be self-closing
    segments = handle_self_closing_paths(segments, merge_dist_tol)
    
    # Create spatial index for remaining open paths
    path_index = PathIndex(segments)
    result = segments.copy()
    
    while True:
        original_count = len(result)
        merged_segments = []
        used = set()
        
        # Try to merge each path
        for i, path in enumerate(result):
            if i in used or len(path) < 2:
                continue
                
            # Skip if path is closed
            if len(path) >= 3 and np.allclose(path[0], path[-1]):
                merged_segments.append(path)
                used.add(i)
                continue
                
            # Try to merge at path start
            start_point = path[0]
            start_dir = np.array(path[1]) - np.array(path[0])
            start_dir = start_dir / np.linalg.norm(start_dir)
            
            matches = path_index.find_endpoints_in_radius(start_point, merge_dist_tol)
            for match in matches:
                if match.path_index == i or match.path_index in used:
                    continue
                    
                other_path = result[match.path_index]
                # Skip closed paths
                if len(other_path) >= 3 and np.allclose(other_path[0], other_path[-1]):
                    continue
                    
                if match.is_start:
                    other_dir = np.array(other_path[1]) - np.array(other_path[0])
                else:
                    other_dir = np.array(other_path[-1]) - np.array(other_path[-2])
                other_dir = other_dir / np.linalg.norm(other_dir)
                
                if are_segments_collinear(path[0:2], start_dir, 
                                        other_path[0:2] if match.is_start else other_path[-2:],
                                        other_dir, angle_tol):
                    merged = merge_paths(other_path, path, 
                                      not match.is_start,  # Reverse other path if connecting to its end
                                      False)  # Don't reverse current path
                    merged_segments.append(merged)
                    used.add(i)
                    used.add(match.path_index)
                    path_index.remove_path(i)
                    path_index.remove_path(match.path_index)
                    break
            
            if i in used:
                continue
                
            # Try to merge at path end
            end_point = path[-1]
            end_dir = np.array(path[-1]) - np.array(path[-2])
            end_dir = end_dir / np.linalg.norm(end_dir)
            
            matches = path_index.find_endpoints_in_radius(end_point, merge_dist_tol)
            for match in matches:
                if match.path_index == i or match.path_index in used:
                    continue
                    
                other_path = result[match.path_index]
                # Skip closed paths
                if len(other_path) >= 3 and np.allclose(other_path[0], other_path[-1]):
                    continue
                    
                if match.is_start:
                    other_dir = np.array(other_path[1]) - np.array(other_path[0])
                else:
                    other_dir = np.array(other_path[-1]) - np.array(other_path[-2])
                other_dir = other_dir / np.linalg.norm(other_dir)
                
                if are_segments_collinear(path[-2:], end_dir,
                                        other_path[0:2] if match.is_start else other_path[-2:],
                                        other_dir, angle_tol):
                    merged = merge_paths(path, other_path,
                                      False,  # Don't reverse current path
                                      match.is_start)  # Reverse other path if connecting to its end
                    merged_segments.append(merged)
                    used.add(i)
                    used.add(match.path_index)
                    path_index.remove_path(i)
                    path_index.remove_path(match.path_index)
                    break
            
            # If path wasn't merged, keep it
            if i not in used:
                merged_segments.append(path)
        
        # If no merges happened, we're done
        if len(merged_segments) >= original_count:
            break
            
        # Update for next iteration
        result = merged_segments
        path_index = PathIndex(result)  # Rebuild index with new paths
    
    return result

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
