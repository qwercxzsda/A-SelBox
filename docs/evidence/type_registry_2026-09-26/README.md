# Explicit type registry verification

The [type registry](../../transaction_type_registry.md) was checked against the unchanged
ignored `services/db/supabase/seed.real.local.sql`, rather than synthetic type names. Its SHA-256
and aggregate results are recorded in [seed_validation.json](seed_validation.json).

The validation streamed the original PostgreSQL COPY blocks without executing the dump or
modifying a database. It decoded saved Settlement `source_fields`, classified every row, and
compared category, family, stored component Type, and accounting subtype with the original seed.
Every Settlement and Data Kiosk row was also checked for an exact source/category/Type entry in
the generated frontend catalog.

| Check | Result |
| --- | --- |
| Settlement rows / distinct source triples | 73,733 / 88 |
| Data Kiosk rows / distinct Types | 29,511 / 23 |
| Missing catalog entries for seeded rows | 0 |
| Settlement classification differences | 0 |
| Reconstructed Settlement reports reprocessed | 59 |
| Reprocessed financial or classification differences | 0 |
| Reconstructed Data Kiosk day/SKU facts / components | 17,280 / 29,511 |
| Data Kiosk component groups changed | 0 |

The full report replay reconstructed TSV input from saved row fields and version headers. It
passed the regular parser, registry admission, report reconciliation, and retrocharge validation.
Compared fields included amount, currency, quantity, SKU, marketplace, posted date, category,
family, Type, and accounting subtype. This checks semantic replay from retained fields; the seed
does not contain the original archive bytes, so it is not a byte-for-byte archive replay.

The September 27 refactor check also reconstructed Data Kiosk inputs from saved native dimensions.
All component keys, categories/types, exact amounts, currency, quantities, fee bases, native
dimensions, and source-line provenance matched the stored components. Original archives were not
downloaded. The seed file hash remained unchanged.

The registry also includes historical audit signatures and approved cost/retrocharge types absent
from this seed. The reviewed catalog contains 116 Settlement and 44 Data Kiosk types, including
all five analysis cost types.

Automated regressions cover unknown types inside already-known families, unknown zero-amount
rows, grouped source-line diagnostics, rejection before publication, retained archive evidence,
registry uniqueness, source-model coverage, and generated-artifact freshness. Imports use the
shared processor version; preprocessing preserves the immutable source and publication contracts.
