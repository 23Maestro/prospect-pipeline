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
      {"id": 6, "start": "2026-04-16T20:00", "end": "2026-04-16T21:00", "user": "Logan Lord", "title": "OPEN", "openslot": "openslot"}
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
    ]

    jeffrey, luther, ryan, james = result["scouts"]
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
    assert jeffrey["slot_count"] == 1
    assert luther["slot_count"] == 3
    assert ryan["slot_count"] == 1
    assert james["slot_count"] == 0

    assert jeffrey["slots"][0]["id"] == "1"
    assert luther["slots"][0]["id"] == "7-2026-04-13"
    assert luther["slots"][1]["id"] == "7-2026-04-15"
    assert luther["slots"][2]["id"] == "3"
    assert ryan["slots"][0]["id"] == "5"


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


if __name__ == "__main__":
    test_parse_head_scout_slots_response_filters_and_orders_slots()
    test_parse_open_meetings_response_extracts_openeventid_and_start_time()
    print("✅ Head scout slot parser test passed")
