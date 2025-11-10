import unittest
import numpy as np
from vectorize import merge_collinear

class TestVectorize(unittest.TestCase):
    def assert_segments_match(self, actual_segments, expected_segments):
        """Helper to compare sets of segments, accounting for reversed segments and order"""
        self.assertEqual(len(actual_segments), len(expected_segments), 
                        "Number of segments doesn't match")
        
        # Convert segments to tuples for comparison
        actual = [tuple(map(tuple, seg)) for seg in actual_segments]
        expected = [tuple(map(tuple, seg)) for seg in expected_segments]
        
        # For each expected segment, try to find a matching actual segment
        for e in expected:
            # Try both forward and reversed
            e_rev = tuple(reversed(e))
            found = False
            for a in actual:
                if a == e or a == e_rev:
                    found = True
                    break
            self.assertTrue(found, f"No match found for expected segment {e}")

    def test_merge_collinear(self):
        # Test case 1: Two collinear segments that should merge
        segments = [
            [(0, 0), (1, 1)],
            [(1, 1), (2, 2)]
        ]
        merged = merge_collinear(segments, merge_dist_tol=0.1, angle_tol=5.0)
        self.assert_segments_match(merged, [[(0, 0), (1, 1), (2, 2)]])

        # Test case 2: Two segments with endpoints too far apart
        segments = [
            [(0, 0), (1, 1)],
            [(1.2, 1.2), (2, 2)]
        ]
        merged = merge_collinear(segments, merge_dist_tol=0.1, angle_tol=5.0)
        self.assert_segments_match(merged, [
            [(0, 0), (1, 1)],
            [(1.2, 1.2), (2, 2)]
        ])

        # Test case 3: Two segments at different angles
        segments = [
            [(0, 0), (1, 1)],
            [(1, 1), (2, 1)]  # 45 degrees different
        ]
        merged = merge_collinear(segments, merge_dist_tol=0.1, angle_tol=5.0)
        self.assert_segments_match(merged, segments)

        # Test case 4: Closed path should not merge
        segments = [
            [(0, 0), (1, 1), (0, 0)],  # closed path
            [(1, 1), (2, 2)]
        ]
        merged = merge_collinear(segments, merge_dist_tol=0.1, angle_tol=5.0)
        self.assert_segments_match(merged, segments)

        # Test case 5: Three collinear segments
        segments = [
            [(0, 0), (1, 1)],
            [(1, 1), (2, 2)],
            [(2, 2), (3, 3)]
        ]
        merged = merge_collinear(segments, merge_dist_tol=0.1, angle_tol=5.0)
        self.assert_segments_match(merged, [[(0, 0), (1, 1), (2, 2), (3, 3)]])

        # Test case 6: Two segments in opposite directions
        segments = [
            [(0, 0), (1, 1)],
            [(2, 2), (1, 1)]
        ]
        merged = merge_collinear(segments, merge_dist_tol=0.1, angle_tol=5.0)
        self.assert_segments_match(merged, [[(0, 0), (1, 1), (2, 2)]])

        # Test case 7: Empty input
        self.assertEqual(merge_collinear([]), [])

        # Test case 8: Single segment
        segments = [[(0, 0), (1, 1)]]
        merged = merge_collinear(segments, merge_dist_tol=0.1, angle_tol=5.0)
        self.assert_segments_match(merged, segments)

if __name__ == '__main__':
    unittest.main()
