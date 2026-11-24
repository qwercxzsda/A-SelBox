"""Validate the distinct identifiers Amazon uses for seller and warehouse stock."""

import re

FNSKU = re.compile(r"(?:X0|B0)[A-Z0-9]{8}")
ASIN = re.compile(r"B0[A-Z0-9]{8}")


def validate_product(
    sku: str | None = None, asin: str | None = None, fnsku: str | None = None
) -> None:
    if asin is not None and not ASIN.fullmatch(asin):
        raise ValueError("Unrecognized Amazon ASIN shape.")
    if fnsku is not None and not FNSKU.fullmatch(fnsku):
        raise ValueError("Unrecognized Amazon FNSKU shape.")
    if sku is not None and (not sku.strip() or FNSKU.fullmatch(sku) or sku in (asin, fnsku)):
        raise ValueError("Expected a distinct seller SKU.")
