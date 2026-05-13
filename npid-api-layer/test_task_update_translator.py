import unittest

from app.translators.legacy import LegacyTranslator


class TaskUpdateTranslatorTests(unittest.TestCase):
    def test_update_task_clears_completion_fields_and_only_changes_due_date(self):
        form_data = {
            "existingtask": "991",
            "tasktitle": "Call Attempt 1",
            "taskdescription": "Original description",
            "contact_task": "123",
            "athlete_main_id": "456",
            "duedate": "04/28/2026",
            "duetime": "09:00",
            "completedate": "04/28/2026",
            "completed_time": "10:15",
            "taskcompleted": "1",
        }

        updated = LegacyTranslator.apply_task_update(
            form_data=form_data,
            athlete_id="123",
            athlete_main_id="456",
            due_date="04/29/2026",
            due_time="11:30",
            checkbox_fields=["taskcompleted"],
        )

        self.assertEqual(updated["tasktitle"], "Call Attempt 1")
        self.assertEqual(updated["taskdescription"], "Original description")
        self.assertEqual(updated["duedate"], "04/29/2026")
        self.assertEqual(updated["duetime"], "11:30")
        self.assertEqual(updated["completedate"], "")
        self.assertEqual(updated["completed_time"], "")
        self.assertNotIn("taskcompleted", updated)

    def test_create_completed_task_sets_repeat_payload(self):
        form_data = {
            "_token": "abc123",
            "existingtask": "628893",
            "tasktitle": "",
            "taskdescription": "",
            "contact_task": "",
            "athlete_main_id": "",
            "duedate": "",
            "duetime": "",
            "completedate": "",
            "completed_time": "",
            "assignedto": "",
        }

        updated = LegacyTranslator.apply_completed_task_create(
            form_data=form_data,
            athlete_id="1490821",
            athlete_main_id="952646",
            task_title="REPEAT",
            description="REPEAT",
            due_date="05/13/2026",
            due_time="00:00",
            completed_date="05/13/2026",
            completed_time="13:40",
            assigned_to="1408164",
        )

        self.assertEqual(updated["existingtask"], "628893")
        self.assertEqual(updated["tasktitle"], "REPEAT")
        self.assertEqual(updated["taskdescription"], "REPEAT")
        self.assertEqual(updated["contact_task"], "1490821")
        self.assertEqual(updated["athlete_main_id"], "952646")
        self.assertEqual(updated["duedate"], "05/13/2026")
        self.assertEqual(updated["duetime"], "00:00")
        self.assertEqual(updated["completedate"], "05/13/2026")
        self.assertEqual(updated["completed_time"], "13:40")
        self.assertEqual(updated["assignedto"], "1408164")

    def test_create_task_popup_uses_adminathlete_contract(self):
        endpoint, params = LegacyTranslator.task_create_popup_to_legacy(
            adminathlete="1490821",
            athlete_main_id="952646",
        )

        self.assertEqual(endpoint, "/template/template/taskpopup")
        self.assertEqual(
            params,
            {
                "cal_date": "",
                "adminathlete": "1490821",
                "athlete_main_id": "952646",
            },
        )


if __name__ == "__main__":
    unittest.main()
