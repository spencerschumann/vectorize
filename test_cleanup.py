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
            [(0, 0), (1, 1)],
            [(1, 1), (2, 2)]
        ]
        merged = merge_collinear(segments, merge_dist_tol=0.1, angle_tol=5.0)
        self.assert_segments_match(merged, [[(0, 0), (1, 1), (2, 2)]])

    def test_endpoint_distance_threshold(self):
        """Test case 2: Two segments with endpoints too far apart"""
        segments = [
            [(0, 0), (1, 1)],
            [(1.2, 1.2), (2, 2)]
        ]
        merged = merge_collinear(segments, merge_dist_tol=0.1, angle_tol=5.0)
        self.assert_segments_match(merged, [
            [(0, 0), (1, 1)],
            [(1.2, 1.2), (2, 2)]
        ])

    def test_angle_threshold(self):
        """Test case 3: Two segments at different angles"""
        segments = [
            [(0, 0), (1, 1)],
            [(1, 1), (2, 1)]  # 45 degrees different
        ]
        merged = merge_collinear(segments, merge_dist_tol=0.1, angle_tol=5.0)
        self.assert_segments_match(merged, segments)

    def test_closed_path_preservation(self):
        """Test case 4: Closed path should not merge with other segments"""
        segments = [
            [(0, 0), (1, 1), (1, 2), (0, 0)],  # closed path
            [(1, 1), (2, 2)]
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
            [(0, 0), (1, 1)],
            [(1, 1), (2, 2)],
            [(2, 2), (3, 3)]
        ]
        merged = merge_collinear(segments, merge_dist_tol=0.1, angle_tol=5.0)
        self.assert_segments_match(merged, [[(0, 0), (1, 1), (2, 2), (3, 3)]])

    def test_opposite_direction_merge(self):
        """Test case 6: Two segments in opposite directions should merge correctly"""
        segments = [
            [(0, 0), (1, 1)],
            [(2, 2), (1, 1)]
        ]
        merged = merge_collinear(segments, merge_dist_tol=0.1, angle_tol=5.0)
        self.assert_segments_match(merged, [[(0, 0), (1, 1), (2, 2)]])

    def test_edge_cases(self):
        """Test case 7-8: Empty input and single segment cases"""
        # Empty input
        self.assertEqual(merge_collinear([]), [])
        
        # Single segment
        segments = [[(0, 0), (1, 1)]]
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
        self.assertLess(end_time - start_time, 1.0)  # Should complete in under 1 second

if __name__ == '__main__':
    unittest.main(verbosity=2)
