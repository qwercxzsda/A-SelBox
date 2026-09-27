# Transaction type registry

The [Python registry](../services/sync/src/transaction_types/) defines every accepted
Settlement source triple and Data Kiosk component type. It is the source of truth for
preprocessing and the generated frontend Type menus. Unknown source types reject the complete
report or acquisition before publication. There is no default allocation category.

## Settlement admission

Each exact, case-sensitive tuple of `transaction-type`, `amount-type`, and
`amount-description` maps to a stored component Type, category, validation family, and optional
accounting subtype. Matching trims surrounding whitespace. Membership in a broad
family such as `Order` does not permit new descriptions automatically.

Known retained charges explicitly use `SELBOX`. Their classification does not establish a
company cost or prove a corresponding Data Kiosk charge. Stored Type values include
`PRODUCT_SALES`, `PRODUCT_REFUNDS`, and the remaining
slash-separated source keys. Variable account descriptions are individually registered; new
country combinations or transfer explanations require review rather than creating arbitrary
menu entries.

Every accepted type still passes the existing SKU, marketplace, amount, report reconciliation,
and retrocharge checks. Unknown types are reported with their source lines. The saved acquisition
and prior current version remain available; no successful partial version is published. The
preprocessor definition comes from [`PREPROCESS_VERSION`](../services/sync/src/preprocess_version.py).
Source rows are immutable; reruns publish new complete versions.

## Shared menus

Generate the frontend artifacts from the repository root:

```sh
conda run -n A-SelBox python -m services.sync.src.transaction_types.generate
conda run -n A-SelBox python -m services.sync.src.transaction_types.generate --check
```

The check fails if committed artifacts no longer match Python definitions. Do not edit the
generated JSON or maintain a second hand-written Type list. Marketplace choices are generated
from the existing canonical marketplace registry, including `Non-Amazon US`.

Type menus use source and category to reflect their dataset. Company Transactions includes
all known types except category `SELBOX`, including `ANALYSIS_ONLY`.
Administrator Transactions includes all registered types; its source tabs include all registered
types for their source. Supported values may
produce zero rows; option discovery does not inspect transactions to establish occurrence.

Source always offers Settlements and Data Kiosk. Marketplace offers all supported names. Company
members reuse the exact SKU strings in their already-loaded current assignments. Administrators
preload the complete SKU catalog in one administrator-only RPC before showing the workspace because imported facts
can contain unassigned or unregistered SKUs absent from assignments. Source and fee revisions
refresh that list before dependent search queries. Table search resolves matching catalog values
to exact OR sets; Currency is excluded. These menu changes do not alter backend row authorization.

## Adding a type

1. Inspect the retained source evidence and decide its category, matching fields, and validation
   requirements. A similar label alone does not establish accounting treatment.
2. Add the explicit registry entry and a meaningful preprocessing test. Include approved spelling
   aliases and preserved stored keys where needed; never add a catch-all entry.
3. Regenerate both frontend catalogs and run the drift check, Python tests, and frontend checks.
4. Make the updated catalog available to the frontend before publishing reports with new Type
   values. Rerun the rejected acquisition from its retained archive.

The initial registry was reviewed against `seed.real` and the retained
[Settlement classification evidence](evidence/settlement_classification_audit_2026-09-08.md),
plus explicitly approved source-cost and retrocharge rules. This is a reviewed application
contract, not a claim that Amazon's future vocabulary is closed.
