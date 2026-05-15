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


if __name__ == "__main__":
    unittest.main()
