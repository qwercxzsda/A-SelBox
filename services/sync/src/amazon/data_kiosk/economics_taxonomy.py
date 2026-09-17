"""Normalize source taxonomy labels before applying explicit component mappings."""

import re

_ACRONYM_BOUNDARY = re.compile(r"([A-Z]+)([A-Z][a-z])")
_WORD_BOUNDARY = re.compile(r"([a-z0-9])([A-Z])")
_NON_ALPHANUMERIC = re.compile(r"[^A-Za-z0-9]+")


def canonicalize_economics_taxonomy(value: str) -> str:
    """Canonicalize Amazon's human-readable and camel-case taxonomy labels."""
    acronym_split = _ACRONYM_BOUNDARY.sub(r"\1_\2", value.strip())
    word_split = _WORD_BOUNDARY.sub(r"\1_\2", acronym_split)
    separated = _NON_ALPHANUMERIC.sub("_", word_split)
    return separated.strip("_").upper()
