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
        guidance = client.get("/guidance.js")

        self.assertEqual(index.status_code, 200)
        self.assertIn(b"app.js?v=20260723-03", index.data)
        self.assertIn(b'id="appToast"', index.data)
        self.assertIn(b'id="downloadScheduleFormat"', index.data)
        self.assertIn(b'id="showArchivedSchedules"', index.data)
        self.assertIn(b'id="editPatientIdentity"', index.data)
        self.assertIn(b'id="patientAgeDisplay"', index.data)
        self.assertIn("予定日".encode(), index.data)
        self.assertIn('name="塵肺"'.encode(), index.data)
        self.assertIn('name="アスベスト"'.encode(), index.data)
        self.assertIn('data-xray-subgroup="chest"'.encode(), index.data)
        self.assertIn('data-xray-subgroup="stomach"'.encode(), index.data)
        self.assertIn('name="胸部X線_自由入力"'.encode(), index.data)
        self.assertIn('name="胃部X線_自由入力"'.encode(), index.data)
        self.assertIn("顧客名".encode(), index.data)
        self.assertEqual(script.status_code, 200)
        self.assertIn(b"syncSchemaV2Reseeded", script.data)
        self.assertIn(b"isWindowsDevice", script.data)
        self.assertIn(b"document.body.appendChild(link)", script.data)
        self.assertIn(b"cascadeScheduleGroupName", script.data)
        self.assertIn(b"archiveScheduleGroup", script.data)
        self.assertIn(b"restoreScheduleGroup", script.data)
        self.assertIn(b"setupXraySubgroups", script.data)
        self.assertIn("胸部連名簿を作成しますか？".encode(), script.data)
        self.assertIn("胃部連名簿を作成しますか？".encode(), script.data)
        self.assertEqual(guidance.status_code, 200)
        self.assertIn(b"evaluateGuidanceAge", guidance.data)
        index.close()
        script.close()
        guidance.close()

    def test_roster_export_endpoint_returns_xlsx(self):
        response = app.test_client().post(
            "/api/roster-export",
            json={
                "kind": "chest",
                "customerName": "テスト顧客",
                "examDate": "2026-07-14",
                "rows": [{"nameKana": "ヤマダ タロウ", "sex": "男性", "age": 52, "filmNumber": "00123", "asbestos": True}],
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        self.assertGreater(len(response.data), 1000)
        response.close()

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

    def test_empty_customer_name_removes_previous_name(self):
        existing = {"entityType": "schedule_group", "customerName": "旧顧客名"}
        incoming = {"entityType": "schedule_group", "customerName": ""}

        merged = merge_payload(existing, incoming)

        self.assertEqual(merged["customerName"], "")

    def test_empty_scheduled_date_removes_previous_date(self):
        existing = {"entityType": "schedule_group", "scheduledDate": "2026-07-15"}
        incoming = {"entityType": "schedule_group", "scheduledDate": ""}

        merged = merge_payload(existing, incoming)

        self.assertEqual(merged["scheduledDate"], "")

    def test_false_checkbox_value_clears_previous_check(self):
        existing = {"entityType": "exam_group_value", "values": {"塵肺": "該当"}}
        incoming = {"entityType": "exam_group_value", "values": {"塵肺": False}}

        merged = merge_payload(existing, incoming)

        self.assertIs(merged["values"]["塵肺"], False)

    def test_old_offline_group_update_does_not_remove_archive(self):
        existing = {"entityType": "schedule_group", "name": "予定", "archivedAt": "2026-07-16T10:00:00Z"}
        incoming = {"entityType": "schedule_group", "name": "予定"}

        merged = merge_payload(existing, incoming)

        self.assertEqual(merged["archivedAt"], "2026-07-16T10:00:00Z")

    def test_archived_group_can_be_restored(self):
        existing = {"entityType": "schedule_group", "archivedAt": "2026-07-16T10:00:00Z"}
        incoming = {"entityType": "schedule_group", "archivedAt": ""}

        merged = merge_payload(existing, incoming)

        self.assertEqual(merged["archivedAt"], "")


if __name__ == "__main__":
    unittest.main()
