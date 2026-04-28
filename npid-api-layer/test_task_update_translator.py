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


if __name__ == "__main__":
    unittest.main()
