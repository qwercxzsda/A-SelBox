"""Explicit settlement cost families backed by reviewed Data Kiosk evidence.

These are source-family mappings, never joins to individual Data Kiosk rows.
Unknown labels remain outside the company-cost policy. Match a known family
before validating its description so an invalid known charge cannot default.
"""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class CostFamily:
    name: str
    descriptions: frozenset[str]


_BASE = frozenset({"Base fee"})
_BASE_AND_TAX = frozenset({"Base fee", "Tax on fee"})
_NAMED_COSTS = {
    ("AmazonFees", "Coupon Participation Fee"): CostFamily("COUPON", _BASE),
    ("AmazonFees", "Coupon Performance Based Fee"): CostFamily("COUPON", _BASE),
    ("AmazonFees", "Deal Participation Fee"): CostFamily("DEAL", _BASE),
    ("AmazonFees", "Deal Performance Based Fee"): CostFamily("DEAL", _BASE),
    ("FBAFees", "FBA Amazon-Partnered Carrier Shipment Fee"): CostFamily(
        "INBOUND_TRANSPORTATION", _BASE
    ),
    ("FBAFees", "FBA Inbound Placement Service Fee"): CostFamily("INBOUND_PLACEMENT", _BASE),
    ("FBAFees", "FBA Inventory Storage Fee"): CostFamily("STORAGE", _BASE_AND_TAX),
    ("FBAFees", "FBA Long Term Storage Fee"): CostFamily("AGED_STORAGE", _BASE_AND_TAX),
    ("FBAFees", "FBA Removal Order: Disposal Fee"): CostFamily("DISPOSAL", _BASE_AND_TAX),
    ("FBAFees", "FBA Removal Order: Return Fee"): CostFamily("REMOVAL", _BASE),
    ("FBAFees", "Inbound Transportation Program Fee"): CostFamily(
        "INBOUND_TRANSPORTATION_PROGRAM", _BASE
    ),
    ("ServiceFee", "Cost of Advertising"): CostFamily(
        "ADVERTISING", frozenset({"TransactionTotalAmount"})
    ),
}
_OTHER_COSTS = {
    "DisposalComplete": "DISPOSAL",
    "FBA Inbound Placement Service Fee": "INBOUND_PLACEMENT",
    "FBAInboundTransportationFee": "INBOUND_TRANSPORTATION",
    "FBAInboundTransportationProgramFee": "INBOUND_TRANSPORTATION_PROGRAM",
    "Inbound Transportation Fee": "INBOUND_TRANSPORTATION",
    "RemovalComplete": "REMOVAL",
    "Storage Fee": "STORAGE",
    "StorageRenewalBilling": "AGED_STORAGE",
}


def match_cost_family(transaction: str, amount_type: str, description: str) -> str | None:
    """Return an approved family, rejecting malformed components of known costs."""
    if cost := _NAMED_COSTS.get((transaction, amount_type)):
        if description not in cost.descriptions:
            raise ValueError(f"{cost.name} contains an unsupported settlement cost component.")
        return cost.name
    if transaction == amount_type == "other-transaction":
        return _OTHER_COSTS.get(description)
    return None
