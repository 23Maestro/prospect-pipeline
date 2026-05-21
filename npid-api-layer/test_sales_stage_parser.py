import unittest

from app.translators.legacy import LegacyTranslator


class SalesStageParserTests(unittest.TestCase):
    def test_parses_new_meeting_result_dropdown(self):
        html = """
        <html>
          <body>
            <select name="sales_stage">
              <option value="">Select</option>
              <option value="meeting_follow_up">Actual Meeting - Follow Up</option>
              <option value="close_lost">Actual Meeting - Close Lost</option>
              <option value="close_won">Actual Meeting - Close Won</option>
              <option value="res_pending">Meeting Result - Res. Pending</option>
              <option value="rescheduled">Meeting Result - Rescheduled</option>
              <option value="canceled">Meeting Result - Canceled</option>
              <option value="no_show" selected>Meeting Result - No Show</option>
            </select>
          </body>
        </html>
        """

        result = LegacyTranslator.parse_sales_stage_options_response(html)

        self.assertTrue(result["success"])
        self.assertEqual(result["count"], 7)
        self.assertEqual(result["selected_label"], "Meeting Result - No Show")
        self.assertEqual(result["selected_value"], "no_show")

    def test_parses_plain_text_selected_stage(self):
        html = "<html><body>Meeting Result - No Show</body></html>"

        result = LegacyTranslator.parse_sales_stage_options_response(html)

        self.assertTrue(result["success"])
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["selected_label"], "Meeting Result - No Show")
        self.assertEqual(result["selected_value"], "Meeting Result - No Show")
        self.assertEqual(result["options"][0]["selected"], True)

    def test_parses_plain_text_meeting_set_rescheduled_stage(self):
        html = "<html><body>Meeting Set - Rescheduled</body></html>"

        result = LegacyTranslator.parse_sales_stage_options_response(html)

        self.assertTrue(result["success"])
        self.assertEqual(result["selected_label"], "Meeting Set - Rescheduled")
        self.assertEqual(result["selected_value"], "Meeting Set - Rescheduled")

    def test_parses_spoke_to_need_follow_up_label(self):
        html = """
        <html>
          <body>
            <select name="sales_stage">
              <option value="spoke_follow_up" selected>Spoke to - I Need To Follow Up</option>
            </select>
          </body>
        </html>
        """

        result = LegacyTranslator.parse_sales_stage_options_response(html)

        self.assertTrue(result["success"])
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["selected_label"], "Spoke to - I Need To Follow Up")
        self.assertEqual(result["selected_value"], "spoke_follow_up")

    def test_sales_stage_update_canonicalizes_follow_up_alias(self):
        for stage in (
            "Spoke to - Follow Up",
            "Spoke To - I Need To Follow Up",
            "Spoke to - I need to follow up",
        ):
            with self.subTest(stage=stage):
                endpoint, data = LegacyTranslator.sales_stage_update_to_legacy(
                    athlete_main_id="main-1",
                    athlete_id="athlete-1",
                    stage=stage,
                )

                self.assertEqual(endpoint, "/tasks/salesstage")
                self.assertEqual(data["athlete_main_id"], "main-1")
                self.assertEqual(data["athlete_id"], "athlete-1")
                self.assertEqual(data["stage"], "Spoke to - I Need To Follow Up")

    def test_sales_stage_compare_matches_case_variant(self):
        self.assertTrue(
            LegacyTranslator.sales_stage_labels_match(
                "Spoke to - I Need To Follow Up",
                "Spoke to - I need to follow up",
            )
        )

    def test_sales_stage_compare_matches_rescheduled_legacy_aliases(self):
        for selected in ("Rescheduled", "Meeting Set - Rescheduled"):
            with self.subTest(selected=selected):
                self.assertTrue(
                    LegacyTranslator.sales_stage_labels_match(
                        selected,
                        "Meeting Result - Rescheduled",
                    )
                )

    def test_sales_stage_update_accepts_new_spoke_to_labels(self):
        for stage in ("Spoke to - Athlete, not Parent", "Spoke to - Too Young"):
            with self.subTest(stage=stage):
                endpoint, data = LegacyTranslator.sales_stage_update_to_legacy(
                    athlete_main_id="main-1",
                    athlete_id="athlete-1",
                    stage=stage,
                )

                self.assertEqual(endpoint, "/tasks/salesstage")
                self.assertEqual(data["stage"], stage)

    def test_parses_new_spoke_to_plain_text_stages(self):
        for stage in ("Spoke to - Athlete, not Parent", "Spoke to - Too Young"):
            with self.subTest(stage=stage):
                result = LegacyTranslator.parse_sales_stage_options_response(f"<html><body>{stage}</body></html>")

                self.assertTrue(result["success"])
                self.assertEqual(result["count"], 1)
                self.assertEqual(result["selected_label"], stage)
                self.assertEqual(result["selected_value"], stage)


if __name__ == "__main__":
    unittest.main()
