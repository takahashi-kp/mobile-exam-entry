import unittest

from server import parse_measurement_text


class VisionMeasurementParsingTests(unittest.TestCase):
    def test_units_and_decimals(self):
        self.assertEqual(
            parse_measurement_text("170.0 cm\n66.5 kg"),
            {"height": "170.0", "weight": "66.5"},
        )

    def test_full_width_and_missing_decimal(self):
        self.assertEqual(
            parse_measurement_text("１７００ｃｍ\n６６５ｋｇ"),
            {"height": "170.0", "weight": "66.5"},
        )

    def test_common_character_substitutions(self):
        self.assertEqual(
            parse_measurement_text("I70.O cm\n66.5 k9"),
            {"height": "170.0", "weight": "66.5"},
        )

    def test_spaces_between_display_digits(self):
        self.assertEqual(
            parse_measurement_text("1 7 0 . 0 cm\n6 6 . 5 kg"),
            {"height": "170.0", "weight": "66.5"},
        )

    def test_rejects_incomplete_result(self):
        self.assertIsNone(parse_measurement_text("170.0 cm"))


if __name__ == "__main__":
    unittest.main()
