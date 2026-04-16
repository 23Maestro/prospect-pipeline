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
    ]

    jeffrey, luther, ryan = result["scouts"]
    assert jeffrey["slot_count"] == 1
    assert luther["slot_count"] == 3
    assert ryan["slot_count"] == 1

    assert jeffrey["slots"][0]["id"] == "1"
    assert luther["slots"][0]["id"] == "7-2026-04-13"
    assert luther["slots"][1]["id"] == "7-2026-04-15"
    assert luther["slots"][2]["id"] == "3"
    assert ryan["slots"][0]["id"] == "5"


if __name__ == "__main__":
    test_parse_head_scout_slots_response_filters_and_orders_slots()
    print("✅ Head scout slot parser test passed")
