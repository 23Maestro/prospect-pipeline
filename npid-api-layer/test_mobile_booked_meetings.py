from datetime import datetime
import os
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent))

from app.routers.mobile import (
    build_mobile_set_meetings_response,
    is_actual_set_meeting_event,
    is_meeting_visible_until_end,
    is_visible_set_meeting_event,
    pick_confirmation_task,
)


def test_mobile_set_meeting_filter_keeps_active_confirmation_prefixes():
    assert is_actual_set_meeting_event({"title": "(ACF) Matthew Lindsey Football 2027 NV"})
    assert is_actual_set_meeting_event({"title": "(ACF*2) Ancel Bynaum Jr Football 2029 TX"})
    assert is_actual_set_meeting_event({"title": "(CF) Messiah Cummings Football 2029 KY"})


def test_mobile_set_meeting_filter_hides_terminal_or_follow_up_prefixes():
    assert not is_actual_set_meeting_event({"title": "Follow Up - Poppy Kingan Women's Soccer 2028"})
    assert not is_actual_set_meeting_event({"title": "(FU) Messiah Cummings Football 2029 KY"})
    assert not is_actual_set_meeting_event({"title": "(RSP) Jordan Niles Men's Basketball 2026 NC"})
    assert not is_actual_set_meeting_event({"title": "(CAN) Levi Childers Football 2026 CA"})
    assert not is_actual_set_meeting_event({"title": "(NS) Kaleb Rivera Football 2029 PA"})
    assert not is_actual_set_meeting_event({"title": "(CL) Example Athlete Football 2029 PA"})


def test_mobile_visibility_uses_meeting_end_time_not_start_time():
    now = datetime.fromisoformat("2026-05-02T17:30:00-04:00")

    assert is_meeting_visible_until_end(
        {"start": "2026-05-02T17:00", "end": "2026-05-02T18:00"},
        now,
    )
    assert not is_meeting_visible_until_end(
        {"start": "2026-05-02T16:00", "end": "2026-05-02T17:00"},
        now,
    )


def test_mobile_visible_set_meeting_combines_prefix_and_end_time():
    now = datetime.fromisoformat("2026-05-02T17:30:00-04:00")

    assert is_visible_set_meeting_event(
        {"title": "(ACF) Matthew Lindsey Football 2027 NV", "end": "2026-05-02T18:00"},
        now,
    )
    assert not is_visible_set_meeting_event(
        {"title": "(FU) Matthew Lindsey Football 2027 NV", "end": "2026-05-02T18:00"},
        now,
    )
    assert not is_visible_set_meeting_event(
        {"title": "(ACF) Matthew Lindsey Football 2027 NV", "end": "2026-05-02T17:00"},
        now,
    )


def test_completed_confirmation_task_can_still_provide_mobile_context():
    selected = pick_confirmation_task(
        [
            {
                "title": "Confirmation Call",
                "assigned_owner": "Jerami Singleton",
                "completion_date": "Sat 05/02/26 10:01 AM",
                "due_date": "Sat 05/02/26 09:00 AM",
                "task_id": "626239",
            }
        ]
    )

    assert selected is not None
    assert selected["task_id"] == "626239"


def test_mobile_set_meetings_response_uses_view_set_meetings_contract_without_end_time_filter():
    payload = build_mobile_set_meetings_response(
        calendar_result={
            "success": True,
            "week_start": "2026-04-27",
            "week_end": "2026-05-04",
            "count": 3,
            "events": [
                {
                    "event_id": "evt-ended",
                    "title": "(ACF) Matthew Lindsey Football 2027 NV",
                    "assigned_owner": "Ryan Lietz",
                    "start": "2026-04-28T19:00:00-04:00",
                    "end": "2026-04-28T20:00:00-04:00",
                    "date_time_label": "Tue 04/28/26 7:00 PM - 8:00 PM",
                },
                {
                    "event_id": "evt-other-owner",
                    "title": "(CF) Other Athlete Football 2027 NV",
                    "assigned_owner": "Ryan Lietz",
                    "start": "2026-04-29T19:00:00-04:00",
                    "end": "2026-04-29T20:00:00-04:00",
                    "date_time_label": "Wed 04/29/26 7:00 PM - 8:00 PM",
                },
                {
                    "event_id": "evt-follow-up",
                    "title": "(FU) Matthew Lindsey Football 2027 NV",
                    "assigned_owner": "Ryan Lietz",
                    "start": "2026-04-30T19:00:00-04:00",
                    "end": "2026-04-30T20:00:00-04:00",
                    "date_time_label": "Thu 04/30/26 7:00 PM - 8:00 PM",
                },
            ],
        },
        tasks=[
            {
                "task_id": "626239",
                "athlete_id": "1491000",
                "athlete_main_id": "952900",
                "athlete_name": "Matthew Lindsey",
                "assigned_owner": "Jerami Singleton",
                "title": "Confirmation Call",
                "description": "Confirm the meeting set",
                "completion_date": "",
                "due_date": "2026-04-28T09:00:00-04:00",
            },
            {
                "task_id": "626240",
                "athlete_id": "1491001",
                "athlete_main_id": "952901",
                "athlete_name": "Other Athlete",
                "assigned_owner": "Tim Risner",
                "title": "Confirmation Call",
                "description": "Confirm the meeting set",
                "completion_date": "",
                "due_date": "2026-04-29T09:00:00-04:00",
            },
        ],
    )

    assert payload["success"] is True
    assert payload["raw_booked_count"] == 3
    assert payload["count"] == 1
    assert payload["events"][0]["event_id"] == "evt-ended"
    assert payload["events"][0]["athlete_name"] == "Matthew Lindsey"
    assert payload["events"][0]["operator_status"] == "active_meeting_queue"
    assert payload["events"][0]["confirmation_recipient"] is None
