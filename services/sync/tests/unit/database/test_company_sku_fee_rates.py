"""Tests for shared company/SKU fee-rate loading and resolution."""

import unittest
from datetime import date
from decimal import Decimal, localcontext
from uuid import UUID

from ....src.database.company_sku_fee_rates import (
    LOAD_COMPANY_SKU_FEE_RATES_SQL,
    CompanySkuFeeRate,
    CompanySkuFeeRateResolver,
    calculate_selbox_fee,
    load_company_sku_fee_rates,
)
from ....src.numeric import Numeric
from ...support.fakes import FakeCursor

MARKETPLACE_ID = "ATVPDKIKX0DER"
FEE_RATE_ID = str(UUID(int=1))
COMPANY_ID = str(UUID(int=2))
DEFAULT_FEE_RATE_PERCENT = Numeric("7.5")
DEFAULT_VALID_FROM = date(2026, 8, 1)
DEFAULT_VALID_TO = date(2026, 9, 1)


def _fee_rate(
    *,
    identifier: str = FEE_RATE_ID,
    fee_rate_percent: Numeric = DEFAULT_FEE_RATE_PERCENT,
    valid_from: date = DEFAULT_VALID_FROM,
    valid_to: date | None = DEFAULT_VALID_TO,
) -> CompanySkuFeeRate:
    return CompanySkuFeeRate(
        id=identifier,
        seller_namespace="seller-na",
        marketplace_id=MARKETPLACE_ID,
        sku="SKU-1",
        company_id=COMPANY_ID,
        fee_rate_percent=fee_rate_percent,
        valid_from=valid_from,
        valid_to=valid_to,
    )


class TestCompanySkuFeeRateResolver(unittest.TestCase):
    def test_resolves_half_open_effective_periods(self) -> None:
        resolver = CompanySkuFeeRateResolver((_fee_rate(),))

        self.assertIsNone(resolver.resolve(MARKETPLACE_ID, "SKU-1", date(2026, 7, 31)))
        self.assertEqual(
            resolver.resolve(MARKETPLACE_ID, "SKU-1", date(2026, 8, 1)),
            _fee_rate(),
        )
        self.assertIsNone(resolver.resolve(MARKETPLACE_ID, "SKU-1", date(2026, 9, 1)))

    def test_rejects_ambiguous_overlapping_rules(self) -> None:
        resolver = CompanySkuFeeRateResolver(
            (
                _fee_rate(),
                _fee_rate(
                    identifier=str(UUID(int=3)),
                    valid_from=date(2026, 8, 15),
                    valid_to=None,
                ),
            )
        )

        with self.assertRaisesRegex(ValueError, "Multiple company/SKU fee rates"):
            resolver.resolve(MARKETPLACE_ID, "SKU-1", date(2026, 8, 20))

    def test_python_fee_rate_model_has_only_the_general_numeric_precision_bound(self) -> None:
        rate = Numeric("7.123456789012345678901234567890")

        self.assertEqual(_fee_rate(fee_rate_percent=rate).fee_rate_percent, rate)


class TestCompanySkuFeeRateLoader(unittest.TestCase):
    def test_loads_only_requested_keys_and_overlapping_periods(self) -> None:
        cursor = FakeCursor(
            [],
            fetchall_results=[
                [
                    (
                        FEE_RATE_ID,
                        "seller-na",
                        MARKETPLACE_ID,
                        "SKU-1",
                        COMPANY_ID,
                        Decimal("7.5"),
                        date(2026, 8, 1),
                        date(2026, 9, 1),
                    )
                ]
            ],
        )

        result = load_company_sku_fee_rates(
            cursor,
            seller_namespace="seller-na",
            marketplace_skus=((MARKETPLACE_ID, "SKU-1"), (MARKETPLACE_ID, "SKU-1")),
            activity_date_from=date(2026, 8, 2),
            activity_date_to=date(2026, 8, 31),
        )

        self.assertEqual(result, (_fee_rate(),))
        self.assertEqual(len(cursor.execute_calls), 1)
        sql, parameters = cursor.execute_calls[0]
        self.assertEqual(sql, LOAD_COMPANY_SKU_FEE_RATES_SQL)
        self.assertEqual(parameters["marketplace_ids"], [MARKETPLACE_ID])
        self.assertEqual(parameters["skus"], ["SKU-1"])
        self.assertEqual(parameters["seller_namespace"], "seller-na")
        self.assertEqual(parameters["activity_date_from"], date(2026, 8, 2))
        self.assertEqual(parameters["activity_date_to"], date(2026, 8, 31))

    def test_empty_keys_do_not_query(self) -> None:
        cursor = FakeCursor([])

        result = load_company_sku_fee_rates(
            cursor,
            seller_namespace="seller-na",
            marketplace_skus=(),
            activity_date_from=date(2026, 8, 1),
            activity_date_to=date(2026, 8, 1),
        )

        self.assertEqual(result, ())
        self.assertFalse(cursor.execute_calls)


class TestSelboxFeeCalculation(unittest.TestCase):
    def test_uses_percentage_points_and_preserves_exact_decimal_digits(self) -> None:
        with localcontext() as context:
            context.prec = 3
            fee = calculate_selbox_fee(
                Numeric("12345678901234567890.12345"),
                Numeric("7.125"),
            )

        self.assertEqual(fee, Decimal("-879629621712962962.1712958125"))

    def test_unresolved_rate_is_zero(self) -> None:
        self.assertEqual(calculate_selbox_fee(Numeric("30.375"), None), Decimal(0))

    def test_zero_rate_preserves_assignment_without_charging_a_fee(self) -> None:
        fee_rate = _fee_rate(fee_rate_percent=Numeric(0))

        self.assertEqual(fee_rate.fee_rate_percent, Decimal(0))
        self.assertEqual(calculate_selbox_fee(Numeric("30.375"), Numeric(0)), Decimal(0))


if __name__ == "__main__":
    unittest.main()
