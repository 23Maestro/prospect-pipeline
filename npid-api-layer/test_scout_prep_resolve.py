import sys
import unittest
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent))

from app.translators.legacy import LegacyTranslator


class ScoutPrepResolveTests(unittest.TestCase):
    def test_basic_profile_parser_reads_sport_without_jersey(self):
        html = """
        <html>
          <body>
            <input name="first_name" value="Richard" />
            <input name="last_name" value="Hayes" />
            <select name="sport">
              <option>Sport</option>
              <option selected>Baseball</option>
            </select>
            <input name="grad_year" value="2027" />
            <div><span>Jersey #</span><span>12</span></div>
          </body>
        </html>
        """

        parsed = LegacyTranslator.parse_athlete_profile_data_basic(html)

        self.assertEqual(parsed["name"], "Richard Hayes")
        self.assertEqual(parsed["sport"], "Baseball")
        self.assertEqual(parsed["grad_year"], "2027")
        self.assertNotIn("jersey_number", parsed)

    def test_athleteinfo_parser_keeps_guardian_with_blank_relationship(self):
        html = """
        <html>
          <body>
            <input name="first_name" value="Lincoln" />
            <input name="last_name" value="Heinrich" />
            <input name="GUARDIAN[1157515][athlete_guardian_id]" value="1157515" />
            <input name="GUARDIAN[1157515][parentsno]" value="parent1" />
            <input name="GUARDIAN[1157515][first_name]" value="Scott" />
            <input name="GUARDIAN[1157515][last_name]" value="Heinrich" />
            <input name="GUARDIAN[1157515][relationship]" value="" />
            <input name="GUARDIAN[1157515][phone]" value="(425) 770-6400" />
            <input name="GUARDIAN[1157515][email]" value="4257706400" />
          </body>
        </html>
        """

        parsed = LegacyTranslator.parse_athleteinfo_response(html)
        merged = LegacyTranslator.merge_contact_data("1490959", parsed, [])

        self.assertEqual(merged["parent1"]["name"], "Scott Heinrich")
        self.assertEqual(merged["parent1"]["relationship"], "Parent")
        self.assertEqual(merged["parent1"]["phone"], "(425) 770-6400")


if __name__ == "__main__":
    unittest.main()
