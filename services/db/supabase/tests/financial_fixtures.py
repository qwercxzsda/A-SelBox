"""Shared ownership, fee-period, and source-category financial edge cases."""

from services.db.supabase.tests.source_fixtures import SourceModelFixture, new_id


class FinancialFixture(SourceModelFixture):
    def assign(
        self,
        sku: str,
        company: str | None,
        *,
        rate: str | None = None,
        expected: str | None = None,
    ) -> str:
        return self.call(
            "publish_sku_terms",
            {
                "id": new_id(),
                "seller_sku_id": new_id(),
                "seller_namespace": self.seller,
                "sku": sku,
                "company_id": company,
                "expected_current_version_id": expected,
                "change_reason": "Live-view regression fixture",
                "periods": []
                if rate is None
                else [
                    {
                        "id": new_id(),
                        "marketplace_name": "Amazon.com",
                        "valid_from": "2026-01-01",
                        "valid_to": None,
                        "fee_rate_percent": rate,
                    }
                ],
            },
        )

    def financial_fixture(self) -> tuple[str, str]:
        company_a, sku = self.owner()
        company_b, other = self.owner("OTHER")
        self.fee(sku, [("2026-01-01", "2026-07-01", "5.125"), ("2026-07-01", None, "7")])
        self.fee(other, [("2026-01-01", None, "7")])
        self.assign("GAP", company_a)
        self.assign("UNASSIGNED", None, rate="9")
        self.settlement(
            [
                self.transaction("100.123456789012345678901"),
                self.transaction("-2.5", 4, kind="Refund", activity_date="2026-07-01"),
                self.transaction("12", 5, description="Shipping"),
                self.transaction("0", 6, activity_date="2026-06-16"),
                self.transaction("5", 7, sku="GAP"),
                self.transaction("7", 8, sku="UNKNOWN"),
                self.transaction("11", 9, sku="UNASSIGNED"),
                self.transaction("13", 10, sku="UNASSIGNED", description="Shipping"),
                self.transaction("20", 11, sku="OTHER"),
                self.transaction("999", 12, category="DATA_KIOSK"),
                self.transaction("999", 13, category="SELBOX") | {"family": None},
            ]
        )
        self.kiosk(
            1,
            [
                self.component("-10"),
                self.component("3", category="SETTLEMENT"),
                self.component("2", category="ANALYSIS_ONLY"),
                self.component("0"),
                self.component("4", sku="OTHER"),
                self.component("6", sku="UNKNOWN"),
                self.component("8", sku="UNASSIGNED"),
                self.component("9") | {"component_type": "NET_PRODUCT_SALES", "fee_base": "9"},
                self.component("17", category="SELBOX") | {"sku": None},
            ],
        )
        self.seller = "seller-two"
        self.assign("SKU", company_b, rate="11")
        self.settlement([self.transaction("100")])
        self.kiosk(1, [self.component("-7")])
        self.seller = "seller-one"
        return company_a, company_b
