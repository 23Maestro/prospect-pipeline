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
    tim = get_owner_by_key("tim_risner")

    assert config["activeOperatorKey"] == "jerami_singleton"
    assert config["headScoutCalendarAccessUserId"] == "avdhyXjQ8bFweEf"
    assert active_operator["personName"] == "Jerami Singleton"
    assert active_operator["assignedToLegacyUserId"] == "1408164"
    assert tim["personName"] == "Tim Risner"
    assert tim["dashboardTrackingEligible"] is False


def test_head_scout_config_preserves_legacy_shape_and_order():
    assert get_head_scout_config_for_legacy() == [
        {
            "scout_name": "David Foley",
            "city": "Winona",
            "state": "MN",
            "calendar_owner_id": "GI4oO0m9knrHNq1",
            "meeting_for": "1418020",
        },
        {
            "scout_name": "Jeffrey Stein",
            "city": "Wexford",
            "state": "PA",
            "calendar_owner_id": "OrJsV8nhBouEzKY",
            "meeting_for": "1418529",
        },
        {
            "scout_name": "Luther Winfield",
            "city": "Columbia",
            "state": "SC",
            "calendar_owner_id": "bMBrA26OElRUwPs",
            "meeting_for": "370959",
        },
        {
            "scout_name": "Nasir Adderley",
            "city": "Dallas",
            "state": "TX",
            "calendar_owner_id": "Ax8yvuUTdOzVHr7",
            "meeting_for": "1462295",
        },
        {
            "scout_name": "Ryan Lietz",
            "city": "Gilbert",
            "state": "AZ",
            "calendar_owner_id": "nhVvYOz8bAaL57c",
            "meeting_for": "1354049",
        },
        {
            "scout_name": "James Holcomb",
            "city": "Phoenix",
            "state": "AZ",
            "calendar_owner_id": "oDCcn1r7MGERdsb",
            "meeting_for": "56",
        },
        {
            "scout_name": "Logan Lord",
            "city": "Chandler",
            "state": "AZ",
            "calendar_owner_id": "d9UDl0bRSqQ1owt",
            "meeting_for": "2254",
        },
        {
            "scout_name": "Kenton Manis",
            "city": "Prosper",
            "state": "TX",
            "calendar_owner_id": "A4H3xiZJdyrEh2X",
            "meeting_for": "1486538",
        },
    ]


def test_head_scout_calendar_owner_ids_match_current_legacy_behavior():
    assert get_head_scout_calendar_owner_ids() == [
        "GI4oO0m9knrHNq1",
        "OrJsV8nhBouEzKY",
        "bMBrA26OElRUwPs",
        "Ax8yvuUTdOzVHr7",
        "nhVvYOz8bAaL57c",
        "oDCcn1r7MGERdsb",
        "d9UDl0bRSqQ1owt",
        "A4H3xiZJdyrEh2X",
    ]


if __name__ == "__main__":
    test_shared_owner_config_loads_active_operator_and_tim_profile()
    test_head_scout_config_preserves_legacy_shape_and_order()
    test_head_scout_calendar_owner_ids_match_current_legacy_behavior()
    print("Prospect ID owner config tests passed")
