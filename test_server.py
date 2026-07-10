import unittest

from server import app, merge_payload


class MergePayloadTests(unittest.TestCase):
    def test_health_reports_sync_schema(self):
        response = app.test_client().get("/healthz")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["syncSchema"], 2)

    def test_frontend_and_versioned_script_are_served(self):
        client = app.test_client()

        index = client.get("/")
        script = client.get("/app.js")

        self.assertEqual(index.status_code, 200)
        self.assertIn(b"app.js?v=20260710-01", index.data)
        self.assertEqual(script.status_code, 200)
        self.assertIn(b"syncSchemaV2Reseeded", script.data)
        index.close()
        script.close()

    def test_different_exam_fields_are_combined(self):
        existing = {"entityType": "exam_group_value", "values": {"身長": "170.0", "体重": ""}}
        incoming = {"entityType": "exam_group_value", "values": {"身長": "", "体重": "65.0"}}

        merged = merge_payload(existing, incoming)

        self.assertEqual(merged["values"]["身長"], "170.0")
        self.assertEqual(merged["values"]["体重"], "65.0")

    def test_empty_offline_value_does_not_erase_measurement(self):
        existing = {"values": {"腹囲": "82.5"}}
        incoming = {"values": {"腹囲": ""}}

        merged = merge_payload(existing, incoming)

        self.assertEqual(merged["values"]["腹囲"], "82.5")

    def test_new_non_empty_measurement_updates_same_field(self):
        existing = {"values": {"1回目最高血圧": "130"}}
        incoming = {"values": {"1回目最高血圧": "128"}}

        merged = merge_payload(existing, incoming)

        self.assertEqual(merged["values"]["1回目最高血圧"], "128")


if __name__ == "__main__":
    unittest.main()
