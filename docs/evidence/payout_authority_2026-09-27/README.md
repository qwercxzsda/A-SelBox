# Financial authority and monthly payout verification

This records the September 27–28 verification run and its then-current baseline,
cutoff date, coverage, and result counts. Current behavior is defined by the
[payout contract](../../company_payout_reports.md), and maintained tests run against
the current migrations.

The real seed from the main checkout was loaded into a disposable local database. Only allowlisted financial COPY blocks and Auth user IDs are imported. The loader never
executes seed SQL or imports passwords or identity metadata. Original transaction rows and their
stored categories are fingerprinted before and after verification; no source rows are deleted or
reclassified. Existing development databases and the original seed remain unchanged.

## Independent arithmetic

The checks calculate expected values directly from stored source categories:

- Recent dates use Data Kiosk amounts in the Settlement, SelBox, and Data Kiosk categories.
- Mature dates use Settlement report amounts in the Settlement category for companies and in
  the SelBox category for SelBox, plus Data Kiosk amounts in the Data Kiosk category for company costs.
- Each mature seller/day/marketplace/currency group retains the difference between Settlement report
  controls and Data Kiosk amounts in the Data Kiosk category with SelBox.
- Every group must satisfy this exact identity:

```text
difference = data_kiosk_settlement_control - data_kiosk_category_amount
settlement_total = settlement_category_amount + selbox_category_amount
                 + data_kiosk_settlement_control
accounted_total = settlement_category_amount + selbox_category_amount
                + data_kiosk_category_amount + difference
                = settlement_total
```

Here, `settlement_category_amount` and `selbox_category_amount` come from Settlement reports in
the named categories. `data_kiosk_settlement_control` is the Settlement report amount in the
Data Kiosk category; `data_kiosk_category_amount` comes from Data Kiosk in that same category.

The comparison preserves source-only groups, including NULL-marketplace Settlement groups.
It checks both current reconciliation and complete frozen seller ledgers. Frozen reconciliation
is administrator-only, contains all seller currencies with explicit currency labels, and is
repeated on each company/currency report as context; it must not be added across reports.

The original seed contains 73,733 Settlement rows and 29,511 Data Kiosk rows. At the July 27 mature cutoff date,
its totals API matches 38,762 authoritative rows, including 548 daily differences. All 623 daily
reconciliation groups match independent category sums and balance exactly. These include 79
NULL-marketplace groups, 46 groups with only Settlement report controls in the Data Kiosk category,
and 473 groups with only Data Kiosk amounts in the Data Kiosk category.

## Source coverage and genuine supplementary inputs

The original seed's Data Kiosk coverage starts June 16 in all 18 marketplaces. Its latest eligible
month, June, is missing 270 of the 540 required marketplace days. The harness first verifies that
June publication rejects incomplete cost coverage atomically because the scope contains
authoritative company rows. This case does not exercise an empty aggregate.

The authorized service credentials can retrieve the missing June 1–15 inputs. The separate
acquisition command uses the existing credentialed Amazon adapter, caches exact responses in a
private directory outside the repository, and makes no database or remote Storage writes.
Credentials are loaded with an explicit service `.env` path and never printed or copied.

The verification command requires the supplementary cache, reconstructs typed acquisition
manifests, checks archive integrity,
runs the production Data Kiosk preprocessing/category validators, and publishes complete days
into the disposable database. The original seed rows remain unchanged. Source-document hashes,
added row/day counts, and exact financial/access checks are recorded in [the results](seed_validation.json).

The seed was processed as `v0`; the current processor is `v1`. The verification reads the genuine
seed archives from the existing seeded local Storage service and reprocesses 58 Settlement and
18 Data Kiosk acquisitions with the current processor. It publishes new versions only in the
disposable database. Complete source facts compare identically after excluding generated IDs,
version IDs, and timestamps. Original version rows remain unchanged. No processor versions are
relabeled, and no source categories or amounts are adjusted.

```sh
conda run -n A-SelBox python -m services.db.supabase.tests.real_seed_supplement \
  --seed /Users/mgmg/GitRepos/A-SelBox/services/db/supabase/seed.real.local.sql \
  --dotenv /Users/mgmg/GitRepos/A-SelBox/services/sync/.env \
  --cache /tmp/aselbox-payout-june-source-20260928

conda run -n A-SelBox python -m services.db.supabase.tests.verify_real_payouts \
  --seed /Users/mgmg/GitRepos/A-SelBox/services/db/supabase/seed.real.local.sql \
  --supplement-cache /tmp/aselbox-payout-june-source-20260928 \
  --output docs/evidence/payout_authority_2026-09-27/seed_validation.json
```

The first command reuses cached completed marketplace responses. The second performs no Amazon
requests, reads existing seed archives through the local service on port 55421, and uses in-memory
archive storage for the supplementary inputs. Existing Storage is never modified. Original
documents, credentials, identifiers, and financial amounts are not included in committed evidence.

## Actual eligible June results

The supplementary acquisitions add 4,768 source rows and 270 complete marketplace days, including
explicit empty-day coverage. June now has all 540 required days across 18 marketplaces.

At the actual July 27 mature cutoff date, the complete inputs generate 16 June reports across two companies.
Every header matches independently recalculated pinned-source and fee amounts. The reports retain
8,292 supporting components and 2,062 frozen reconciliation rows. Administrators can read every
report and seller ledger; members can read only their own company reports and cannot read seller
reconciliation or generate reports. Invalid and recent months are rejected on the server.

The supplemented live API matches 39,562 authoritative rows including 735 daily differences.
All 792 reconciliation groups match independent raw-category sums and balance exactly. The
original seed SHA-256 and every original source row/category fingerprint remain unchanged.

## Regression coverage

The [database suite](../../../services/db/supabase/README.md#verification) checks category authority,
boundary dates, company/SKU isolation, monthly publication, authenticated commit validation,
immutable reconciliation, and retention concurrency. The
[frontend checks](../../../services/frontend/user-webpage/README.md#docker-tooling) cover report
controls, tenant visibility, source menus, exact amounts, and desktop/phone layouts.

This evidence directory records the real-source run above. Archived `preprocess_version = v0`
inputs were replayed through the current `v1` preprocessor. The generated reports use payout
calculation version `v1`. The committed JSON preserves the actual June results and source fingerprints.
