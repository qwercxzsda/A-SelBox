# Schema for replacing Data Kiosk

Status: 24 November 2026. A design only: no migration and no code is written. The SQL file was compiled on a throwaway Postgres 17 database, with a few rows to try its checks. The calculation of section 4 is not written as SQL yet and has not been run.

| File | What it is for |
| --- | --- |
| `remove-data-kiosk-rules.md` | the rules. "Rules 8" below means section 8 of that file |
| `remove-data-kiosk-schema.sql` | the tables, exactly: every column, key and check, with a short comment each. "SQL 4" means section 4 of that file |
| this file | what SQL cannot say: what a row means, how amounts are calculated from the tables, what a payout pins, when things run, and which choices were made |

Nothing is deployed, so this is a new baseline. No existing row is carried over.
Section 8 answers the five points the rules left to the schema design. Section 9 lists the choices this design made on its own.

## 1. The tables at a glance

| Group | Tables | Who writes | History | SQL |
| --- | --- | --- | --- | --- |
| Bookkeeping, shared by every Amazon source | `source_acquisitions`, `source_preprocess_batches`, `source_units`, `source_unit_versions`, `source_batch_units` | the store stage of each preprocessing | every version is kept | 1 |
| Finances | `finances_transactions`, `finances_amounts` | Finances preprocessing | versioned | 2 |
| Ad invoices | `ad_invoices`, `ad_invoice_lines` | ad invoice preprocessing | versioned | 3 |
| Reports | `storage_rows`, `aged_storage_rows`, `removal_order_rows` | one preprocessing each | versioned | 4 |
| Inventory ledger | `inventory_ledger_rows` | ledger preprocessing | versioned | 5 |
| Information | `campaigns`, `campaign_products`, `promotions`, `promotion_products`, `shipments`, `shipment_items` | one preprocessing each | the latest answer only | 6 |
| Assignments | `assignment_keys`, `assignment_versions`, `sku_fee_periods` | administrators, and the cron job for defaults | versioned | 7 |
| Payout reports | `company_payout_reports`, `payout_report_source_versions`, `payout_report_assignment_versions`, and today's `payout_report_refresh_state` | the payout worker | a saved report never changes | 8 |
| Fixed list | `currencies` | set up once | | 0 |
| Unchanged from today | `companies`, `app_accounts`, `workspace_revision_tokens`, and the three inventory capture tables | | | |

That is 33 tables; today there are 26.

- **Nothing calculated is stored.** Company amounts, SelBox-type amounts, differences, the SKUs behind an FNSKU and the warning are worked out when they are read (section 4). A payout report stores its totals and its pins, as today.
- **One preprocessing fills one group.** Each of the nine preprocessings writes the content tables of its own source and reads no other (rules 2). The bookkeeping tables are the same five for all of them. They hold no content, only which answer produced which version.
- **What goes away:** Data Kiosk's six tables; the category `FINANCES` / `SELBOX` / `DATA_KIOSK` / `ANALYSIS_ONLY`; `skus` and `sku_terms_versions`, replaced by the assignment tables; the three payout pin tables, replaced by two.
- **What happens to today's six Finances tables.** Their six roles stay. Five become the shared bookkeeping:

| Role | Today, for Finances | Here, for every versioned source |
| --- | --- | --- |
| The kept answer | `finances_acquisitions` | `source_acquisitions` |
| One successful preprocessing of an answer | `finances_preprocess_batches` | `source_preprocess_batches` |
| The unit that one version covers | `finances_transactions` | `source_units` |
| A version of a unit | `finances_transaction_versions` | `source_unit_versions`, plus the unit's own columns in `finances_transactions` or `ad_invoices` |
| The rows of a version | `finances_transaction_components` | `finances_amounts`, `ad_invoice_lines`, the three report tables, `inventory_ledger_rows` |
| Which versions each preprocessing saw | `finances_preprocess_batch_transactions` | `source_batch_units` |

## 2. How the source tables work

**Answer, batch, unit, version, row.** These five words carry the whole bookkeeping.

| Word | Meaning | Table |
| --- | --- | --- |
| Answer | one download from Amazon whose preprocessing succeeded. The answer itself stays in private storage, exactly as it came | `source_acquisitions` |
| Batch | one successful preprocessing of an answer, under one preprocessing version | `source_preprocess_batches` |
| Unit | what one version covers: the thing Amazon can change | `source_units` |
| Version | one state of a unit. A payout pins versions | `source_unit_versions` |
| Row | one row of a version, in the source's own table | sections 2 to 5 of the SQL |

**The unit of each source** (rules 5):

| Source | Unit | Its key |
| --- | --- | --- |
| Finances | one transaction | Amazon's transaction ID |
| Ad invoices | one invoice | the invoice ID |
| Storage | one month of charge | the month |
| Aged storage | one snapshot month | the month |
| Removal orders | one removal order | the removal order ID |
| Inventory ledger | one month | the month |

Every key is taken together with the seller account.

- **Content that did not change keeps its version** (rules 14). The store stage hashes each unit of the answer. The same hash as an earlier version of that unit reuses it; another hash is a new version. A return to earlier content reuses the earlier version, as today.
- **The hash leaves out** the preprocessing version, the download time and the position of a row in Amazon's answer. So a rule change that leaves a unit's rows as they were makes no new version and refreshes no payout.
- **Where the preprocessing version is.** On the batch. A unit points to its current version and to the batch that last saw it, and `source_batch_units` keeps which version every batch saw. Applying a new preprocessing version to a kept answer is a new batch on the same answer.
- **"Loaded"** means the unit exists and has a current version. "Asked, no rows" is a version without rows. That is how the database tells "ledger month not loaded" from "not in the ledger" (rules 8).
- **A failed preprocessing writes nothing.** Its answer stays in storage with a local log, as today, and the next preprocessing version can be applied to it.
- **An ID that Amazon does not know** is stored as an answer with the result `UNKNOWN_ID` and no rows.
- **Finances needs the batches for completeness,** as today: a month counts as complete only if a batch that was checked against `listSummary` saw the current version of every transaction of that month.

**How a row is told apart.** No set of Amazon's columns identifies a row, and two rows that are equal in every column both count (rules 5 and 14). So every row has a number inside its version:

| Table | The number | Order |
| --- | --- | --- |
| `finances_amounts` | `amount_number`, and `item_index` for the item it belongs to | Amazon's order inside the transaction, as today |
| `ad_invoice_lines` | `line_number` | campaign lines in Amazon's order, then adjustments in Amazon's order |
| the three report tables, `inventory_ledger_rows` | `row_number` | the unit's rows sorted by their own stored columns, then numbered from 1 |

- **Why report rows are sorted.** The position of a row in Amazon's file changes when another order is added above it. Sorting makes the number depend on the unit's own rows only, so the same rows always hash the same. Two equal rows get two consecutive numbers.

**"Worked out" columns.** Every column that the row's own preprocessing derives is marked so in the SQL (rules 2). Every other column of a source row is what Amazon gave. The database enforces only that the pieces a row needs are there; every check on Amazon's data is preprocessing's (rules 14).

**What is not a table.** The list of types, the tax table, the shape of an FNSKU, the six months of a liquidation item, and which country, time zone and advertising profile belong to a marketplace are assumptions about Amazon's data. They belong to preprocessing (rules 2). Rows carry their results, and the batch carries the preprocessing version.

**The one fixed list.** `currencies` holds the number of decimals of each currency, and it is the only place that states it.

- **The database** rounds the total of a key's rows with it before the comparison with Finances (section 4, rule 8). That rounded total is never stored.
- **Each preprocessing run is handed the same list,** for the tax of a report row and for the tax check (rules 9). The sync command reads it once at the start of a run.
- **Its rows are added, never changed or removed.** So applying a preprocessing version to a kept answer again gives the same rows.
- **A currency that is not on the list** fails preprocessing, and no row in such a currency can be stored, because every currency column points at the list.
- **No amount is rounded when it is stored,** with one exception that preprocessing works out: the tax part of a report row (rules 9).

## 3. The route of a Finances amount

`finances_amounts.route` takes the place of today's category. Preprocessing works it out from the type and stores it, so that a later change to the list of types never changes an amount a payout already pinned.

| `route` | The company comes from | What the row carries |
| --- | --- | --- |
| `SKU` | the SKU's assignment | `sku` |
| `FNSKU` | the ledger, by FNSKU, then the SKUs' assignments | `fnsku` and the ledger months |
| `ASIN` | the ledger, by ASIN, then the SKUs' assignments | `asin` and the ledger months |
| `PROMOTION` | the promotion's assignment | `reference_id`, if Amazon gave one |
| `SHIPMENT` | the shipment's assignment | `reference_id`, if Amazon gave one |
| `CUSTOMER_ORDER` | the SKUs on the sale and refund records of that order | `reference_id` |
| `AD_INVOICE` | the lines of that invoice | `reference_id`, if Amazon gave one |
| `STORAGE` | the storage rows of that marketplace and month | `covered_month` |
| `AGED_STORAGE` | the aged storage rows of that marketplace and month | `covered_month` |
| `REMOVAL_ORDER` | the rows of that removal order | `reference_id`, if Amazon gave one |
| `SELBOX` | no company: a SelBox type | `selbox_group` |

- **An amount on an ID route without an ID** is stored with an empty `reference_id`. The calculation shows it as a difference, "no ID on the charge".
- **A disposal or removal fee** gets `CUSTOMER_ORDER` when its order ID has the shape of a customer order, and `REMOVAL_ORDER` otherwise, also when it carries no order ID at all (rules 6).
- **Every amount of a liquidation item** gets `FNSKU`, its tax included (rules 6).
- **A sale or refund record names its customer order** in `finances_transactions.customer_order_id`. That is how a disposal fee on a customer return finds the SKUs.

## 4. The calculation

It runs on a **selection** of versions. For the screens that is the current version of every unit and of every assignment key. For a saved payout report it is the versions the report pinned. The steps are the same.

**The database's rules.** These are the only ones it holds, and they are lookups by keys the rows carry, and sums (rules 2):

| # | Rule | Reads |
| --- | --- | --- |
| 1 | Only amounts of records with `is_activity` count. | `finances_transactions` |
| 2 | The month of an amount is the month of `posted_date`. | `finances_transactions` |
| 3 | The SKUs behind an FNSKU or an ASIN are the ledger rows of the same seller account with that FNSKU or ASIN, in the months from `ledger_first_month` to `ledger_last_month`. | `inventory_ledger_rows` |
| 4 | The SKUs behind a customer order are the `sku` values on `SKU`-route amounts of the Finances records of the same seller account whose `customer_order_id` is that order. | `finances_transactions`, `finances_amounts` |
| 5 | A set of SKUs gives one company if every SKU has a company and it is the same one. | `assignment_versions` |
| 6 | A campaign, promotion or shipment has the company of its own assignment. | `assignment_versions` |
| 7 | Reference rows belong to the Finances charges that carry their key and have their currency. They take the date and marketplace of the earliest such charge. | "Keys" below |
| 8 | The rows of a key are summed as they are, and the sum is rounded half up to the currency's smallest unit before it is compared. | `currencies` |
| 9 | SelBox's service fee is `fee_base` times the SKU's rate for the marketplace and the posting date. | `sku_fee_periods` |

**Rule 5 in full,** used wherever several SKUs stand behind one amount or row (rules 6 and 8):

| The SKUs | Result |
| --- | --- |
| every SKU has a company, and it is the same one | that company |
| the SKUs that have a company belong to different companies | difference: split ownership |
| otherwise: at least one SKU has no company | difference: no assignment |
| no SKU at all, behind an FNSKU or ASIN, and a named month has no ledger version in the selection | difference: ledger month not loaded |
| no SKU at all, behind an FNSKU or ASIN, and every named month has one | difference: not in the ledger |
| no SKU at all, behind a customer order | difference: reference not found |

**Amounts that go by themselves.** A Finances amount on one of these routes has exactly one result, with its own amount and date:

| `route` | Result |
| --- | --- |
| `SKU` | rule 5 on its one SKU |
| `FNSKU`, `ASIN` | rule 3, then rule 5 |
| `CUSTOMER_ORDER` | rule 4, then rule 5 |
| `PROMOTION`, `SHIPMENT` | rule 6; blank is difference: no assignment; without an ID, difference: no ID on the charge |
| `SELBOX` | SelBox type, with its group |

**Amounts explained by reference rows.** The Finances amounts on these four routes are totals. The rows carry the money.

| `route` | Key | Rows of the key | A row's company |
| --- | --- | --- | --- |
| `AD_INVOICE` | seller account, invoice ID, currency | the lines of that invoice | rule 6 on its campaign; a line that names no campaign is a SelBox type, account fee |
| `STORAGE` | seller account, marketplace, covered month, currency | the rows of that month's unit with that marketplace | rule 3 on its FNSKU, then rule 5 |
| `AGED_STORAGE` | seller account, marketplace, covered month, currency | the rows of that month's unit with that marketplace | the same |
| `REMOVAL_ORDER` | seller account, removal order ID, currency | the rows of that order | the same |

For one key, base and tax separately, with a promo counted as base (rules 3 and 9):

| Result | Amount | Month and marketplace |
| --- | --- | --- |
| Company amount or SelBox type, one per row and part | the row's base or tax, turned to Finances's sign | of the key's earliest charge |
| Difference with the row's reason (split ownership, no assignment, not in the ledger, ledger month not loaded), one per row and part | the same | the same |
| Difference: rounding | the rounded sum of the rows minus their exact sum | the same |
| Difference: totals differ | all charges of the key minus the rounded sum of the rows | the same |
| Difference: charged in another month or marketplace, for each charge of the key that is not in the earliest charge's month and marketplace | that charge's amount | the charge's own |
| The same, once more with the opposite sign | minus the sum of those charges | of the key's earliest charge |
| Difference: reference not found, when the key has no rows at all | each charge's amount | the charge's own |
| Difference: no ID on the charge, when the charge carries no ID | the charge's amount | the charge's own |

- **These add up to the charges of the key, month by month.** So the total check of rules 3 holds by construction: for every seller account, marketplace, currency and month, the results sum to the Finances activity.
- **A row without an amount gives no result,** and a row whose key has no Finances charge is not a cost yet (rules 7).
- **The earliest charge** is the one with the earliest `posted_at`. Two at the same instant are ordered by transaction ID and then `amount_number`, so the result never depends on chance (rules 7).
- **The invented example of rules 3:** Amazon charges −4 in June and −6 in July for one removal order, and its rows give company A 10. June: company A −10, and a difference of +6, charged in another month. July: a difference of −6, charged in another month. "Totals differ" is (−4 − 6) − (−10) = 0.

**One result has these columns.** It is what the Transactions page, a payout report's records and the Financial review tab read.

| Column | Meaning |
| --- | --- |
| `outcome` | `COMPANY`, `SELBOX` or `DIFFERENCE` |
| `company_id` | on `COMPANY` |
| `selbox_group` | on `SELBOX` |
| `difference_reason` | on `DIFFERENCE`: one of the nine reasons of rules 3 |
| `origin` | which table the amount comes from: Finances, ad invoice, storage, aged storage or removal; or the key, for a difference that no row carries |
| `source_row_id`, `source_version_id` | the row and its version, when a row carries the amount |
| `seller_namespace`, `amazon_scope`, `marketplace_name`, `activity_date`, `currency` | |
| `amount_type`, `amount_part` | the type, and base or tax |
| `amount` | in Finances's sign, with Amazon's decimals |
| `sku`, `fnsku`, `asin`, `reference_id` | the identifiers on the row |
| `resolved_skus` | the SKUs that rule 3 or 4 found, so that the Financial review tab can name the SKU that needs a company |
| `fee_base`, `fee_rate_percent`, `fee_amount`, `company_amount` | SelBox's service fee and what is left for the company, as today. A missing rate is shown as missing; it is not a difference |

**Traced once.** A storage fee of −10.00 is posted in Amazon.de on 6 July, in the Europe account.

1. Finances preprocessing stores it with route `STORAGE` and `covered_month` June.
2. The key is Europe, Amazon.de, June, EUR. Its rows are the rows of the storage unit "Europe, 2026-06" whose `marketplace_name` is Amazon.de.
3. Each row names its FNSKU and the ledger month June. The ledger unit "Europe, 2026-06" names the SKU for that FNSKU.
4. The SKU's assignment names the company. The row's fee, turned negative, is that company's cost on 6 July.
5. What the rows do not explain of the −10.00 is a difference, each part with its reason.

## 5. Assignments

- **A key** is a SKU text, or a campaign, promotion or shipment ID with its seller account (rules 11). It is created when it is first assigned, and it points at no information table, so an ID without information can be assigned too.
- **A version** is one change, with a memo, the company, and who set it.
- **Blank** means: no key, no current version, or a current version without a company. A blank is always a difference.
- **Clearing.** An administrator can write a version without a company. The key is then without a company, and its amounts are differences, until an administrator sets one.
- **Fee rates** hang on a SKU's assignment version, per marketplace and period, as today. A payout that pins the version pins its rates.
- **The cron job writes only the first version of a key.** It never touches a campaign, promotion or shipment that has an assignment version, whoever wrote it, and so never one that an administrator set or cleared. Its version always names a company, and a SKU has none. The tables enforce all three.

## 6. Payout reports

`company_payout_reports` keeps today's shape: one company, one full month, one marketplace, one currency, with the frozen totals `source_amount`, `fee_amount` and `company_amount`. The totals are exact sums, as today; only the display rounds.

**A report pins every version its calculation read** (rules 12):

| Pinned | Which |
| --- | --- |
| Finances | every transaction of the report's month and marketplace, as today |
| Finances, outside the month | the other charges of a key that the month's charges carry, and the sale and refund records of a customer order that a disposal fee names |
| Ad invoices, storage, aged storage, removal | the unit of every key that the month's charges carry |
| Inventory ledger | the unit of every month that an amount or row of the report names, if it is loaded |
| Assignments | the version of every SKU, campaign, promotion and shipment that the calculation looked up |

- **Calculating a saved report again** from its pins gives the same records. A unit that was not loaded when the report was saved is not pinned, so it is not read, and the result is the same difference as then.
- **Reuse.** As today, a report is saved again only when its pins differ from those of the latest report of the same company, month, marketplace and currency.

**What holds a report back**

| Holds back | As today? |
| --- | --- |
| The month is younger than two calendar months | yes |
| Finances is not complete for the month, checked against `listSummary` | yes |
| A fee rate is missing for a sale of that company | yes |
| A missing reference, ledger month or assignment | no longer: it is a difference, and the report is saved without that amount (rules 12) |

**What asks for a report to be saved again.** No number of months is involved: a saved report is calculated again whenever something it read changes, or something arrives that it would have read, however old the report is. The store stage of a preprocessing and every assignment change mark company-months in `payout_report_refresh_state`, in the same step that stores the change. The worker then calculates them and saves a report only where the pins changed. So marking too many months costs time and never changes an amount.

| Change | Company-months marked |
| --- | --- |
| A unit gets another version | every report that pinned the earlier version |
| A Finances transaction, new or changed | its posting month, for every company, as today. If it carries a key or is a sale or refund of a customer order: also the posting months of the other charges of that key, and of the disposal fees that name that order |
| An invoice, a removal order, a storage or aged storage month, seen for the first time | the posting months of the Finances charges that carry its key, for every company |
| A ledger month, seen for the first time | the posting months of the charges whose amounts or rows name that ledger month, for every company |
| An assignment changes | every report that pinned its earlier version, and every month of the company it now names |

- **A company gets reports** once it has at least one current assignment of any kind. Today that is one assigned SKU.

## 7. Functions and jobs

| Name | What it does | Called by |
| --- | --- | --- |
| Store a batch | Writes the answer, the batch, new units and versions with their rows, and what the batch saw; moves the current pointers; marks payouts; all or nothing | the store stage of a versioned preprocessing |
| Store information | Replaces one campaign, promotion or shipment and its product list; writes its answer and batch | the store stage of an information preprocessing |
| ID list | Gives the IDs to ask Amazon about: every ID on a current money row that has nothing stored for it, and every ID on the money rows of the batches just stored (rules 2) | the sync run, before ad invoices, campaigns, promotions and shipments |
| Set an assignment | Writes a new assignment version and moves the key's pointer; marks payouts | an administrator, through the application |
| SKUs of a campaign, promotion or shipment | Gives its SKUs with their companies: the SKUs Amazon lists, and for a product listed by ASIN alone the SKUs the ledger names in all loaded months of the seller account | the two below |
| Fill default assignments | For every campaign, promotion and shipment that has information and has never been assigned: if its SKUs all have one and the same company, writes its first assignment version, marked automatic | a cron job |
| Warning | Lists every campaign, promotion and shipment that is blank, or whose SKUs point to another company or to several, with its SKUs and their companies. It includes IDs that are on money rows and have no information yet | the assignment screen |
| The calculation | Section 4, on current versions or on a report's pins | the Transactions page, payout reports, the Financial review tab |
| Monthly total check | Sums the results per seller account, marketplace, currency and month beside the Finances activity | the Financial review tab, and tests |

- **Three checks belong to the store stage,** because they need the rows already stored for the same source (rules 14):
  - Finances, as today: a transaction stored before and missing from a newer answer that covers its posting time fails the answer.
  - Finances, as today: an answer that would change whether a transaction stored from another answer is activity fails.
  - Removal orders: an order stored before and missing from a newer answer that covers its request date fails the answer.

**Who runs what**

| What | Run by |
| --- | --- |
| The nine preprocessings | an administrator, by a command of the sync service, about once a day. No schedule is designed. A command takes its period or its IDs; without a period it asks for the default period below. It reads the list of currencies once at its start and hands it to the preprocessing |
| Fill default assignments | a cron job in the database. How often is a setting |
| Payout worker | a cron job in the database, every five minutes, as today |

**How far back a preprocessing asks when no period is given.** Decided on 24 November 2026.

| Preprocessing | Amazon was seen to change it this late | Default period |
| --- | --- | --- |
| Finances | a held-back sale was released up to 60 days after it was posted. Today asks two calendar months back, which is 59 to 62 days | transactions posted since the same day three calendar months earlier: 89 to 92 days |
| Removal orders | an order changed up to 185 days after its request. Later than 212 days: none of the 280 orders old enough to show it, and none of the 216 requested more than a year before the download (rules 14) | orders requested since the same day twelve calendar months earlier: about twice the longest seen |
| Storage, aged storage | no later change was seen, and none was looked for | the three calendar months before the month of the run |
| Inventory ledger | a finished month did not change within two days; nothing longer was measured | the three calendar months before the month of the run. While no ledger month is stored for the seller account: every month Amazon still has, about 19 |
| Ad invoices, campaigns, promotions, shipments | asked by ID, not by period | none: the IDs of the ID list |

- **Days and months are taken in UTC,** from the day of the run, as today.
- **One request covers the whole period.** One answer held 8 months of storage rows, 9 of aged storage, 7 of the ledger and 25 of removal orders. So a longer period costs a larger download and no more requests: four report requests per seller account and run. The 25 months of removal orders were 568 rows for all seller accounts together, so twelve months is a small download.
- **These periods are settings of the sync service,** not rules of the database. Changing one changes no stored row, and an administrator can name another period for any run.
- **The Finances period is no longer the payout's wait.** Today one database function gives both: two calendar months. The payout still waits two calendar months (section 6); Finances is asked three back.
- **How long a saved report can still get a new version** follows from these periods, because recalculating has no period of its own (section 6). Counted from the day the report is first saved: at most about one month because of Finances, a storage or aged storage month or a ledger month; at most about ten months because of a removal order; at any time because of an assignment.
- **A change that comes later than its period is not silent where it carries money.** The new charge is in Finances, the stored rows no longer explain it, and that is a difference in the Financial review tab. Running that preprocessing for the period loads the change.

## 8. The five points the rules left to this design

| # | Point (rules 15) | Answer |
| --- | --- | --- |
| 1 | Does an assignment version record who set it? | Yes: `origin` says administrator or automatic, and `set_by` names the administrator. The cron job reads neither; it only asks whether a company is there. |
| 2 | When does each preprocessing run, and the cron job? | An administrator runs the preprocessings, about once a day; no schedule is designed. The default assignment and the payout worker are cron jobs (section 7). |
| 3 | Can an administrator remove a company without setting another? | Yes: a version without a company. Its amounts are then differences. The cron job never fills it in again, because it never changes an administrator's assignment; only an administrator sets a company. |
| 4 | How is a Finances item or a report row told apart? | By its number inside its version (section 2). Two equal rows have two numbers. |
| 5 | How far back is each report asked again? | Decided (section 7): Finances three calendar months; removal orders requested in the last twelve months; storage, aged storage and the ledger the last three finished months, and the whole ledger on the first run; no period for what is asked by ID. Recalculating a saved report has no period: it follows what changes (section 6). |

## 9. Choices made in this design

None of these was asked. Each follows a rule you set or what today's project does. Say so if one should be otherwise.

| # | Choice | Why |
| --- | --- | --- |
| 1 | The five bookkeeping tables are shared by all sources. | Today each source has its own six. With six versioned sources that would be 36 tables doing the same thing. A preprocessing still writes content only into its own tables. |
| 2 | The route is stored on each Finances amount. | A payout pins rows, not database rules (rules 2). A route looked up from the type at reading time would change pinned payouts whenever the list of types changes. |
| 3 | The list of types, the tax table, the shape of an FNSKU and the six months of a liquidation item are not tables. | They are assumptions about Amazon's data, so they belong to preprocessing (rules 2). |
| 4 | Pins are per report, as today, and a report pins everything its calculation read. | It keeps "calculate again from the pins" exact. |
| 5 | The table in section 6 that says which months are looked at again. | The rules say that late data refreshes the affected reports (rules 12), and something must say which ones when nothing was pinned yet. It errs on the side of looking at too many. |
| 6 | Report and ledger rows store the columns a rule or a screen reads, not every column of Amazon's report. | The whole answer is kept, so a column can be added later by a new preprocessing version without asking Amazon. |
| 7 | A company gets payout reports once it has any current assignment. | A company can own a campaign and no SKU. |

Six more choices came up while the tables were drawn and are written into the rules, marked † in rules 15: the currency is part of every key; a customer order is also found through a record that is not activity; the two ad adjustments without a campaign are account fees; a disposal or removal fee without any order ID is a difference; the aged storage unit is the snapshot month; a removal order missing from a newer answer fails that answer.

## 10. Where each rule landed

| Rules | Here |
| --- | --- |
| 2: one preprocessing per table; worked out on the row | sections 1 and 2; the columns marked "worked out" in the SQL |
| 3: activity; three outcomes; total check; reasons | `is_activity`; section 4 |
| 5: what each table holds; versions and units; empty answers; rows as they stand | section 2; SQL 1 to 6 |
| 6: routes; IDs keyed with the seller account; what counts as a SKU | section 3; the keys of SQL 1 and 7 |
| 7: keys; date and marketplace from the earliest charge | section 4, "Amounts explained by reference rows" |
| 8: the ledger, by month | `inventory_ledger_rows`; the ledger months on each row; rule 3 of section 4 |
| 9: tax | `amount_part` on Finances; `base_amount` and `tax_amount` on every reference row; the tax table itself is in preprocessing |
| 10: advertising | SQL 3; `campaigns` |
| 11: assignments, the cron job, the warning | section 5; section 7 |
| 12: payouts | section 6 |
| 14: the four stages; kept answers; preprocessing version | section 2; section 7 |

## 11. Not in these two files

- The preprocessing functions themselves: what each downloads, checks and works out is in rules 14, and their code is a later design.
- The calculation as SQL. Section 4 says what it does; its views and functions are written with the read functions.
- The read functions behind the Transactions page, the payout report drawer and the Financial review tab. They are rewritten on the results of section 4.
- The text of the row-level security policies. The model is today's: a member reads the `COMPANY` results and the reports of their own company; an administrator reads everything, including SelBox types, differences, the warning and the information tables.
- Migrations. They are written after all designs are agreed.
