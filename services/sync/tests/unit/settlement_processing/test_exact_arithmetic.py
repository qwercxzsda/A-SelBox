"""Tests for exact processed monetary arithmetic."""

import unittest
from datetime import date
from decimal import localcontext

from ....src.numeric import Numeric
from ....src.settlement_processing.models import CompanySkuFeeRateCandidate
from ...support.settlement_processing_plans import (
    build_test_allocation_groups,
    direct_rules,
    make_id_factory,
    make_ledger_entry,
)


class TestSettlementProcessingExactArithmetic(unittest.TestCase):
    def test_money_totals_and_selbox_fee_ignore_decimal_context_precision(self) -> None:
        sale_amount = "123456789012345678.123456789"
        fee_rate = CompanySkuFeeRateCandidate(
            company_sku_fee_rate_id="fee-rate-1",
            company_id="company-1",
            marketplace_id="ATVPDKIKX0DER",
            amz_sku="SKU-1",
            valid_from=date(2026, 8, 1),
            valid_to=None,
            fee_rate_percent=Numeric("12.3456789"),
        )

        with localcontext() as context:
            context.prec = 5
            allocation_groups = build_test_allocation_groups(
                [make_ledger_entry("entry-1", sale_amount)],
                direct_rules(),
                [fee_rate],
                id_factory=make_id_factory(),
            )

        target = allocation_groups[0].targets[0]
        self.assertEqual(target.settlement_amount, Numeric(sale_amount))
        self.assertEqual(
            target.selbox_fee,
            Numeric("-15241578751714678.779149520750190521"),
        )


if __name__ == "__main__":
    unittest.main()
