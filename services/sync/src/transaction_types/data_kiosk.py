"""Supported Data Kiosk monetary types, including exact accepted taxonomy aliases."""

from dataclasses import dataclass
from types import MappingProxyType
from typing import Literal

from ..allocation import AllocationCategory

DataKioskCollection = Literal["sales", "fees", "ads", "cost"]


@dataclass(frozen=True, slots=True)
class DataKioskType:
    collection: DataKioskCollection
    component_type: str
    category: AllocationCategory


def _types(
    collection: DataKioskCollection,
    category: AllocationCategory,
    labels: tuple[str, ...],
) -> tuple[DataKioskType, ...]:
    return tuple(DataKioskType(collection, label, category) for label in labels)


DATA_KIOSK_TYPES: tuple[DataKioskType, ...] = (
    *_types(
        "sales",
        AllocationCategory.SETTLEMENT,
        ("NET_PRODUCT_SALES",),
    ),
    *_types(
        "fees",
        AllocationCategory.SETTLEMENT,
        (
            "DIGITAL_SERVICES_FEE_FBA",
            "DIGITAL_SERVICES_FEE_SOA",
            "FBA_FULFILLMENT_FEE",
            "FBA_FULFILLMENT_FEES",
            "FBA_FULFILMENT_FEE",
            "FBA_INVENTORY_REIMBURSEMENT",
            "LIQUIDATION_PROCESSING_FEE",
            "LIQUIDATION_REFERRAL_FEE",
            "REFERRAL_FEE",
            "REFERRAL_FEES",
            "REFUNDED_REFERRAL_FEE",
            "REFUND_COMMISSION_FEE",
        ),
    ),
    *_types(
        "fees",
        AllocationCategory.SELBOX,
        ("SUBSCRIPTION_FEE",),
    ),
    *_types(
        "fees",
        AllocationCategory.DATA_KIOSK,
        (
            "COUPON_PARTICIPATION_FEE",
            "COUPON_PERFORMANCE_FEE",
            "DEAL_PARTICIPATION_FEE",
            "DEAL_PERFORMANCE_FEE",
            "DISPOSAL_FEE",
            "FBA_AGED_INVENTORY_SURCHARGE",
            "FBA_INBOUND_CONVENIENCE_FEE",
            "FBA_INBOUND_PLACEMENT_SERVICE_FEE",
            "FBA_INBOUND_TRANSPORTATION_FEE",
            "FBA_INBOUND_TRANSPORTATION_PROGRAM_FEE",
            "FBA_STORAGE_FEE",
            "LABELING_FEE",
            "LONG_TERM_STORAGE_FEE",
            "MONTHLY_INVENTORY_STORAGE_FEE",
            "REMOVAL_FEE",
        ),
    ),
    *_types(
        "ads",
        AllocationCategory.DATA_KIOSK,
        (
            "SPONSORED_BRANDS",
            "SPONSORED_BRANDS_CHARGE",
            "SPONSORED_BRANDS_CHARGES",
            "SPONSORED_DISPLAY",
            "SPONSORED_DISPLAY_CHARGE",
            "SPONSORED_DISPLAY_CHARGES",
            "SPONSORED_PRODUCTS",
            "SPONSORED_PRODUCTS_CHARGE",
            "SPONSORED_PRODUCTS_CHARGES",
            "SPONSORED_PRODUCT_FEE",
        ),
    ),
    *_types(
        "cost",
        AllocationCategory.ANALYSIS_ONLY,
        (
            "COST_OF_GOODS_SOLD",
            "MFN_FULFILLMENT_COST",
            "MFN_STORAGE_COST",
            "MISCELLANEOUS_COST",
            "SHIPPING_TO_AMAZON_COST",
        ),
    ),
)

DATA_KIOSK_TYPE_BY_SOURCE = MappingProxyType(
    {(item.collection, item.component_type): item for item in DATA_KIOSK_TYPES}
)
