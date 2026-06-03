import sys
import os

sys.path.append(os.getcwd())

from app.translators.legacy import LegacyTranslator
from app.models.schemas import MeetingSetSubmitRequest, RescheduleMeetingSubmitRequest


def test_parse_head_scout_slots_response_filters_and_orders_slots():
    payload = """
    [
      {"id": 1, "start": "2026-04-16T17:00", "end": "2026-04-16T18:00", "user": "Jeffrey Stein", "title": "OPEN", "openslot": "openslot"},
      {"id": 13, "start": "2026-04-16T17:30", "end": "2026-04-16T18:00", "user": "David Foley", "title": "OPEN", "openslot": "openslot"},
      {"id": 2, "start": "2026-04-16T18:00", "end": "2026-04-16T19:00", "user": "Jeffrey Stein", "title": "(NS) Noise", "openslot": "meetingset"},
      {"id": 3, "start": "2026-04-16T17:30", "end": "2026-04-16T18:00", "user": "Luther Winfield", "title": "OPEN", "openslot": "openslot"},
      {"id": 14, "start": "2026-04-16T18:30", "end": "2026-04-16T19:00", "user": "Nasir Adderley", "title": "OPEN", "openslot": "openslot"},
      {"id": 7, "start": "16:00", "end": "17:00", "user": "Luther Winfield", "title": "OPEN", "openslot": "openslot", "dow": "[1,3]"},
      {"id": 4, "start": "2026-04-16T16:30", "end": "2026-04-16T17:00", "user": "Luther Winfield", "title": "Follow Up", "openslot": ""},
      {"id": 5, "start": "2026-04-16T19:00", "end": "2026-04-16T20:00", "user": "Ryan Lietz", "title": "OPEN", "openslot": "openslot"},
      {"id": 6, "start": "2026-04-16T20:00", "end": "2026-04-16T21:00", "user": "Logan Lord", "title": "OPEN", "openslot": "openslot"},
      {"id": 12, "start": "2026-04-17T18:00", "end": "2026-04-17T19:00", "user": "Kenton Manis", "title": "OPEN", "openslot": "openslot"},
      {"id": 8, "start": "2026-04-20T17:00", "end": "2026-04-20T18:00", "user": "Ryan Lietz", "title": "OPEN", "openslot": "openslot"},
      {"id": 9, "start": "2026-04-12T17:00", "end": "2026-04-12T18:00", "user": "Ryan Lietz", "title": "OPEN", "openslot": "openslot"},
      {"id": 10, "start": "2026-04-16T17:00", "end": "2026-04-16T18:00", "user": "Jeffrey Stein", "title": "open", "openslot": "openslot"},
      {"id": 11, "start": "2026-04-16T17:00", "end": "2026-04-16T18:00", "user": "Jeffrey Stein", "title": "OPEN", "openslot": "openslot"}
    ]
    """

    result = LegacyTranslator.parse_head_scout_slots_response(
        raw_response=payload,
        week_start="2026-04-13",
        week_end="2026-04-20",
    )

    assert result["success"] is True
    assert result["timezone_label"] == "EST"
    assert [scout["scout_name"] for scout in result["scouts"]] == [
        "David Foley",
        "Jeffrey Stein",
        "Luther Winfield",
        "Nasir Adderley",
        "Ryan Lietz",
        "James Holcomb",
        "Logan Lord",
        "Kenton Manis",
    ]

    david, jeffrey, luther, nasir, ryan, james, logan, kenton = result["scouts"]
    assert david["calendar_owner_id"] == "GI4oO0m9knrHNq1"
    assert david["meeting_for"] == "1418020"
    assert david["city"] == "Winona"
    assert david["state"] == "MN"
    assert jeffrey["calendar_owner_id"] == "OrJsV8nhBouEzKY"
    assert jeffrey["meeting_for"] == "1418529"
    assert luther["calendar_owner_id"] == "bMBrA26OElRUwPs"
    assert luther["meeting_for"] == "370959"
    assert nasir["calendar_owner_id"] == "Ax8yvuUTdOzVHr7"
    assert nasir["meeting_for"] == "1462295"
    assert nasir["city"] == "Dallas"
    assert nasir["state"] == "TX"
    assert ryan["calendar_owner_id"] == "nhVvYOz8bAaL57c"
    assert ryan["meeting_for"] == "1354049"
    assert james["calendar_owner_id"] == "oDCcn1r7MGERdsb"
    assert james["meeting_for"] == "56"
    assert james["city"] == "Phoenix"
    assert james["state"] == "AZ"
    assert logan["calendar_owner_id"] == "d9UDl0bRSqQ1owt"
    assert logan["meeting_for"] == "2254"
    assert logan["city"] == "Chandler"
    assert logan["state"] == "AZ"
    assert kenton["calendar_owner_id"] == "A4H3xiZJdyrEh2X"
    assert kenton["meeting_for"] == "1486538"
    assert kenton["city"] == "Prosper"
    assert kenton["state"] == "TX"
    assert david["slot_count"] == 1
    assert jeffrey["slot_count"] == 1
    assert luther["slot_count"] == 1
    assert nasir["slot_count"] == 1
    assert ryan["slot_count"] == 1
    assert james["slot_count"] == 0
    assert logan["slot_count"] == 1
    assert kenton["slot_count"] == 1

    assert david["slots"][0]["id"] == "13"
    assert jeffrey["slots"][0]["id"] in {"1", "10", "11"}
    assert jeffrey["slots"][0]["start"] == "2026-04-16T17:00"
    assert luther["slots"][0]["id"] == "3"
    assert nasir["slots"][0]["id"] == "14"
    assert ryan["slots"][0]["id"] == "5"
    assert logan["slots"][0]["id"] == "6"
    assert kenton["slots"][0]["id"] == "12"


def test_head_scout_slots_request_preserves_selected_owner_ids_and_fields():
    endpoint, params = LegacyTranslator.head_scout_slots_to_legacy(
        start="2026-04-13",
        end="2026-04-20",
    )

    assert endpoint == "/template/calendarevents"
    assert params == [
        ("loginuser", "avdhyXjQ8bFweEf"),
        ("load_from_tasks_backup", ""),
        ("selectedowner[]", "GI4oO0m9knrHNq1"),
        ("selectedowner[]", "OrJsV8nhBouEzKY"),
        ("selectedowner[]", "bMBrA26OElRUwPs"),
        ("selectedowner[]", "Ax8yvuUTdOzVHr7"),
        ("selectedowner[]", "nhVvYOz8bAaL57c"),
        ("selectedowner[]", "oDCcn1r7MGERdsb"),
        ("selectedowner[]", "d9UDl0bRSqQ1owt"),
        ("selectedowner[]", "A4H3xiZJdyrEh2X"),
        ("selectedowner[]", "avdhyXjQ8bFweEf"),
        ("start", "2026-04-13"),
        ("end", "2026-04-20"),
    ]


def test_open_meetings_request_preserves_meetingfor_field_unchanged():
    endpoint, params = LegacyTranslator.open_meetings_to_legacy(meeting_for="1354049")

    assert endpoint == "/template/template/openmeetings"
    assert params == {"meetingfor": "1354049"}


def test_meeting_set_request_accepts_raycast_head_scout_context_fields():
    request = MeetingSetSubmitRequest(
        athlete_id="1490754",
        athlete_main_id="952580",
        meeting_name="Raul Agramonte Football 2027 FL",
        meeting_timezone="EST",
        assigned_to="1354049",
        open_event_id="588340",
        task_description="Main Number:\nOther Details:",
        start_time="15:00",
        meeting_for="1354049",
        meetingfor="1354049",
        calendar_owner_id="nhVvYOz8bAaL57c",
        booked_meeting_assigned_owner="Ryan Lietz",
    )

    assert request.meeting_for == "1354049"
    assert request.meetingfor == "1354049"
    assert request.calendar_owner_id == "nhVvYOz8bAaL57c"
    assert request.booked_meeting_assigned_owner == "Ryan Lietz"


def test_reschedule_meeting_request_uses_verified_legacy_endpoint_and_fields():
    request = RescheduleMeetingSubmitRequest(
        athlete_id="1491137",
        athlete_main_id="952958",
        meeting_name="Trindon Thompson Football 2029 GA",
        meeting_timezone="EST",
        assigned_to="2254",
        open_event_id="627030",
        task_description="Main Number:\nOther Details:",
        start_time="03:00",
        meeting_length="01:00",
    )

    endpoint, form_data = LegacyTranslator.reschedule_meeting_submit_to_legacy(request)

    assert endpoint == "/tasks/reschedulemeeting"
    assert form_data == {
        "keepasopenslot": "yes",
        "contact_task_main": "952958",
        "contact_task": "1491137",
        "existingtask": "",
        "tasktitle": "Trindon Thompson Football 2029 GA",
        "contact": "",
        "meetingtimezone": "EST",
        "assignedto": "2254",
        "openmeetings_list_length": "-1",
        "openeventid": "627030",
        "duedate": "",
        "starttime": "03:00",
        "meetinglength": "01:00",
        "taskdescription": "Main Number:\nOther Details:",
    }


def test_reschedule_meeting_template_uses_verified_legacy_endpoint():
    endpoint, params = LegacyTranslator.reschedule_meeting_template_to_legacy(
        adminathlete="1491137",
        athlete_main_id="952958",
    )

    assert endpoint == "/template/template/reschedulemeeting"
    assert params == {
        "cal_date": "",
        "cal_time": "",
        "adminathlete": "1491137",
        "athlete_main_id": "952958",
    }


def test_build_head_scout_schedule_from_open_meetings_uses_concrete_slots():
    config = {
        "scout_name": "Kenton Manis",
        "city": "Prosper",
        "state": "TX",
        "calendar_owner_id": "A4H3xiZJdyrEh2X",
        "meeting_for": "1486538",
    }
    open_meetings_result = {
        "success": True,
        "count": 3,
        "slots": [
            {
                "open_event_id": "624048",
                "date_time_label": "Sun 05/17/26 2:30 PM",
                "title": "OPEN",
                "assigned_owner": "Kenton Manis",
                "start_time": "14:30",
            },
            {
                "open_event_id": "624049",
                "date_time_label": "Sun 05/17/26 4:00 PM",
                "title": "OPEN",
                "assigned_owner": "Kenton Manis",
                "start_time": "16:00",
            },
            {
                "open_event_id": "624050",
                "date_time_label": "Mon 05/18/26 2:30 PM",
                "title": "OPEN",
                "assigned_owner": "Kenton Manis",
                "start_time": "14:30",
            },
        ],
    }

    result = LegacyTranslator.build_head_scout_schedule_from_open_meetings(
        config=config,
        open_meetings_result=open_meetings_result,
        week_start="2026-05-11",
        week_end="2026-05-18",
    )

    assert result["scout_name"] == "Kenton Manis"
    assert result["city"] == "Prosper"
    assert result["state"] == "TX"
    assert result["calendar_owner_id"] == "A4H3xiZJdyrEh2X"
    assert result["meeting_for"] == "1486538"
    assert result["slot_count"] == 2
    assert result["slots"] == [
        {
            "id": "624048",
            "start": "2026-05-17T14:30",
            "end": "2026-05-17T15:30",
            "scout_name": "Kenton Manis",
        },
        {
            "id": "624049",
            "start": "2026-05-17T16:00",
            "end": "2026-05-17T17:00",
            "scout_name": "Kenton Manis",
        },
    ]


def test_booked_meeting_lookup_request_preserves_calendar_access_fields():
    endpoint, params = LegacyTranslator.booked_meeting_to_legacy(
        calendar_owner_id="nhVvYOz8bAaL57c",
        start="2026-04-13",
        end="2026-04-20",
    )

    assert endpoint == "/template/calendarevents"
    assert params == [
        ("loginuser", "avdhyXjQ8bFweEf"),
        ("load_from_tasks_backup", ""),
        ("selectedowner[]", "nhVvYOz8bAaL57c"),
        ("selectedowner[]", "avdhyXjQ8bFweEf"),
        ("start", "2026-04-13"),
        ("end", "2026-04-20"),
    ]


def test_parse_head_scout_slots_response_uses_strict_monday_sunday_week_bounds():
    payload = """
    [
      {"id": 100, "start": "2026-04-26T19:00", "end": "2026-04-26T20:00", "user": "Ryan Lietz", "title": "OPEN", "openslot": "openslot"},
      {"id": 101, "start": "2026-04-27T18:00", "end": "2026-04-27T19:00", "user": "Ryan Lietz", "title": "OPEN", "openslot": "openslot"},
      {"id": 102, "start": "17:00", "end": "18:00", "user": "Ryan Lietz", "title": "OPEN", "openslot": "openslot", "dow": "[1,2,3,4,5]"}
    ]
    """

    current_week = LegacyTranslator.parse_head_scout_slots_response(
        raw_response=payload,
        week_start="2026-04-20",
        week_end="2026-04-27",
    )
    next_week = LegacyTranslator.parse_head_scout_slots_response(
        raw_response=payload,
        week_start="2026-04-27",
        week_end="2026-05-04",
    )

    current_ryan = next(scout for scout in current_week["scouts"] if scout["scout_name"] == "Ryan Lietz")
    next_ryan = next(scout for scout in next_week["scouts"] if scout["scout_name"] == "Ryan Lietz")

    assert [slot["id"] for slot in current_ryan["slots"]] == ["100"]
    assert [slot["id"] for slot in next_ryan["slots"]] == ["101"]


def test_parse_open_meetings_response_extracts_openeventid_and_start_time():
    payload = """
    <table id="openmeetings_list" class="table table-striped">
      <thead>
        <tr><th></th><th>Date Time</th><th>Title</th><th>Assigned Owner</th></tr>
      </thead>
      <tbody>
        <tr>
          <td><input type="radio" name="openeventid" value="586548"></td>
          <td>Sat 04/18/26 10:00 AM</td>
          <td>OPEN</td>
          <td>Ryan Lietz</td>
        </tr>
        <tr>
          <td><input type="radio" name="openeventid" value="587187"></td>
          <td>Sat 04/18/26 11:00 AM</td>
          <td>OPEN</td>
          <td>Ryan Lietz</td>
        </tr>
      </tbody>
    </table>
    """

    result = LegacyTranslator.parse_open_meetings_response(payload)

    assert result["success"] is True
    assert result["count"] == 2
    assert result["slots"][0]["open_event_id"] == "586548"
    assert result["slots"][0]["date_time_label"] == "Sat 04/18/26 10:00 AM"
    assert result["slots"][0]["assigned_owner"] == "Ryan Lietz"
    assert result["slots"][0]["start_time"] == "10:00"
    assert result["slots"][1]["open_event_id"] == "587187"
    assert result["slots"][1]["start_time"] == "11:00"


def test_parse_booked_meeting_response_returns_newest_match():
    payload = """
    [
      {"id": "100", "start": "2026-04-16T18:00", "end": "2026-04-16T19:00", "user": "Ryan Lietz", "title": "Victor Williams Football 2027 FL"},
      {"id": "200", "start": "2026-04-23T18:00", "end": "2026-04-23T19:00", "user": "Ryan Lietz", "title": "Victor Williams Football 2027 FL"},
      {"id": "300", "start": "2026-04-24T18:00", "end": "2026-04-24T19:00", "user": "Jeffrey Stein", "title": "Victor Williams Football 2027 FL"}
    ]
    """

    result = LegacyTranslator.parse_booked_meeting_response(
        raw_response=payload,
        title_query="Victor Williams Football 2027 FL",
        scout_name="Ryan Lietz",
    )

    assert result["success"] is True
    assert result["count"] == 2
    assert result["event"]["event_id"] == "200"
    assert result["event"]["start"] == "2026-04-23T18:00"
    assert [event["event_id"] for event in result["events"]] == ["200", "100"]


def test_parse_head_scout_booked_meetings_response_keeps_real_meetings_in_week():
    payload = """
    [
      {"id": "100", "start": "2026-04-21T18:00", "end": "2026-04-21T19:00", "user": "Ryan Lietz", "title": "Victor Williams Football 2028 TX", "openslot": "meetingset"},
      {"id": "101", "start": "2026-04-27T15:00", "end": "2026-04-27T16:00", "user": "Ryan Lietz", "title": "Outside Week Football 2027 MN", "openslot": "meetingset"},
      {"id": "102", "start": "2026-04-26T15:00", "end": "2026-04-26T16:00", "user": "Ryan Lietz", "title": "August Nyakeoga Football 2027 MN", "openslot": "meetingset"},
      {"id": "103", "start": "2026-04-24T18:00", "end": "2026-04-24T19:00", "user": "Ryan Lietz", "title": "OPEN", "openslot": "openslot"},
      {"id": "104", "start": "2026-04-24T18:00", "end": "2026-04-24T19:00", "user": "Logan Lord", "title": "Logan Lord Meeting Football 2027 FL", "openslot": "meetingset"}
    ]
    """

    result = LegacyTranslator.parse_head_scout_booked_meetings_response(
        raw_response=payload,
        week_start="2026-04-20",
        week_end="2026-04-27",
    )

    assert result["success"] is True
    assert result["count"] == 3
    assert [event["title"] for event in result["events"]] == [
        "Victor Williams Football 2028 TX",
        "Logan Lord Meeting Football 2027 FL",
        "August Nyakeoga Football 2027 MN",
    ]


def test_apply_booked_meeting_title_prefix_replaces_known_prefix():
    result = LegacyTranslator.apply_booked_meeting_title_prefix(
        "(RSP) Victor Williams Football 2027 FL",
        "(CF)",
    )

    assert result == "(CF) Victor Williams Football 2027 FL"


def test_apply_booked_meeting_title_prefix_preserves_unknown_prefix():
    result = LegacyTranslator.apply_booked_meeting_title_prefix(
        "(FU) Donzi Ojeikere Football 2028 TX",
        "(ACF)",
    )

    assert result == "(ACF) (FU) Donzi Ojeikere Football 2028 TX"


def test_parse_booked_meeting_popup_response_extracts_title_and_existingtask():
    payload = """
    <form method="post" id="editmeetingset">
      <input type="hidden" name="_token" value="token123">
      <input type="hidden" name="existingtask" value="586540">
      <input type="hidden" name="contact_task" value="1486258">
      <input type="text" name="tasktitle" value="(FU) Donzi Ojeikere Football 2028 TX">
      <select name="assignedto">
        <option value="nhVvYOz8bAaL57c" selected>Ryan Lietz</option>
      </select>
      <textarea name="taskdescription">Notes</textarea>
      <input type="submit" name="submit" value="Save">
    </form>
    """

    result = LegacyTranslator.parse_booked_meeting_popup_response(payload)

    assert result["success"] is True
    assert result["form_data"]["existingtask"] == "586540"
    assert result["form_data"]["tasktitle"] == "(FU) Donzi Ojeikere Football 2028 TX"
    assert result["form_data"]["assignedto"] == "nhVvYOz8bAaL57c"
    assert result["form_data"]["taskdescription"] == "Notes"


def test_apply_booked_meeting_description_update_preserves_title_and_sets_existingtask():
    result = LegacyTranslator.apply_booked_meeting_description_update(
        form_data={
            "tasktitle": "(CF) Victor Williams Football 2027 FL",
            "taskdescription": "Old notes",
            "existingtask": "",
            "assignedto": "nhVvYOz8bAaL57c",
        },
        event_id="586540",
        description="Updated notes",
    )

    assert result["tasktitle"] == "(CF) Victor Williams Football 2027 FL"
    assert result["taskdescription"] == "Updated notes"
    assert result["existingtask"] == "586540"
    assert result["assignedto"] == "nhVvYOz8bAaL57c"


if __name__ == "__main__":
    test_parse_head_scout_slots_response_filters_and_orders_slots()
    test_head_scout_slots_request_preserves_selected_owner_ids_and_fields()
    test_open_meetings_request_preserves_meetingfor_field_unchanged()
    test_booked_meeting_lookup_request_preserves_calendar_access_fields()
    test_parse_head_scout_slots_response_uses_strict_monday_sunday_week_bounds()
    test_parse_open_meetings_response_extracts_openeventid_and_start_time()
    test_parse_booked_meeting_response_returns_newest_match()
    test_parse_head_scout_booked_meetings_response_keeps_real_meetings_in_week()
    test_apply_booked_meeting_title_prefix_replaces_known_prefix()
    test_apply_booked_meeting_title_prefix_preserves_unknown_prefix()
    test_parse_booked_meeting_popup_response_extracts_title_and_existingtask()
    test_apply_booked_meeting_description_update_preserves_title_and_sets_existingtask()
    print("✅ Head scout slot parser test passed")
