import unittest

from app.translators.legacy import LegacyTranslator


class CommissionTranslatorTests(unittest.TestCase):
    def test_stripe_commissions_contract_uses_legacy_form_fields(self):
        endpoint, data = LegacyTranslator.stripe_commissions_to_legacy(
            commperiod="2026-05-01~2026-05-15",
            scout=None,
        )

        self.assertEqual(endpoint, "/admin/stripecommlist")
        self.assertEqual(data["commperiod"], "2026-05-01~2026-05-15")
        self.assertEqual(data["scout"], "undefined")

    def test_stripe_payroll_contract_uses_legacy_form_fields(self):
        endpoint, data = LegacyTranslator.stripe_commission_payroll_to_legacy(
            commperiod="2026-05-16~2026-05-31",
            scout="Primary Operator",
        )

        self.assertEqual(endpoint, "/admin/stripecommpayrolllist")
        self.assertEqual(data["commperiod"], "2026-05-16~2026-05-31")
        self.assertEqual(data["scout"], "Primary Operator")

    def test_commission_json_parser_normalizes_amounts_and_duplicates(self):
        raw = """
        [
          {"athlete_id": 1490274, "athlete_main_id": 952103, "athletename": "Zyon Wicks", "head_scout_name": "Head Scout D", "afterdiscount": "99.00", "planprice": "169", "product": "Legend ID", "subscription_name": "12 Payments", "createddate": "04/30/2026 04:01 PM", "parent_bill_date": "05/08/2026", "status": "Pending"},
          {"athlete_id": 1490274, "athlete_main_id": 952103, "athletename": "Zyon Wicks", "head_scout_name": "Head Scout D", "afterdiscount": "99.00", "planprice": "169", "product": "Legend ID", "subscription_name": "12 Payments", "createddate": "04/30/2026 04:00 PM", "parent_bill_date": "05/08/2026", "status": "Deleted"},
          {"athlete_id": 1489625, "athlete_main_id": 951462, "athletename": "Marcus Garcia", "head_scout_name": "Head Scout C", "afterdiscount": "99", "planprice": "99", "product": "Elite ID", "subscription_name": "12 Payments", "createddate": "05/01/2026 06:50 PM", "parent_bill_date": "05/01/2026", "status": "Paid"}
        ]
        """

        result = LegacyTranslator.parse_commission_lookup_response(
            raw_response=raw,
            source="stripe_commissions",
            commperiod="2026-05-01~2026-05-15",
            status_code=200,
            content_type="application/json",
        )

        self.assertTrue(result["success"])
        self.assertEqual(result["count"], 3)
        self.assertEqual(result["duplicate_count"], 2)
        self.assertEqual(result["entries"][0]["amount_cents"], 9900)
        self.assertEqual(result["entries"][0]["athlete_name"], "Zyon Wicks")
        self.assertTrue(result["entries"][0]["possible_duplicate"])
        self.assertEqual(result["entries"][2]["athlete_name"], "Marcus Garcia")
        self.assertEqual(result["entries"][2]["athlete_id"], "1489625")
        self.assertEqual(result["entries"][2]["amount_cents"], 9900)
        self.assertEqual(result["entries"][2]["status"], "Paid")

    def test_commission_html_parser_normalizes_table_rows(self):
        raw = """
        <table>
          <thead><tr><th>Athlete</th><th>Scout</th><th>Amount</th><th>Date</th></tr></thead>
          <tbody><tr><td>Marcus Garcia</td><td>Head Scout C</td><td>$199</td><td>2026-05-03</td></tr></tbody>
        </table>
        """

        result = LegacyTranslator.parse_commission_lookup_response(
            raw_response=raw,
            source="stripe_commission_payroll",
            commperiod="2026-05-01~2026-05-15",
        )

        self.assertEqual(result["count"], 1)
        self.assertEqual(result["entries"][0]["athlete_name"], "Marcus Garcia")
        self.assertEqual(result["entries"][0]["amount_cents"], 19900)


if __name__ == "__main__":
    unittest.main()
