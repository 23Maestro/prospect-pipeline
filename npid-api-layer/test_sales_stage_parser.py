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


if __name__ == "__main__":
    unittest.main()
