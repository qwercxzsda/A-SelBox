"""Operator batches preserve exact SKU identity and global configuration completeness."""

from decimal import Decimal
from uuid import UUID

import psycopg

from services.db.supabase.tests.configuration_fixtures import ConfigurationFixture


class SkuConfigurationPublicationTests(ConfigurationFixture):
    def test_publication_preserves_exact_sku_zero_rates_and_replaces_current_period_inventory(
        self,
    ) -> None:
        company, _ = self.owner()
        operator = self.operator()
        result = self.save(
            operator,
            [
                self.change(
                    " API SKU ",
                    company,
                    [self.period("0"), self.period("6", marketplace="Amazon.ca")],
                )
            ],
        )
        self.assertEqual(set(result), {"published", "changed_count"})
        self.assertEqual(result["changed_count"], 1)
        first = result["published"][0]["terms_version_id"]
        self.assertEqual(result["published"], [{"sku": " API SKU ", "terms_version_id": first}])
        self.assertEqual(UUID(first).version, 7)
        second = self.save(
            operator, [self.change(" API SKU ", company, [self.period("7.123456")])]
        )["published"][0]["terms_version_id"]
        self.assertNotEqual(first, second)
        current = next(item for item in self.configuration(operator) if item["sku"] == " API SKU ")
        self.assertEqual(current["terms_version_id"], second)
        self.assertEqual(len(current["periods"]), 1)
        self.assertEqual(current["periods"][0]["fee_rate_percent"], "7.123456")
        self.assertEqual(
            self.connection.execute(
                "select fee_rate_percent from public.sku_fee_periods where terms_version_id=%s "
                "order by marketplace_name",
                (first,),
            ).fetchall(),
            [(Decimal(6),), (Decimal(0),)],
        )
        issues = self.assert_incomplete(operator, [self.change(" API SKU ", None)])
        self.assertEqual({issue["kind"] for issue in issues}, {"missing_company"})
        self.connection.execute("set constraints all immediate")

    def test_incomplete_configuration_remains_readable_until_repaired_in_one_atomic_save(
        self,
    ) -> None:
        company, _ = self.owner("A")
        self.assign("B", None)
        self.settlement([self.transaction("100", sku="A"), self.transaction("0", 4, sku="B")])
        operator = self.operator()
        self.connection.commit()
        items = self.configuration(operator)
        self.assertTrue(all(item["issues"] for item in items))
        issues = self.assert_incomplete(operator, [self.change("A", company, [self.period("0")])])
        self.assertTrue(
            any(issue["sku"] == "B" and issue["kind"] == "missing_company" for issue in issues)
        )
        before = self.configuration_state()
        result = self.save(
            operator,
            [
                self.change("A", company, [self.period("0")]),
                self.change("B", company, [self.period("5")]),
            ],
        )
        self.assertEqual(result["changed_count"], 2)
        self.assertEqual({item["sku"] for item in result["published"]}, {"A", "B"})
        self.connection.commit()
        self.assertNotEqual(self.configuration_state(), before)
        self.assertTrue(all(not item["issues"] for item in self.configuration(operator)))
        before = self.configuration_state()
        self.assert_invalid(operator, [])
        self.connection.commit()
        self.assertEqual(self.configuration_state(), before)

    def test_every_known_sku_needs_an_owner_including_registered_and_historical_only_skus(
        self,
    ) -> None:
        company, _ = self.owner("OWNED")
        self.assign("REGISTERED-ONLY", None)
        acquisition = self.acquisition()
        _, previous = self.settlement(
            [self.transaction("10", sku="HISTORY-ONLY")], acquisition_id=acquisition
        )
        self.settlement([], acquisition_id=acquisition, expected=previous)
        operator = self.operator()
        issues = self.assert_incomplete(operator, [self.change("OWNED", company)])
        self.assertEqual(
            {(issue["sku"], issue["kind"]) for issue in issues},
            {("REGISTERED-ONLY", "missing_company"), ("HISTORY-ONLY", "missing_company")},
        )
        result = self.save(
            operator,
            [
                self.change("REGISTERED-ONLY", company),
                self.change("HISTORY-ONLY", company),
            ],
        )
        self.assertEqual(result["changed_count"], 2)
        self.assertTrue(all(not item["issues"] for item in self.configuration(operator)))

    def test_current_marketplace_and_date_gaps_are_reported_and_zero_percent_fills_them(
        self,
    ) -> None:
        company, _ = self.owner("A")
        self.settlement(
            [
                self.transaction("0", sku="A", activity_date="2026-06-15"),
                self.transaction("10", 4, sku="A", activity_date="2026-06-16"),
                self.transaction("20", 5, sku="A", activity_date="2026-06-17"),
                self.transaction("30", 6, sku="A", activity_date="2026-06-16")
                | {"marketplace_name": "Amazon.ca"},
            ]
        )
        operator = self.operator()
        periods = [
            self.period("0", start="2026-06-15", end="2026-06-16"),
            self.period("5", start="2026-06-17", end="2026-06-18"),
        ]
        issues = self.assert_incomplete(operator, [self.change("A", company, periods)])
        self.assertCountEqual(
            issues,
            [
                {
                    "sku": "A",
                    "kind": "missing_fee",
                    "marketplace_name": market,
                    "valid_from": "2026-06-16",
                    "valid_to": "2026-06-17",
                }
                for market in ("Amazon.com", "Amazon.ca")
            ],
        )
        periods.extend(
            [
                self.period("0", start="2026-06-16", end="2026-06-17"),
                self.period("0", marketplace="Amazon.ca", start="2026-06-16", end="2026-06-17"),
            ]
        )
        self.assertEqual(
            self.save(operator, [self.change("A", company, periods)])["changed_count"], 1
        )
        self.assertEqual(self.configuration(operator)[0]["issues"], [])

    def test_new_imports_can_create_gaps_but_next_save_must_repair_the_whole_configuration(
        self,
    ) -> None:
        company, _ = self.owner("A")
        operator = self.operator()
        self.save(operator, [self.change("A", company, [self.period()])])
        self.settlement([self.transaction("10", sku="NEW")])
        self.assertTrue(
            next(item for item in self.configuration(operator) if item["sku"] == "NEW")["issues"]
        )
        issues = self.assert_incomplete(operator, [self.change("A", company, [self.period("7")])])
        self.assertTrue(any(issue["sku"] == "NEW" for issue in issues))
        self.assertEqual(
            self.save(operator, [self.change("NEW", company, [self.period("0")])])["changed_count"],
            1,
        )
        self.assertTrue(all(not item["issues"] for item in self.configuration(operator)))

    def test_stale_edit_uses_conflict_code_and_preserves_history_and_revision_tokens(self) -> None:
        company, _ = self.owner("A")
        operator = self.operator()
        stale = self.change("A", company, [self.period("5")])
        self.save(operator, [self.change("A", company, [self.period("7")])])
        self.connection.commit()
        before = self.configuration_state()
        with self.assertRaises(psycopg.Error) as error:
            self.save(operator, [stale])
        self.assertEqual(error.exception.sqlstate, "PT409")
        self.assertEqual(
            error.exception.diag.message_primary, "SKU configuration changed while editing"
        )
        self.assertEqual(self.configuration_state(), before)
