import unittest
from pathlib import Path

from app.translators.legacy import LegacyTranslator
from app.routers.scout import filter_scout_tasks_by_search


class TaskUpdateTranslatorTests(unittest.TestCase):
    def test_scout_router_preserves_datatable_pagination_when_searching(self):
        router_source = Path("app/routers/scout.py").read_text()

        self.assertIn("start=start,", router_source)
        self.assertIn("length=length,", router_source)
        self.assertNotIn("start=None if searchText else start", router_source)
        self.assertNotIn("length=None if searchText else length", router_source)

    def test_portal_tasks_search_forwards_laravel_datatable_search(self):
        endpoint, params = LegacyTranslator.portal_tasks_to_legacy(
            assigned_to="1408164",
            range_value="all",
            start=0,
            length=100,
            search_text="Avery Jones",
        )

        self.assertEqual(endpoint, "/tasks/taskslist")
        self.assertEqual(params["range"], "all")
        self.assertEqual(params["assignedto"], "1408164")
        self.assertEqual(params["start"], 0)
        self.assertEqual(params["length"], 100)
        self.assertEqual(params["search[value]"], "Avery Jones")

    def test_filter_scout_tasks_by_search_matches_task_fields_before_pagination(self):
        tasks = [
            {
                "athlete_name": "Avery Jones",
                "title": "Call Attempt 1",
                "description": "Football follow up",
                "high_school": "North High",
            },
            {
                "athlete_name": "Jamarcus Patterson",
                "title": "Call Attempt 2",
                "description": "Football family",
                "high_school": "East High",
            },
            {
                "athlete_name": "Marcus Garcia",
                "title": "Enrollment Follow Up",
                "description": "Baseball family",
                "high_school": "West High",
            },
            {
                "athlete_name": "Other Athlete",
                "title": "Call Attempt 2",
                "description": "Basketball",
                "high_school": "South High",
            },
        ]

        matches = filter_scout_tasks_by_search(tasks, "Marcus G")

        self.assertEqual(matches, [tasks[2]])

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

    def test_update_task_can_change_title_description_and_follow_up_date_without_completion(self):
        form_data = {
            "existingtask": "630353",
            "tasktitle": "Spoke to - Need to Follow Up",
            "taskdescription": "Original description",
            "contact_task": "1497543",
            "athlete_main_id": "953625",
            "contact": "",
            "duedate": "05/25/2026",
            "duetime": "10:00",
            "completedate": "05/25/2026",
            "completed_time": "10:30",
            "assignedto": "1408164",
            "taskcompleted": "1",
        }

        updated = LegacyTranslator.apply_task_update(
            form_data=form_data,
            athlete_id="1497543",
            athlete_main_id="953625",
            task_title="SCHEDULED FOLLOW-UP",
            description="Dad was busy running errands.",
            due_date="05/26/2026",
            due_time="14:04",
            checkbox_fields=["taskcompleted"],
        )

        self.assertEqual(updated["existingtask"], "630353")
        self.assertEqual(updated["tasktitle"], "SCHEDULED FOLLOW-UP")
        self.assertEqual(updated["taskdescription"], "Dad was busy running errands.")
        self.assertEqual(updated["duedate"], "05/26/2026")
        self.assertEqual(updated["duetime"], "14:04")
        self.assertEqual(updated["assignedto"], "1408164")
        self.assertEqual(updated["contact_task"], "1497543")
        self.assertEqual(updated["athlete_main_id"], "953625")
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
