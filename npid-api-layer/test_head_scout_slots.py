import sys
import os

sys.path.append(os.getcwd())

from app.translators.legacy import LegacyTranslator


def test_parse_head_scout_slots_response_filters_and_orders_slots():
    payload = """
    [
      {"id": 1, "start": "2026-04-16T17:00", "end": "2026-04-16T18:00", "user": "Jeffrey Stein", "title": "OPEN", "openslot": "openslot"},
      {"id": 2, "start": "2026-04-16T18:00", "end": "2026-04-16T19:00", "user": "Jeffrey Stein", "title": "(NS) Noise", "openslot": "meetingset"},
      {"id": 3, "start": "2026-04-16T17:30", "end": "2026-04-16T18:00", "user": "Luther Winfield", "title": "OPEN", "openslot": "openslot"},
      {"id": 7, "start": "16:00", "end": "17:00", "user": "Luther Winfield", "title": "OPEN", "openslot": "openslot", "dow": "[1,3]"},
      {"id": 4, "start": "2026-04-16T16:30", "end": "2026-04-16T17:00", "user": "Luther Winfield", "title": "Follow Up", "openslot": ""},
      {"id": 5, "start": "2026-04-16T19:00", "end": "2026-04-16T20:00", "user": "Ryan Lietz", "title": "OPEN", "openslot": "openslot"},
      {"id": 6, "start": "17:00", "end": "17:30", "user": "Logan Lord", "title": "Open for Interview", "openslot": "", "dow": "[1,3,4,5]"},
      {"id": 12, "start": "09:00", "end": "10:00", "user": "Kenton Manis", "title": "OPEN", "openslot": "openslot", "dow": "[6]"},
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
        "Jeffrey Stein",
        "Luther Winfield",
        "Ryan Lietz",
        "James Holcomb",
        "Logan Lord",
        "Kenton Manis",
    ]

    jeffrey, luther, ryan, james, logan, kenton = result["scouts"]
    assert jeffrey["calendar_owner_id"] == "OrJsV8nhBouEzKY"
    assert jeffrey["meeting_for"] == "1418529"
    assert luther["calendar_owner_id"] == "bMBrA26OElRUwPs"
    assert luther["meeting_for"] == "370959"
    assert ryan["calendar_owner_id"] == "nhVvYOz8bAaL57c"
    assert ryan["meeting_for"] == "1354049"
    assert james["calendar_owner_id"] == "56"
    assert james["meeting_for"] == "56"
    assert james["city"] == "Phoenix"
    assert james["state"] == "AZ"
    assert logan["calendar_owner_id"] == "2254"
    assert logan["meeting_for"] == "2254"
    assert logan["city"] == "Chandler"
    assert logan["state"] == "AZ"
    assert kenton["calendar_owner_id"] == "1486538"
    assert kenton["meeting_for"] == "1486538"
    assert kenton["city"] == "Prosper"
    assert kenton["state"] == "TX"
    assert jeffrey["slot_count"] == 1
    assert luther["slot_count"] == 3
    assert ryan["slot_count"] == 1
    assert james["slot_count"] == 0
    assert logan["slot_count"] == 4
    assert kenton["slot_count"] == 1

    assert jeffrey["slots"][0]["id"] in {"1", "10", "11"}
    assert jeffrey["slots"][0]["start"] == "2026-04-16T17:00"
    assert luther["slots"][0]["id"] == "7:2026-04-13"
    assert ryan["slots"][0]["id"] == "5"
    assert logan["slots"][0]["id"] == "6:2026-04-13"
    assert logan["slots"][0]["start"] == "2026-04-13T17:00"
    assert kenton["slots"][0]["id"] == "12:2026-04-18"
    assert kenton["slots"][0]["start"] == "2026-04-18T09:00"


def test_head_scout_slots_request_preserves_selected_owner_ids_and_fields():
    endpoint, params = LegacyTranslator.head_scout_slots_to_legacy(
        start="2026-04-13",
        end="2026-04-20",
    )

    assert endpoint == "/template/calendarevents"
    assert params == [
        ("loginuser", "avdhyXjQ8bFweEf"),
        ("load_from_tasks_backup", ""),
        ("selectedowner[]", "OrJsV8nhBouEzKY"),
        ("selectedowner[]", "bMBrA26OElRUwPs"),
        ("selectedowner[]", "nhVvYOz8bAaL57c"),
        ("selectedowner[]", "56"),
        ("selectedowner[]", "2254"),
        ("selectedowner[]", "1486538"),
        ("selectedowner[]", "avdhyXjQ8bFweEf"),
        ("start", "2026-04-13"),
        ("end", "2026-04-20"),
    ]


def test_open_meetings_request_preserves_meetingfor_field_unchanged():
    endpoint, params = LegacyTranslator.open_meetings_to_legacy(meeting_for="1354049")

    assert endpoint == "/template/template/openmeetings"
    assert params == {"meetingfor": "1354049"}


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

    assert [slot["id"] for slot in current_ryan["slots"]] == [
        "102:2026-04-20",
        "102:2026-04-21",
        "102:2026-04-22",
        "102:2026-04-23",
        "102:2026-04-24",
        "100",
    ]
    assert [slot["id"] for slot in next_ryan["slots"]] == [
        "102:2026-04-27",
        "101",
        "102:2026-04-28",
        "102:2026-04-29",
        "102:2026-04-30",
        "102:2026-05-01",
    ]


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
