import unittest
import numpy as np
from cleanup import merge_collinear, simplify_segments

class TestCleanup(unittest.TestCase):
    def assert_segments_match(self, actual_segments, expected_segments):
        """Helper to compare sets of segments, accounting for reversed segments and order"""
        self.assertEqual(len(actual_segments), len(expected_segments), 
                        f"Number of segments doesn't match. Got {len(actual_segments)}, expected {len(expected_segments)}")
        
        # Convert segments to tuples and round coordinates for comparison
        def round_points(seg):
            return tuple(tuple(round(x, 6) for x in pt) for pt in seg)
        
        actual = [round_points(seg) for seg in actual_segments]
        expected = [round_points(seg) for seg in expected_segments]
        
        # For each expected segment, try to find a matching actual segment
        for e in expected:
            # Try both forward and reversed
            e_rev = tuple(reversed(e))
            found = False
            for a in actual:
                if a == e or a == e_rev:
                    found = True
                    break
            self.assertTrue(found, f"No match found for expected segment {e}\nGot segments: {actual}")

    def test_basic_collinear_merge(self):
        """Test case 1: Two collinear segments that should merge"""
        segments = [
            [(0, 0), (10, 10)],
            [(10, 10), (20, 20)]
        ]
        merged = merge_collinear(segments, merge_dist_tol=0.1, angle_tol=5.0)
        self.assert_segments_match(merged, [[(0, 0), (10, 10), (20, 20)]])

    def test_endpoint_distance_threshold(self):
        """Test case 2: Two segments with endpoints too far apart"""
        segments = [
            [(0, 0), (10, 10)],
            [(12.0, 12.0), (20, 20)]
        ]
        merged = merge_collinear(segments, merge_dist_tol=0.1, angle_tol=5.0)
        self.assert_segments_match(merged, [
            [(0, 0), (10, 10)],
            [(12.0, 12.0), (20, 20)]
        ])

    def test_angle_threshold(self):
        """Test case 3: Two segments at different angles"""
        segments = [
            [(0, 0), (10, 10)],
            [(10, 10), (20, 10)]  # 45 degrees different
        ]
        merged = merge_collinear(segments, merge_dist_tol=0.1, angle_tol=5.0)
        self.assert_segments_match(merged, segments)

    def test_closed_path_preservation(self):
        """Test case 4: Closed path should not merge with other segments"""
        segments = [
            [(0, 0), (10, 10), (10, 20), (0, 0)],  # closed path
            [(10, 10), (20, 20)]
        ]
        merged = merge_collinear(segments, merge_dist_tol=0.1, angle_tol=5.0)
        self.assert_segments_match(merged, segments)

    def test_simplify_closed_path_removes_redundant_endpoint(self):
        # Path with redundant endpoint
        path = [(10,0), (20,0), (20,10), (0,10), (0,0), (10,0)]
        simplified = simplify_segments([path])[0]
        # Should be closed, minimal, with start = end
        self.assertEqual(simplified[0], simplified[-1])
        self.assertEqual(len(simplified), 5)
        # Should contain all corners
        for pt in [(0,0), (20,0), (20,10), (0,10)]:
            self.assertIn(pt, simplified)
            
    def test_multi_segment_merge(self):
        """Test case 5: Three collinear segments should merge into one"""
        segments = [
            [(0, 0), (10, 10)],
            [(10, 10), (20, 20)],
            [(20, 20), (30, 30)]
        ]
        merged = merge_collinear(segments, merge_dist_tol=0.1, angle_tol=5.0)
        self.assert_segments_match(merged, [[(0, 0), (10, 10), (20, 20), (30, 30)]])

    def test_opposite_direction_merge(self):
        """Test case 6: Two segments in opposite directions should merge correctly"""
        segments = [
            [(0, 0), (10, 10)],
            [(20, 20), (10, 10)]
        ]
        merged = merge_collinear(segments, merge_dist_tol=0.1, angle_tol=5.0)
        self.assert_segments_match(merged, [[(0, 0), (10, 10), (20, 20)]])

    def test_edge_cases(self):
        """Test case 7-8: Empty input and single segment cases"""
        # Empty input
        self.assertEqual(merge_collinear([]), [])
        
        # Single segment
        segments = [[(0, 0), (10, 10)]]
        merged = merge_collinear(segments, merge_dist_tol=0.1, angle_tol=5.0)
        self.assert_segments_match(merged, segments)

    def test_single_path_self_closing(self):
        """Test case 9.1: Single path should merge its endpoints to form a closed path"""
        segments = [
            [(0, 10), (0, 0), (10, 0), (10, 20), (0, 20), (0, 11)]
        ]
        merged = merge_collinear(segments, merge_dist_tol=1.1)
        expected = [[(0, 10), (0, 0), (10, 0), (10, 20), (0, 20), (0, 11), (0, 10)]]
        self.assert_segments_match(merged, expected)

    def test_two_paths_joining_to_close(self):
        """Test case 9.2: Two separate paths should merge to form one closed path"""
        segments = [
            [(0, 10), (0, 0), (10, 0), (10, 10)],
            [(0, 11), (0, 20), (10, 20), (10, 11)]
        ]
        merged = merge_collinear(segments, merge_dist_tol=1.1)
        # The segments should merge into a single closed path
        self.assertEqual(len(merged), 1, "Should merge into a single path")
        
        # Verify it's a closed path (first point equals last point)
        self.assertTrue(np.allclose(merged[0][0], merged[0][-1]), 
                       "Path should be closed (first point = last point)")
        
        # All key points should be present (order doesn't matter)
        expected_points = {(0, 0), (0, 10), (10, 0), (10, 20), (0, 20)}
        actual_points = set(tuple(p) for p in merged[0])
        for p in expected_points:
            self.assertIn(p, actual_points, f"Missing expected point {p}")

    def test_parallel_dashed_lines(self):
        """Test case 11: Parallel dashed lines should not merge across the gap
        
        This test simulates parallel dashed lines where the distance between 
        the lines is similar to the gap between dashes. The segments should 
        follow the dashes, not jump to the parallel line.
        """
        # Two parallel horizontal dashed lines, 20 units apart
        # Line 1 at y=0: dashes from 0-30, 50-80, 100-130
        # Line 2 at y=20: dashes from 0-30, 50-80, 100-130
        # Gap between dashes is 20 units, same as distance between lines
        segments = [
            [(0, 0), (30, 0)],      # Line 1, dash 1
            [(50, 0), (80, 0)],     # Line 1, dash 2
            [(100, 0), (130, 0)],   # Line 1, dash 3
            [(0, 19), (30, 19)],    # Line 2, dash 1
            [(50, 19), (80, 19)],   # Line 2, dash 2
            [(100, 19), (130, 19)], # Line 2, dash 3
        ]
        
        # With merge_dist_tol=25, endpoints can reach across gaps
        # But they should NOT merge with the parallel line (offset by 20 units)
        merged = merge_collinear(segments, merge_dist_tol=25, angle_tol=5.0)
        
        # Should get 2 merged paths (one for each line), not cross-contamination
        self.assertEqual(len(merged), 2, 
                        f"Expected 2 merged paths (one per line), got {len(merged)}")
        
        # Check that each merged path is continuous along one y-coordinate
        for path in merged:
            y_coords = [pt[1] for pt in path]
            # All points in a path should have the same y-coordinate (within tolerance)
            self.assertTrue(all(abs(y - y_coords[0]) < 1.0 for y in y_coords),
                           f"Path crosses between parallel lines: {path}")
            
            # Each path should span the full x-range (0 to 130)
            x_coords = [pt[0] for pt in path]
            self.assertAlmostEqual(min(x_coords), 0, delta=1.0)
            self.assertAlmostEqual(max(x_coords), 130, delta=1.0)

    def test_parallel_dashed_lines_with_closed_ends(self):
        """Test case 12: Parallel dashed lines with closed end caps.

        Outer dashes are closed into short rectangles at the ends. The
        algorithm should prefer completing the dashed line merges (one per
        y-coordinate) rather than closing small rectangles prematurely.
        """
        segments = [
            [(30, 0), (0, 0), (0, 19), (30, 19)],  # open rectangle at left
            [(50, 0), (80, 0)],                    # middle dash (top)
            [(50, 19), (80, 19)],                  # middle dash (bottom)
            [(100, 0), (130, 0), (130, 19), (100, 19)],  # open rectangle at right
        ]

        merged = merge_collinear(segments, merge_dist_tol=25, angle_tol=5.0)

        # Run a round of simplification to clean up redundant points
        merged = simplify_segments(merged)
        
        # We expect one long, closed rectangular path
        self.assertEqual(len(merged), 1,
                         f"Expected 1 merged path (closed rectangle), got {len(merged)}")
        
        # Verify it's a closed path (first point equals last point)
        path = merged[0]
        self.assertTrue(np.allclose(path[0], path[-1], atol=0.1),
                       f"Path should be closed. Start: {path[0]}, End: {path[-1]}")
        
        self.assertEqual(len(path), 5)  # 4 corners + closing point

        # Verify the path contains all 4 corners of the rectangle
        expected_corners = {(0, 0), (130, 0), (130, 19), (0, 19)}
        actual_points = {tuple(pt) for pt in path}
        for corner in expected_corners:
            self.assertTrue(any(np.allclose(corner, pt, atol=0.1) for pt in path),
                           f"Missing expected corner {corner} in path")
    
    def test_c_shape_should_not_close(self):
        """Test case 13: C-shape with separate end segments should not close
        
        A C-shape where the open ends have separate horizontal segments should
        not be closed because those segments are offset (not collinear with 
        the connection that would be made).
        """
        segments = [
            [(30, 0), (0, 0), (0, 19), (30, 19)]  # C-shaped path
        ]
        orig_segs = segments.copy()
        
        merged = merge_collinear(segments, merge_dist_tol=25, angle_tol=5.0)
        
        self.assertEqual(len(merged), 1, 
                        f"Expected 1 merged path, got {len(merged)}")

        self.assertEqual(orig_segs, merged)

    def test_rectangular_frame_with_dashed_sides(self):
        """Test case 14: Rectangular frame with corner turns and dashed horizontal lines
        
        Based on real SVG paths that represent a rectangular frame with:
        - Left side with corner turns (vertical segments with 45-degree corners)
        - Right side with vertical segments
        - Dashed horizontal lines at top and bottom
        
        The corner segments should merge with the straight segments properly.
        """
        segments = [
            # Top left corner path with turn
            [(354.0, 3638.0), (354.0, 3588.0), (357.0, 3585.0), (384.0, 3585.0)],
            # Top dashed line segments
            [(411.0, 3585.0), (459.0, 3585.0)],
            [(486.0, 3585.0), (534.0, 3585.0)],
            [(560.0, 3585.0), (609.0, 3585.0)],
            [(635.0, 3585.0), (684.0, 3585.0)],
            [(711.0, 3585.0), (760.0, 3585.0)],
            [(786.0, 3585.0), (835.0, 3585.0)],
            [(860.0, 3585.0), (910.0, 3585.0)],
            [(936.0, 3585.0), (985.0, 3585.0)],
            [(1010.0, 3585.0), (1060.0, 3585.0)],
            [(1086.0, 3585.0), (1114.0, 3585.0)],
            # Left side vertical segments
            [(322.0, 3588.0), (322.0, 3637.0)],
            [(322.0, 3665.0), (322.0, 3713.0)],
            [(354.0, 3665.0), (354.0, 3713.0)],
            [(322.0, 3740.0), (322.0, 3788.0)],
            [(354.0, 3740.0), (354.0, 3788.0)],
            [(322.0, 3815.0), (322.0, 3866.0)],
            # Bottom left corner path with turn
            [(354.0, 3815.0), (354.0, 3866.0), (357.0, 3869.0), (385.0, 3869.0)],
            # Bottom dashed line segments
            [(411.0, 3869.0), (460.0, 3869.0)],
            [(485.0, 3869.0), (535.0, 3869.0)],
            [(560.0, 3869.0), (609.0, 3869.0)],
            [(635.0, 3869.0), (685.0, 3869.0)],
            [(710.0, 3869.0), (760.0, 3869.0)],
            [(785.0, 3869.0), (834.0, 3869.0)],
            [(860.0, 3869.0), (910.0, 3869.0)],
            [(935.0, 3869.0), (985.0, 3869.0)],
            [(1010.0, 3869.0), (1060.0, 3869.0)],
            [(1085.0, 3869.0), (1114.0, 3869.0)],
        ]
        
        # Use default tolerances from cleanup.py
        merged = merge_collinear(segments, merge_dist_tol=50.0, angle_tol=15.0)
        
        print(f"\nNumber of merged paths: {len(merged)}")
        for i, path in enumerate(merged):
            print(f"Path {i}: {len(path)} points")
            print(f"  Start: {path[0]}")
            print(f"  End: {path[-1]}")
            if len(path) <= 10:
                print(f"  All points: {path}")
        
        # Check for backtracking in paths (y-coordinates shouldn't jank back and forth)
        for i, path in enumerate(merged):
            # For vertical paths, check if y-coordinates are monotonic or have major direction changes
            y_coords = [pt[1] for pt in path]
            if len(y_coords) >= 3:
                # Check for direction reversals (going down then up, or up then down)
                deltas = [y_coords[i+1] - y_coords[i] for i in range(len(y_coords)-1)]
                # Filter out small movements (< 1 pixel)
                significant_deltas = [d for d in deltas if abs(d) > 1.0]
                if len(significant_deltas) >= 2:
                    # Check if signs change (indicating backtracking)
                    signs = [1 if d > 0 else -1 for d in significant_deltas]
                    has_reversal = any(signs[i] != signs[i+1] for i in range(len(signs)-1))
                    self.assertFalse(has_reversal, 
                                   f"Path {i} has y-coordinate reversal (backtracking): {path}")
        
        # Should merge down to approximately 2 paths (one closed rectangle path)
        self.assertEqual(len(merged), 2,
                       f"Expected 2 paths after merging (top and bottom), got {len(merged)}")

    def test_horizontal_line_with_small_gaps(self):
        """Test case 15: Horizontal line segments with small gaps should merge
        
        Real-world case: horizontal line at y=1785 with segments separated by
        small gaps (3-29 pixels). All segments should merge into a single line
        with default tolerances (merge_dist_tol=50).
        """
        segments = [
            [(2242.0, 1785.0), (2323.0, 1785.0)],  # gap of 3 to next
            [(2326.0, 1785.0), (2363.0, 1785.0)],  # gap of 29 to next (after reorder)
            [(2042.0, 1785.0), (2163.0, 1785.0)],  # gap of 29 to next
            [(2192.0, 1785.0), (2201.0, 1785.0)],  # gap of 11 to next
            [(2212.0, 1785.0), (2214.0, 1785.0)],  # gap of 28 to next (after reorder)
            [(2392.0, 1785.0), (2403.0, 1785.0)],  # gap of 6 to next
            [(2409.0, 1785.0), (2414.0, 1785.0)],  # gap of 28 to next
            [(2442.0, 1785.0), (2563.0, 1785.0)],
        ]
        
        merged = merge_collinear(segments, merge_dist_tol=50.0, angle_tol=15.0)
        
        print(f"\nNumber of merged paths: {len(merged)}")
        for i, path in enumerate(merged):
            x_coords = [pt[0] for pt in path]
            print(f"Path {i}: {len(path)} points, x-range: {min(x_coords):.0f} to {max(x_coords):.0f}")
        
        # All segments are collinear and within merge distance, should merge into 1 path
        self.assertEqual(len(merged), 1,
                        f"Expected 1 merged path, got {len(merged)}")
        
        # The merged path should span from 2042 to 2563
        path = merged[0]
        x_coords = [pt[0] for pt in path]
        self.assertAlmostEqual(min(x_coords), 2042.0, delta=1.0)
        self.assertAlmostEqual(max(x_coords), 2563.0, delta=1.0)
        
        # All points should be at y=1785
        y_coords = [pt[1] for pt in path]
        self.assertTrue(all(abs(y - 1785.0) < 0.1 for y in y_coords),
                       f"All points should be at y=1785, got y-coords: {set(y_coords)}")

    def test_filter_speckles_from_dashed_line(self):
        """Test case 16: Speckles merge into nearby lines without angle constraints
        
        Real-world case from autotrace output: diagonal line with dashed segments
        and a single-pixel speckle. The speckle should merge into the main line
        during collinear merging (without angle checks), then get simplified away
        by Douglas-Peucker.
        """
        from cleanup import is_speckle, calculate_path_length
        
        segments = [
            # Main diagonal line (19 points, ~19 pixels)
            [(0, 0), (1, 0), (2, -1), (3, -1), (4, -2), (5, -2), (6, -2),
             (7, -2), (8, -2), (9, -2), (10, -2), (11, -2), (12, -2), 
             (13, -2), (14, -3), (15, -3), (16, -3), (17, -3), (18, -3)],
            # Single-pixel speckle (1 pixel) - 8 pixels from main line, within merge range
            [(-8, 0), (-7, 0)],
            # Dashed line segments (parts of the same line)
            [(-43, 4), (-42, 3), (-41, 3), (-40, 3), (-39, 3), (-38, 3), (-37, 3), (-36, 3)],
            [(-59, 5), (-58, 5), (-57, 5), (-56, 5), (-55, 5), (-54, 5), (-53, 5), (-52, 5)],
            [(-68, 6), (-67, 6), (-66, 6), (-65, 6), (-64, 6)],
        ]
        
        # Calculate lengths
        lengths = [calculate_path_length(seg) for seg in segments]
        print(f"\nPath lengths: {[f'{l:.1f}' for l in lengths]}")
        
        # Verify speckle detection
        self.assertTrue(is_speckle(segments[1]), "Second segment should be detected as speckle")
        
        # Merge collinear segments - speckles should merge without angle checks
        # The speckle at (-8,0) to (-7,0) is 8 pixels from the main diagonal line,
        # well within merge_dist_tol=50. It should merge into the main line.
        merged = merge_collinear(segments, merge_dist_tol=50.0, angle_tol=15.0)
        
        print(f"Merged from {len(segments)} to {len(merged)} segments")
        
        # After merging and simplification, the speckle should have merged with the main line
        # and been simplified away. The three dashed segments should also merge.
        self.assertLessEqual(len(merged), 2,
                        f"Expected <= 2 segments after merging (main line + dashed line), got {len(merged)}")
        
        # Verify no very short segments remain (speckle should be merged/simplified away)
        merged_lengths = [calculate_path_length(seg) for seg in merged]
        self.assertTrue(all(l >= 5.0 for l in merged_lengths),
                       f"All merged segments should be >= 5 pixels, got {merged_lengths}")
        self.assertTrue(any(calculate_path_length(seg) > 18 for seg in merged),
                       "Main diagonal line should be preserved")

    def test_speckle_offset_rejection(self):
        """Test case 17: Speckles that are offset from a line should not merge
        
        Speckles should only merge if they're very close to the line (within 2 pixels).
        This prevents merging random noise while allowing speckles that fill gaps in
        dashed lines.
        """
        from cleanup import is_speckle, calculate_path_length
        
        segments = [
            # Main horizontal line at y=0
            [(0, 0), (100, 0)],
            # Speckle at y=5, too far from the line (> 2 pixel tolerance)
            [(100, 5), (101, 5)],
            # Speckle very close to the line (y=1), should merge
            [(100, 1), (101, 1)],
        ]
        
        # Verify speckle detection
        self.assertFalse(is_speckle(segments[0]), "Main line should not be a speckle")
        self.assertTrue(is_speckle(segments[1]), "Offset segment should be detected as speckle")
        self.assertTrue(is_speckle(segments[2]), "Close segment should be detected as speckle")
        
        # With merge_dist_tol=50, endpoint distance would allow merging
        # But tight speckle tolerance (2 pixels) should prevent the far speckle from merging
        merged = merge_collinear(segments, merge_dist_tol=50.0, angle_tol=15.0)
        
        print(f"\nMerged from {len(segments)} to {len(merged)} segments")
        for i, seg in enumerate(merged):
            length = calculate_path_length(seg)
            y_coords = [pt[1] for pt in seg]
            print(f"  Segment {i}: length={length:.1f}, y_range=[{min(y_coords):.1f}, {max(y_coords):.1f}]")
        
        # Should have 1 segment: main line merged with close speckle (y=1)
        # The offset speckle (y=5) should be filtered out because it didn't merge
        self.assertEqual(len(merged), 1,
                        f"Expected 1 segment (main line + close speckle, offset filtered), got {len(merged)}")
        
        # The merged segment should have y-coordinates near 0-1
        path = merged[0]
        y_coords = [pt[1] for pt in path]
        self.assertTrue(all(abs(y) <= 2 for y in y_coords),
                       f"Merged segment should have y near 0-1, got y_range=[{min(y_coords)}, {max(y_coords)}]")
        
        # The main line segment should be longer than 100 (merged with close speckle)
        main_length = calculate_path_length(path)
        self.assertGreater(main_length, 100.0, 
                          f"Main line should have merged with close speckle, length={main_length:.1f}")

    def test_large_dataset_performance(self):
        """Test case 10: Large dataset performance"""
        # Test case 10: Large dataset performance
        # Create 1000 small horizontal line segments that should merge
        segments = []
        for i in range(1000):
            x = i*2
            segments.append([(x, 0), (x + 1, 0)])
        for i in range(1000):
            x = i * 2
            segments.append([(x, 10), (x + 1, 10)])

        import time
        start_time = time.time()
        merged = merge_collinear(segments, merge_dist_tol=1.1)
        end_time = time.time()
        
        # Should merge into two long horizontal lines
        self.assertEqual(len(merged), 2)
        self.assertLess(end_time - start_time, 2.0)  # Should complete in under 2 seconds

if __name__ == '__main__':
    unittest.main(verbosity=2)
