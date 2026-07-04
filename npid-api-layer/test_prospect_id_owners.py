import sys
import os

sys.path.append(os.getcwd())

from app.domain.prospect_id_owners import (
    get_active_operator,
    get_head_scout_calendar_owner_ids,
    get_head_scout_config_for_legacy,
    get_owner_by_key,
    get_owner_config,
)


def test_shared_owner_config_loads_active_operator_and_tim_profile():
    config = get_owner_config()
    active_operator = get_active_operator()
    tim = get_owner_by_key("operator_secondary")

    assert config["activeOperatorKey"] == "operator_primary"
    assert config["headScoutCalendarAccessUserId"] == "avdhyXjQ8bFweEf"
    assert active_operator["personName"] == "Primary Operator"
    assert active_operator["assignedToLegacyUserId"] == "100001"
    assert tim["personName"] == "Secondary Operator"
    assert tim["dashboardTrackingEligible"] is False


def test_head_scout_config_preserves_legacy_shape_and_order():
    assert get_head_scout_config_for_legacy() == [
        {
            "scout_name": "Head Scout A",
            "city": "Winona",
            "state": "MN",
            "calendar_owner_id": "calendar_owner_a",
            "meeting_for": "1418020",
        },
        {
            "scout_name": "Head Scout B",
            "city": "Wexford",
            "state": "PA",
            "calendar_owner_id": "calendar_owner_b",
            "meeting_for": "200002",
        },
        {
            "scout_name": "Head Scout C",
            "city": "Columbia",
            "state": "SC",
            "calendar_owner_id": "calendar_owner_c",
            "meeting_for": "200003",
        },
        {
            "scout_name": "Head Scout H",
            "city": "Dallas",
            "state": "TX",
            "calendar_owner_id": "calendar_owner_h",
            "meeting_for": "200008",
        },
        {
            "scout_name": "Head Scout D",
            "city": "Gilbert",
            "state": "AZ",
            "calendar_owner_id": "calendar_owner_d",
            "meeting_for": "200004",
        },
        {
            "scout_name": "Head Scout E",
            "city": "Phoenix",
            "state": "AZ",
            "calendar_owner_id": "calendar_owner_e",
            "meeting_for": "56",
        },
        {
            "scout_name": "Head Scout F",
            "city": "Chandler",
            "state": "AZ",
            "calendar_owner_id": "calendar_owner_f",
            "meeting_for": "200006",
        },
        {
            "scout_name": "Head Scout G",
            "city": "Prosper",
            "state": "TX",
            "calendar_owner_id": "calendar_owner_g",
            "meeting_for": "200007",
        },
    ]


def test_head_scout_calendar_owner_ids_match_current_legacy_behavior():
    assert get_head_scout_calendar_owner_ids() == [
        "calendar_owner_a",
        "calendar_owner_b",
        "calendar_owner_c",
        "calendar_owner_h",
        "calendar_owner_d",
        "calendar_owner_e",
        "calendar_owner_f",
        "calendar_owner_g",
    ]


if __name__ == "__main__":
    test_shared_owner_config_loads_active_operator_and_tim_profile()
    test_head_scout_config_preserves_legacy_shape_and_order()
    test_head_scout_calendar_owner_ids_match_current_legacy_behavior()
    print("Prospect ID owner config tests passed")
