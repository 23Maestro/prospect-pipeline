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

    def test_athleteinfo_parser_uses_profile_header_as_student_name_source(self):
        html = """
        <html>
          <body>
            <h4>Wyatt Harrison <a class="profilelink" href="/athlete/profile/1494473"></a></h4>
            <input name="first_name" value="Wyatt" />
            <input name="last_name" value="Harri" />
            <input name="phone" value="(903) 372-4551" />
            <input name="GUARDIAN[1158530][athlete_guardian_id]" value="1158530" />
            <input name="GUARDIAN[1158530][parentsno]" value="parent1" />
            <input name="GUARDIAN[1158530][first_name]" value="Danielle" />
            <input name="GUARDIAN[1158530][last_name]" value="Harrison" />
            <input name="GUARDIAN[1158530][relationship]" value="Mom" />
            <input name="GUARDIAN[1158530][phone]" value="(903) 372-4551" />
            <input name="GUARDIAN[1158530][email]" value="parent.com" />
          </body>
        </html>
        """

        parsed = LegacyTranslator.parse_athleteinfo_response(html)
        merged = LegacyTranslator.merge_contact_data("1494473", parsed, [])

        self.assertEqual(merged["student_athlete"]["name"], "Wyatt Harrison")
        self.assertEqual(merged["parent1"]["name"], "Danielle Harrison")

    def test_athleteinfo_parser_header_student_name_overrides_different_input_name(self):
        html = """
        <html>
          <body>
            <h4>Wyatt Harrison <a class="profilelink" href="/athlete/profile/1494473"></a></h4>
            <input name="first_name" value="Wrong" />
            <input name="last_name" value="Input" />
            <input name="phone" value="(903) 372-4551" />
          </body>
        </html>
        """

        parsed = LegacyTranslator.parse_athleteinfo_response(html)
        merged = LegacyTranslator.merge_contact_data("1494473", parsed, [])

        self.assertEqual(merged["student_athlete"]["name"], "Wyatt Harrison")

    def test_athletic_seasons_parser_reads_only_positions_from_junior_details(self):
        html = """
        <html>
          <body>
            <div id="detailsjunior0">
              <div class="col-md-12">
                <div class="col-md-3 col-xs-7">Positions</div>
                <div class="col-md-9 col-xs-5">QB-P</div>
              </div>
              <div class="col-md-12">
                <div class="col-md-3 col-xs-7">Jersey #</div>
                <div class="col-md-9 col-xs-5">10</div>
              </div>
            </div>
          </body>
        </html>
        """

        parsed = LegacyTranslator.parse_athletic_seasons_details(html)

        self.assertEqual(parsed["positions"], "QB-P")
        self.assertNotIn("jersey_number", parsed)

    def test_athletic_seasons_parser_returns_none_when_positions_missing(self):
        html = """
        <html>
          <body>
            <div id="detailsjunior0">
              <div class="col-md-12">
                <div class="col-md-3 col-xs-7">Jersey #</div>
                <div class="col-md-9 col-xs-5">10</div>
              </div>
            </div>
          </body>
        </html>
        """

        parsed = LegacyTranslator.parse_athletic_seasons_details(html)

        self.assertIsNone(parsed["positions"])


if __name__ == "__main__":
    unittest.main()
