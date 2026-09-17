"""Tests for retained SHA-256 value validation."""

import unittest

from ...src.canonical_values import validate_sha256


class TestSha256Validation(unittest.TestCase):
    def test_accepts_only_lowercase_sha256_text(self) -> None:
        digest = "a" * 64

        self.assertEqual(validate_sha256(digest, "digest"), digest)
        for value in ("A" * 64, "a" * 63, None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_sha256(value, "digest")


if __name__ == "__main__":
    unittest.main()
