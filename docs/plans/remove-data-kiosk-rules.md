# Rules for replacing Data Kiosk

Status: 24 November 2026. Nothing is open. The schema that follows these rules is in `remove-data-kiosk-schema.md`, with its tables in `remove-data-kiosk-schema.sql`.
Section 15 lists the decisions and what is postponed to the schema design, section 16 every assumption with its evidence, and section 17 every Finances type with its route.
Counts were measured between 19 and 24 November 2026, on the sample that section 13 describes. A minimal Amazon answer for each source, with every identifier replaced, is kept in `docs/evidence/remove_data_kiosk_2026-11-24/`.

## 1. Terms

| Term | Meaning |
| --- | --- |
| Seller account | One Amazon regional selling account with its own login: North America, Europe, Japan, Australia, Singapore. |
| Marketplace | One Amazon store inside a seller account, such as Amazon.de inside Europe. Every Finances transaction names one. |
| SKU | The seller's own product code. Ownership and fee rates follow the SKU text. |
| ASIN | Amazon's catalogue number of a product page. One ASIN can have several SKUs. |
| FNSKU | The code Amazon uses for a unit in its warehouses. Without an Amazon sticker it equals the ASIN, and then several SKUs can share it. |
| Finances charge | One item of a Finances transaction: the amounts that share one product or one ID. A transaction can hold several items, of different SKUs; a transaction without items is one charge. Amazon states the base and the tax of a fee separately, and on a few fees also a promo, which is a discount on that fee. |
| Type | What one amount of a charge is: product sale, referral fee, storage fee and so on. The types are today's list of 49, and the returns fee (section 17). |
| Money table | A table whose rows carry amounts: Finances, ad invoice lines, storage rows, aged storage rows, removal order rows. |
| Information table | A table that only describes a campaign, promotion or shipment. No amount is calculated from it. |
| Preprocessing | The step that downloads one Amazon source, checks it, and stores its rows (section 14). |
| Sync run | One pass that runs the preprocessings in order (section 14). |
| Reference rows | Rows from another Amazon source that explain a Finances charge with no product on it: ad invoice lines, storage rows, aged storage rows, removal order rows. |
| Inventory ledger | Amazon's record of the units it holds: which SKU each FNSKU belonged to, month by month. |
| Campaign | An advertising setup in Amazon Ads. Advertising is billed per campaign. |
| Promotion | A coupon or deal on chosen products for a period. |
| Shipment | One delivery of stock to Amazon's warehouses. |
| Removal order | An instruction to take units out of the warehouses: return, disposal or liquidation. |
| Returns fee | Amazon's fee for a product that is returned more often than the limit of its category. It names an ASIN and a period, and no SKU. |
| Product type | A type whose amount goes with the SKU on its item: the first row of section 17. |
| Key | What ties reference rows to their charges: an invoice, a marketplace and month, or a removal order (section 7). |
| Cost charge | A Finances charge of a cost type: storage, aged storage, removal, disposal, an inbound fee, advertising, a coupon or deal fee. Its company comes from an ID or from reference rows, not from a SKU on the charge. |
| Assignment | The decision that a SKU, campaign, promotion or shipment belongs to one company. An administrator makes it. For a campaign, promotion or shipment a default can be filled in first (section 11). |
| Warning | A list on the screen of the campaigns, promotions and shipments whose assignment is blank or no longer fits their SKUs (section 11). |

## 2. Principles

1. **Finances is the authority.** Nothing is an income or a cost unless Finances charged it, and every date comes from a Finances charge. Where reference rows explain a charge, the rows carry the amounts and the charge is the total they must meet (section 3).
2. **Tables store what Amazon gives.** SKU, FNSKU, ASIN and Amazon's IDs are stored as given. Beside them a row may hold what preprocessing works out from that same source by a checked rule (see "Who does what"). Nothing that needs a second source is stored.
3. **Matching happens in the database.** Rows are joined by Amazon's own IDs when amounts are calculated. A calculated company, converted SKU or difference is never stored on a source row.
4. **One preprocessing per table.** It may call several Amazon APIs for its table. It reads no other table and fills no other table. There is no exception: the default assignment of a campaign, promotion or shipment is its own step (see "Two steps beside preprocessing").
5. **Preprocessing asserts what was observed.** A value or shape not seen before fails preprocessing. There are no fallbacks.
6. **No splitting.** An amount goes whole to one company, or it does not go to a company.
7. **Tax is explicit.** Base and tax are always stated separately: by Amazon on a Finances charge, and by preprocessing on a reference row.
8. **Every amount that is activity has exactly one outcome** (section 3). A record that is not activity is stored and counted nowhere.
9. **Similar cases follow the same rule.**
10. **Nothing is deployed.** The database is designed from scratch; no existing data is kept.

**Who does what**

| | Preprocessing | Database |
| --- | --- | --- |
| Question it answers | What did Amazon say? | Whose amount is it? |
| Sees | one Amazon source | every table and the assignments |
| Does | downloads; checks the shape against the observed rules; stores rows as Amazon gives them; works out what that source alone can tell | matches rows by ID; turns an FNSKU or an ASIN into SKUs through the ledger; finds the company; applies fee rates; decides the outcome |
| Rules it holds | assumptions about Amazon's data, which can change | lookups by keys the rows carry, and sums, which do not change |
| How a rule change is recorded | a new preprocessing version on every row it produced | it is not recorded, so these rules must not need changing |
| Runs | when data is downloaded | every time amounts are calculated |
| When something is wrong | fails: no row of that answer is stored, and Amazon's answer itself is kept | never fails; an amount that cannot reach a company becomes a difference |

**Two steps beside preprocessing**

Two steps look at other tables: the ID list, inside the sync run, and the default assignment, a cron job of its own. Neither is part of a preprocessing, neither decides what a row says, and neither can fail a preprocessing, so neither breaks principle 4.

| Step | When | What it does | What it reads | If it finds nothing |
| --- | --- | --- | --- | --- |
| ID list | in the sync run, before the preprocessing of ad invoices, campaigns, promotions and shipments | hands that preprocessing the IDs to ask Amazon about | the IDs on money rows: invoice, promotion and shipment IDs from Finances; campaign IDs from ad invoices | the invoice or the information is not downloaded yet, and the charge is a difference until it is |
| Default assignment | on its own schedule, as a cron job; it is not a step of the sync run | writes the first assignment of a campaign, promotion or shipment that has never been assigned, as an administrator would (section 11) | the database's answer to "which companies do its SKUs point to?" | the assignment stays blank, and it looks again at its next run |

- **A row still depends on its own source only.** The same Amazon response and the same preprocessing version give the same row, whatever the other tables hold.
- **The decimals of a currency are one fixed list, in the database.** The database rounds with it (section 3), and each preprocessing run is handed the same list for the tax of a report row and for the tax check (section 9), as it is handed a period or a list of IDs. The list is not an Amazon source, and its rows are added but never changed or removed, so a row still depends on its own source only. A currency that is not on the list fails preprocessing; there is no fallback to two decimals.
- **Why the ID list exists.** Amazon gives a promotion's information when asked with its promotion ID, and the IDs are known from Finances rows only. The same holds for ad invoices (invoice IDs from Finances advertising charges), campaigns (IDs from ad invoices) and shipments (IDs from Finances).
- **Which IDs it hands over:** every ID on a money row that has nothing stored for it yet, and every ID on the money rows stored in this run. It goes by what is stored, so an ask that failed is repeated at the next run.
- **The order within a sync run** follows from this (section 14).
- **Invented example of the ID list.**
  1. Finances preprocessing stores a coupon fee. It carries promotion ID P1 and nothing else about the promotion.
  2. The sync run finds P1 in the Finances table, with no promotion row yet.
  3. Promotions preprocessing is handed P1, asks Amazon "what is P1?", and stores the answer. It never opens the Finances table. What the promotion row says comes from Amazon's answer alone.

- **Each preprocessing is its own function, and running it again is always safe** (section 14). An administrator runs them, about once a day; no schedule is designed.
- **Rule of thumb:** a step that needs only its own source belongs to preprocessing; a step that needs a second table belongs to the database.
- **No assumption in the database.** When a lookup in a second table depends on an assumption, the row's own preprocessing works out the keys of the lookup and stores them. The database only uses the keys.
- **Worked out in preprocessing and stored on the row:** the type of each amount and the kind of each ID, whether the record is activity, the amount SelBox's service fee applies to, base and tax (section 9), the month a storage charge covers (section 7), the ledger months a row names (section 8), the marketplace of a report row's country, and the campaign of a named ad adjustment (section 10).
- **Why there:** a payout pins rows, not database rules. A value stored on a row stays what it was when a rule changes later.

## 3. The three outcomes of an amount

**First: is the record activity?** This is today's rule, unchanged. Two kinds of record are stored and counted in no total:

| Not activity | Seen in the sample of 64,840 transactions |
| --- | --- |
| A bank transfer | 59 |
| A release copy: a record that carries the ID of the deferred transaction it releases, or that another transaction names as its release | 30,054; for 27,704 the original is in the sample too |

- **Why it matters.** Amazon holds back many sales and releases them later. The sale then appears twice: the original and the release copy. Counting both would pay every such sale twice.
- **How Amazon shows it.** A record is posted with the status DEFERRED when Amazon holds its money back, and RELEASED when it does not. When Amazon releases a deferred record, it changes that same record to DEFERRED_RELEASED and adds a second record: the release copy, with the status RELEASED and the ID of the original.
- **The original counts, on its own posting date,** whether its status is deferred or released. The status never decides. A release copy is posted a median of 8 days after its original and 60 days at most, and 5,952 of 27,704 fall in another month. So a held-back sale belongs to the month of its original. Because a release comes up to 60 days late, Finances is asked three calendar months back by default (section 14); today's two calendar months are 59 to 62 days.
- **Checked against Amazon's own totals.** For 10 to 16 August 2026, Amazon's `listSummary` equals the sum of the activity on 18 of 18 marketplace-and-currency totals. With the release copies added, it is wrong wherever there is one.
- **A status change does not change the result.** Japan's 21 to 30 September 2026 was downloaded again on 24 November and compared with an older copy:

| Compared | Result |
| --- | --- |
| Records that were DEFERRED in the older copy | 179, all DEFERRED_RELEASED now |
| What changed on them | the status, the ID of the release copy (added), and on 166 a context field; not the amount, not the date |
| Records whose activity flag changed | 0 of 587 |
| Total of the complete days, from either copy | −¥55,102, which is Amazon's own total |
| The same total without the records still deferred then | −¥147,586, which is wrong |

- **A changed record is a new version of the same transaction,** as today, and a payout that used the older version is refreshed. Amounts can change too: 1 of 301 released records had another amount in the second download.
- **What Finances preprocessing checks, as today.** The status is one of the three. A record never carries both links. A release copy has the status RELEASED. An original and its release copy in the same answer name each other and agree on marketplace, account type, transaction type, amount and currency. In the sample all 30,054 release copies are RELEASED and carry their own link, and all 27,704 pairs agree.
- **Today's code looks twice.** It works the flag out from the download alone, and again together with the stored transactions when the download is published; if a stored transaction's flag would change, the publication stops. The second look only matters for a release copy that its original names and that carries no link of its own. None was seen: by its own link alone, every one of the 64,840 records gets the same flag.
- **Which records were deferred:** sales (29,583 release copies), refunds (430), liquidations (40) and one adjustment. Every cost charge had the status RELEASED and no link.

**Then: one of three outcomes**

| Outcome | What it is | Who bears it | Where it shows |
| --- | --- | --- | --- |
| Company amount | The amount reaches one company. | The company | Payout report |
| SelBox type | An account-level amount: a fee, a credit or a balance movement whose type never names a product, campaign, promotion or shipment. | SelBox | SelBox category |
| Difference | An error. The amount belongs to some product or company, but the data cannot take it there. | SelBox absorbs it | Financial review tab |

- **SelBox type and difference are never mixed.** A difference is never recorded as a SelBox type.
- **The test between the two.** If the type never names a product or an ID, it is a SelBox type. If the type normally does and this one record cannot be followed, it is a difference. A storage fee adjustment never names a product: SelBox type. An inbound fee normally names its shipment: without the ID it is a difference.
- **A difference goes away when its cause does.** When the missing data arrives or a rule is fixed, the amounts are calculated again. Some causes never go away, and those differences stay with SelBox (section 13).

**The total check**

For every seller account, marketplace, currency and month:

`company amounts + SelBox-type amounts + differences = Finances activity`

- **Finances activity** is the sum that today's check already compares with Amazon's own `listSummary`.
- **The differences of a month are what is left of that month's Finances total.** So the check always holds, and each difference still has its reason.
- **A reference row can be dated in another month than a charge of its key.** A removal order charged in pieces is the case: all its rows take the date of the earliest charge. The first month then shows a positive difference, because the company bears more there than Amazon charged, and the later month the same amount as a negative one, both with the reason "charged in another month or marketplace". They sum to zero. Invented example: Amazon charges −4 in June and −6 in July, and the rows give the company the whole −10 in June. June: −4 − (−10) = +6. July: −6 − 0 = −6. In the sample: 12 of 105 orders are charged in two months, with £62.35 of £469.19 and ¥2,040 of ¥5,050 dated earlier than charged. The same holds across marketplaces: 5 orders are charged in two marketplaces, always Germany with France or Spain, in one currency.

**Definition of a difference**

For one Finances charge, in Amazon's own amounts, base and tax separately. A promo counts with the base (section 9). Where reference rows explain several charges together, because the charges share one key (section 7), it is worked out once for those charges together:

`difference = charge − SelBox-type amounts − amounts attributed to a company`

- **Per key first, then per month.** Where the charges of one key fall in different months or marketplaces, the key's difference is worked out once, and each month then shows its own part of it (see "The total check").
- **Attributed** means the calculation reaches exactly one company for that amount.
- **It is about Amazon's money only.** SelBox's own service fee is not part of it.
- **Signs.** Every amount of the total check and of this formula is in Finances's sign: money to the seller is positive, and a cost is negative. A reference row prints a cost as a positive amount and is stored as Amazon prints it. The calculation turns the row's amount, once, when it reads the row.
- **It is calculated, never stored,** and it can be negative or positive. A negative difference is a cost that reached no company, and SelBox bears it. A positive difference means the companies bear more in that month than Amazon charged in it: the rows of a key sum to more than its charges, or a later month holds part of the charge.
- **Rounding.** Storage rows carry up to four decimals. The rows of a key are summed as they are, and the total is rounded half up to the smallest unit of the currency before it is compared: equal on 22 of 22 country-months, 11 of them only after rounding. What the rounding leaves, always under one unit per key, is a difference with the reason "rounding". This is the only rounding the database does. A report row's tax is rounded by preprocessing when the row is split (section 9), and what that leaves against Amazon's own tax is "totals differ". Both take the smallest unit from the one list of currencies (section 2). No amount that Amazon gives is rounded when it is stored, and no calculated amount is rounded: a company's amount is the exact amount of its rows.

| Kind of charge | Attributed amount | So the difference is |
| --- | --- | --- |
| The company comes from the charge itself: SKU, FNSKU, ASIN, promotion, shipment, customer order | the whole amount if one company results, otherwise nothing | all or nothing, with one reason |
| The charge is explained by reference rows: advertising, storage, aged storage, removal | the sum of its rows that reach a company | the rows that reach neither a company nor a SelBox type, each with its reason, plus whatever no row explains |

Invented example, a storage charge of −10.00:

| Row | Amount the row prints | Result |
| --- | --- | --- |
| FNSKU 1 | 4.00 | company A, −4.00 |
| FNSKU 2 | 3.00 | company A, −3.00 |
| FNSKU 3 | 2.50 | difference −2.50: split ownership |
| FNSKU 4 | 0.25 | difference −0.25: no assignment |
| not on any row | | difference −0.25: totals differ |

Attributed −7.00, difference −10.00 − (−7.00) = −3.00.

**SelBox types**

They are today's list, with today's three groups. Section 17 gives the counts.

| Group | Types |
| --- | --- |
| Account fee | subscription, EPR, supply chain (MCF) credit, Vine, other adjustments; the two ad invoice adjustments that name no campaign |
| Balance movement | debt recovery, cross-account adjustment, reserve movement |
| Tax reclassification | tax reclassification, which is what a retrocharge is |

- **A bank transfer** is the payout to the bank. Today's list files it under balance movements too, but it is not activity (above), so it has no outcome and is no one's cost.
- **"Other adjustments"** were 3 failed bank transfers that came back and 1 storage fee adjustment that names no product.
- **Two SelBox types come from an ad invoice, not from Finances:** the adjustments "Applying Over Delivery Click Credits" and "Rounding Adjustment" (section 10). They belong to the group account fee, and they count on the date of the invoice's Finances charge.
- **Changed from today's list:** two routes (section 17).

**Reasons for a difference**

| Reason | Example |
| --- | --- |
| Reference not found | A storage charge whose report is missing or late; a disposal fee whose customer order has no sale or refund in Finances. |
| Totals differ | The rows of a charge do not sum to its base or its tax. |
| Not in the ledger | A row whose FNSKU, or for a returns fee whose ASIN, the ledger does not name in its months, although all of them are loaded. |
| Ledger month not loaded | A row whose months name no SKU, while at least one of them is not loaded yet (section 8). |
| Split ownership | The SKUs behind one row belong to different companies. |
| No assignment | A SKU, campaign, promotion or shipment that has no company yet. A row with several SKUs behind it counts too, when one of them has no company. |
| No ID on the charge | A charge whose type needs an ID and carries none. Seen only on inbound charges (section 6). |
| Charged in another month or marketplace | A removal order charged in pieces: its rows take the date and the marketplace of the earliest charge (see "The total check"). |
| Rounding | What is left, under one smallest unit, after the total of a key's rows is rounded to the currency. |

**No amount waits for an assignment.** An amount that cannot reach a company is always a difference with its reason. The Financial review tab is therefore also the list of what is left to assign.

**A missing fee rate is not a difference.** The sale has reached its company; what is missing is the rate of SelBox's own service fee. That company's payout report for the month cannot be calculated until the rate exists, as today. No other company is affected.

**SelBox's service fee is unchanged.** It applies to the product price of a sale or a refund and to nothing else: not to shipping, tax, discounts or Amazon's fees. A refund reduces it. The posting date of the original record, in the marketplace's local time, picks the rate. Finances preprocessing stores this amount on the row, as today.

## 4. Amazon sources

| Table | API and operation | Asked by | One answer covers |
| --- | --- | --- | --- |
| Finances | Finances v2024-06-19: `listTransactions`, `listSummary` | posting period | one seller account |
| Ad invoice lines | Amazon Ads billing: `GET /invoices/{invoiceId}` | invoice ID | one invoice |
| Storage rows | Reports v2021-06-30: `GET_FBA_STORAGE_FEE_CHARGES_DATA` | month of charge | one seller account |
| Aged storage rows | Reports: `GET_FBA_FULFILLMENT_LONGTERM_STORAGE_FEE_CHARGES_DATA` | snapshot period | one seller account |
| Removal order rows | Reports: `GET_FBA_FULFILLMENT_REMOVAL_ORDER_DETAIL_DATA` | request date of the order | one seller account |
| Inventory ledger | Reports: `GET_LEDGER_SUMMARY_VIEW_DATA`, with monthly rows per country | finished month | one seller account |
| Campaigns | Ads API v1: `POST /adsApi/v1/query/campaigns`, `/query/ads` | campaign ID | one campaign, asked through the advertising profile of its marketplace |
| Promotions | Promotions v2025-12-01: `getPromotion` | promotion ID | one promotion |
| Shipments | Fulfillment Inbound v0: `getShipments`, `getShipmentItemsByShipmentId` | shipment ID | one shipment |

- **A report is per seller account, whatever marketplace the request names.** Asked once for Germany and once for the United Kingdom, the Europe storage report gave the same rows (385 of 385 and 273 of 273), and so did the Europe removal report (203 of 203). The same holds for the United States against Canada: storage 698 of 698, aged storage 120 of 120. So each report is asked once per seller account. Asking per marketplace would store every row twice.
- **None of these is on Amazon's deprecation lists** (read on 23 November 2026: the SP-API page, last updated 9 September 2026, and the Amazon Ads page). Fulfillment Inbound v0 has ten operations removed; `getShipments` and `getShipmentItemsByShipmentId` are not among them. The newer inbound version has no lookup by shipment ID.
- **One announced change touches a source.** Amazon Ads is replacing the Sponsored Brands setting `productCollectionSettings` with `manualCollectionSettings` and `autoCollectionSettings`, with shutoff in January 2027. 24 of the 37 Sponsored Brands products in the sample sit under the old name. A new name is an unseen shape, so campaign preprocessing fails on the first one and is extended then (section 10).

Not used: Data Kiosk, the ad cost report, the ledger receipts report, the FBA Inventory API, listings search.

## 5. What each table holds

| Table | One row is | Identifiers, as Amazon gives them |
| --- | --- | --- |
| Finances | one amount of a charge: base, tax or promo | SKU and ASIN; or FNSKU (liquidation); or ASIN alone (returns fee); or the ID the charge refers to |
| Ad invoice lines | one campaign's cost on an invoice, or one adjustment | invoice ID, campaign ID |
| Storage rows | one row of the storage fee report: an FNSKU's fee in a warehouse for a month | FNSKU, ASIN, country, month |
| Aged storage rows | one row of the aged storage report: an FNSKU's fee at a snapshot | FNSKU, ASIN, the SKU the report prints, country, snapshot date |
| Removal order rows | one row of the removal order report: a product of a removal order | removal order ID, FNSKU, the SKU the report prints |
| Inventory ledger rows | one row of Amazon's monthly report: one FNSKU of one SKU in one month, per condition and country | seller account, month, FNSKU, SKU, ASIN, condition, country |
| Campaigns, promotions, shipments | the latest information Amazon gives | their Amazon ID; the product list, with the SKU, ASIN or FNSKU that Amazon names |
| Assignments | the company of a SKU, campaign, promotion or shipment, with its history | SKU text, or the Amazon ID |

- **Everything a payout report reads is versioned:** the money tables, the inventory ledger and the assignments. A payout pins the exact versions it used. Where nothing ever changes, there is simply one version.
- **What one version covers.** The latest answer replaces the earlier rows of the same unit, so no row is counted twice when periods overlap:

| Table | Unit that the latest answer replaces |
| --- | --- |
| Finances | one transaction, as today |
| Ad invoice lines | one invoice |
| Storage rows | one seller account and month of charge |
| Aged storage rows | one seller account and snapshot month |
| Removal order rows | one seller account and removal order |
| Inventory ledger | one seller account and month |

- **One aged storage snapshot a month.** Every month of the saved reports has one snapshot day, the 14th or 15th (35 of 35 account-months). So the unit is the month, and a month that gave no rows can be stored under it too. Two snapshot days in one month fail preprocessing.
- **An empty answer is an answer.** Amazon cancels a report request when the period has no data. That is stored as "asked, no rows", so the period counts as loaded. Seen once: a Singapore month without storage.
- **Rows without an amount are stored too.** They are not costs.
- **A report row is stored as it stands, and every row counts.**
  - Rows can share their identifiers. Month, FNSKU and warehouse are shared by several storage rows on 205 of 6,218 combinations; order, FNSKU and condition by several removal rows on 9 of 558; snapshot, FNSKU and country by several aged storage rows on 27 of 194, which differ in their age tier.
  - Two rows can even be equal in every column: 8 storage rows and 6 removal rows. Both count. One removal order with such rows was charged: with both rows it equals Finances (5.69), with one it does not (4.95). The storage amounts are too small to tell.
  - So no set of columns identifies a row. How a row is told apart is left to the schema design (section 15).
- **A date on a report row is an instant.** Amazon prints it with a time offset that changes from one download to the next: the same Europe removal rows carried +05:30 on 21 November 2026 and +03:00 on 23 November, the same instant both times (7 of 7 rows). Preprocessing stores the instant. Two downloads are compared by instant, never by the printed text.
- **Information tables are not versioned.** The calculation never reads them. The default assignment and the warning read their product lists (section 11).
- **Asked for the first time** in the sync run that first stores a money row with the ID. Before that nothing is charged, so nothing needs a company.
- **Asked again** whenever a sync run stores new money rows with its ID. It can also be asked at any other time, because its preprocessing is a separate function. Measured:

| | First money row with its ID | Product list afterwards | New money rows afterwards |
| --- | --- | --- | --- |
| Promotion | its first coupon or deal fee: 14 to 41 days after the promotion starts (median 15), and after it ended on 22 of 22 | never revised: Amazon's revision number is 1 on 22 of 22 | none: all fees of a promotion are posted within one day |
| Shipment | its first inbound fee (timing not measured) | Amazon gives no change date; all 38 were closed when asked | a few fees |
| Campaign | its first ad invoice (timing not measurable in the sample) | it grows: 46 of 148 campaigns gained a product more than a week after they were created, and at least 24 of 118 after they were first billed | a median of 5 invoices per campaign and month, up to 22 |

- **A SKU the report prints** on an aged storage or removal row is kept as information. Money never follows it: it is not among the SKUs the ledger names on 8 of 237 aged storage rows and 120 of 358 removal order rows.

## 6. How each Finances charge finds its company

| Finances charge | Company amounts come from | Company comes from |
| --- | --- | --- |
| Sales, refunds, FBA fees and other rows with a SKU | Finances | the SKU's assignment |
| Liquidation proceeds and fees (FNSKU in the SKU field) | Finances | FNSKU → SKU (section 8) → the SKU's assignment |
| Returns fee (an ASIN, no SKU) | Finances | ASIN → SKU (section 8) → the SKU's assignment |
| Coupon and deal fees | Finances | the promotion's assignment |
| Placement, transport, labeling, inbound defect | Finances | the shipment's assignment |
| Disposal fee on a customer return | Finances | the SKUs on the sale or refund rows of that customer order → their assignment |
| Advertising | ad invoice lines | the campaign's assignment |
| Monthly storage | storage rows | FNSKU → SKU → the SKU's assignment |
| Aged storage | aged storage rows | FNSKU → SKU → the SKU's assignment |
| Removal and disposal by removal order | removal order rows | FNSKU → SKU → the SKU's assignment |
| SelBox types (section 3) | Finances | none |

- **The type of an amount chooses its route** (section 17). Two cases look one step further: a disposal or removal fee goes by the kind of order ID it carries, and every amount of a liquidation item goes with the item. An identifier that the route does not use is stored and never read.
  - A product type must carry a SKU; without one, Finances preprocessing fails, as today. All 410,222 product amounts of the sample carry one; the 130 amounts of liquidation items carry an FNSKU instead. 12 of those 130 are product tax, a product type; on a liquidation item it follows the FNSKU like the rest.
  - No cost type and no SelBox type carried a SKU in the sample.
- **A liquidation item** is an item that holds a liquidation proceeds amount. Every amount of that item takes the FNSKU route: proceeds, fee and tax. There are 59 such items, 16 of them with a tax amount. Today's list files the tax of a liquidation adjustment under tax reclassification, a SelBox type, while the tax of the liquidation itself goes with the product; a reversed liquidation would leave its tax with the company. Seen: 4 such tax amounts, −£1.60 in all. An item with an FNSKU in its SKU field and no proceeds amount was not seen (0 of 59), and fails preprocessing.
- **Several SKUs behind one row** (an FNSKU shared by two SKUs, a customer order with several SKUs): if they all belong to one company, that company. Otherwise the amount is a difference.
- **A SKU without a company is not ignored.** If one of the SKUs behind a row has no company, the amount is a difference (no assignment), even when the other SKUs agree. It goes away when that SKU gets the same company as the others.
- **Which reason is shown.** If the SKUs that have a company already belong to different companies, the reason is split ownership, because assigning the missing SKU would not resolve it. Otherwise it is no assignment.
- **A disposal fee on a customer return** names the customer order. The database takes the SKUs on the sale and refund rows of that order in the same seller account. Of 194 such fees, 126 found a sale row, 3 only a refund row, and 65 nothing; every order found names exactly one SKU. All 30 that were checked of the 65 are orders outside the sampled months. A sale or refund record is read here for its SKU only, so one that is not activity serves too.
- **Types outside the sample, or outside today's list.**
  - Vine: on today's list, a SelBox type, and it needs no ID. It keeps that route.
  - Lightning deal fee: on today's list from 2024 records, but its route needs a promotion ID and no record was at hand to show where the ID is. It fails preprocessing until one is examined.
  - Three shapes are in old sample weeks and not on today's list (section 13). The returns fee is added with this change, by the rule below. The other two fail preprocessing until they are added.
- **A returns fee is looked up in the ledger by its ASIN.** Amazon introduced it in June 2024 and still charges it: per returned unit, for a product whose return rate is above its category's limit. It names an ASIN and a period, with a start and an end, and no SKU, FNSKU or order.
  - **Same table, same rule, another key.** Every ledger row holds month, FNSKU, SKU and ASIN, so no ASIN table is added. Finances preprocessing stores the ASIN and the months the fee names: every month from the month of its start to the month of its end, in the marketplace's local time like every Finances date. Section 8 decides the outcome.
  - **The period is Amazon's.** On the four fees found it ran from the first day of one month to the last day of the third, and ended the month before the fee was posted. The rule does not rely on that length.
  - **Rare here.** Asked from Finances for the US, days 6 to 16 of every month from December 2024 to November 2026: 4 fees in 24 months, $47.80 in all, for 2 products, each posted on the 7th, and none since June 2025.
  - **An ASIN names several SKUs more often than an FNSKU does.** Over three months of the ledger: 114 of 771 cases for an ASIN, against 11 of 878 for an FNSKU. The rule already covers it: one company if they agree, a difference if not.
  - **Tested on the four fees.** All four ASINs are in the ledger. Two fees have a month of their period in the ledger files held, and there the ledger names one SKU. The other periods are older than the files held.
- **An inbound charge without a shipment ID** is a labeling or carrier fee for one specific shipment whose Amazon record lacks the ID. It is not account-level by nature, so it is a difference. 10 charges in 6 transactions were seen: two Japanese labeling charges, and in Germany and the United Kingdom four transport and four transport program charges. In total €61.48, £20.87 and ¥17,094.
- **An inbound defect fee** follows its shipment's assignment, like the other inbound fees. It is what Amazon charges when a shipment is not sent or prepared as agreed. One was seen: £169.80 without tax, posted on 12 July 2026 in the United Kingdom, with the shipment ID in the order ID field. Without a shipment ID it is a difference, like every inbound charge without one.

**Two ways to the company**

| | Followed through to the SKUs | Own assignment |
| --- | --- | --- |
| Used for | an FNSKU or an ASIN, through the ledger; a customer order, through its sale or refund rows in Finances | a campaign, promotion or shipment |
| Why | Amazon's own dated records tie it to SKUs, so there is nothing to decide | the seller sets it up, it can cover products of several companies, and Amazon often lists its products by ASIN only; someone must be able to say who bears it |
| Stored | nothing; it is worked out at every calculation | an assignment version (section 11) |
| Several SKUs of different companies | difference: split ownership | blank, which is a difference, until the SKUs agree and the cron job runs, or an administrator assigns a company |
| One of several SKUs has no company, the others agree | difference: no assignment, until that SKU has the same company | blank, which is a difference, until that SKU has the same company and the cron job runs, or an administrator assigns a company |
| A SKU moves to another company | the amounts follow at once, for all dates | the assignment stays; the warning shows it |

**Where Finances carries each ID**

| Charge | ID and where it is | Checked |
| --- | --- | --- |
| Advertising | invoice ID, on the item | 289 of 289 charges; the invoice is stored for all |
| Coupon and deal fees | promotion ID, in the order ID field of the transaction | 6 of 6 and 35 of 35; the promotion is stored for all |
| Inbound fees | shipment ID: in the order ID field (25 charges), else in the shipment ID field (6), else after a colon in the item ID (34) | 65 of 75 charges carry one, and the shipment is stored for all 65; 10 carry none |
| Removal and disposal | removal order ID, in the order ID field | 348 of 348 charges; the order is in the report for all |
| Disposal on a customer return | customer order ID, in the order ID field | 194 charges; 129 orders found in Finances |
| Storage, aged storage | no ID; the key is marketplace and month | 523 and 85 charges |

- **A shipment ID in two places.** Where two places held an ID, they agreed (6 of 6). Two places that disagree fail preprocessing.
- **Customer order or removal order.** An order ID of three, seven and seven digits is a customer order. Any other is a removal order ID; a seller can type one freely. No removal order of the reports has the shape of a customer order (0 of 426), and one that does fails removal preprocessing. A disposal or removal fee without any order ID goes the removal order way, where it is a difference, "no ID on the charge".
- **Every Amazon ID is keyed together with its seller account.** No ID appeared in two seller accounts: 0 of 34,732 customer orders, 289 invoices, 105 removal orders, 22 promotions and the 17 shipment IDs carried in the order ID field. A removal order ID can be typed by the seller, so it could repeat.

**Which values count as a SKU**

A rule that says "SKU" reads only a value that its own preprocessing stored as a SKU. An FNSKU or an ASIN is never read as one.

| Source | Amazon's field | Stored as | Checked |
| --- | --- | --- | --- |
| Finances, liquidation items | sku | FNSKU | all 59 items hold an FNSKU, and none carries an ASIN |
| Finances, every other item | sku | SKU | 64,462 items: none is an FNSKU, and none equals the ASIN on its item |
| Inventory ledger | MSKU and FNSKU, two columns | SKU and FNSKU | 97 SKUs and 85 FNSKUs in five accounts: no value is both |
| Campaign products | SKU | SKU | 105 SKUs: none is an FNSKU |
| Promotion products | SKU | SKU | 24 SKUs: none is an FNSKU |
| Shipment items | SellerSKU and FulfillmentNetworkSKU, two fields | SKU and FNSKU | 15 SKUs, none an FNSKU; 13 FNSKUs, all in the ledger's FNSKU column |
| Removal order rows, aged storage rows | sku | information only; no rule reads it | 568 and 243 rows: none is an FNSKU |
| Storage rows | none; the report has no SKU column | | |

- **What "is an FNSKU" meant in the check:** the value is an FNSKU of any account's ledger, or it has the shape of one.
- **The shape of an FNSKU.** In the ledger an FNSKU is "X0" and eight capitals or digits (39 of 85), or it is the product's ASIN, "B0" and eight (46 of 85). No SKU in any source has either shape.
- **Asserted in each preprocessing, on its own source.** A value stored as a SKU must not have one of the two shapes, and must not equal the ASIN or FNSKU on its own row. A value stored as an FNSKU must have one of the two shapes. Otherwise preprocessing fails.
- **Its limit.** A seller may name a SKU in one of the two shapes. None was seen. If it happens, preprocessing fails and the rule is looked at again.
- **ASIN → SKU reads the ledger's SKU column,** which never holds an FNSKU (the table above).
- **A SKU is compared by its exact text, and one product can have several.** One product in the warehouse has one FNSKU, and a seller can offer it under several SKU texts. The ledger names one of them for the FNSKU in a month; a sale, an ad or a promotion names whichever text was used. Of the 16 SKUs that Finances names and the ledger does not hold, 10 are in the ledger under another text for the same ASIN; one pair differs only by "_" against "-". They are different SKUs, and each needs its own assignment. The other 6 are products whose ASIN the ledger months held do not have at all (48 rows).
- **The SKU the ledger names is not always a SKU that sells.** Checked on the 2,598 storage rows with a fee of June to September 2026, months that Finances and the ledger both cover:

| | SKUs |
| --- | --- |
| SKUs those storage rows lead to, through the ledger | 56 |
| Also named by a Finances row | 39 |
| In no Finances row: the product sells under another SKU text | 6 |
| In no Finances row: the product is in the warehouse and has no sale | 11 |

  - 822 of the 2,598 rows name one of those 17 SKUs.
  - Each of the 17 needs its own assignment. Until it has one, its storage fee is a difference (no assignment), and the Financial review tab names the SKU.
  - Invented example: a product sells as SKU "A_1", which belongs to company A. The ledger holds its stock under SKU "A-1". A storage fee of −2.00 leads to "A-1", which has no company, so the −2.00 is a difference. Once "A-1" is assigned to company A, the −2.00 is company A's cost, for past months too.

## 7. Matching reference rows to Finances

| Charge | Key | Checked: the rows against what Finances charged |
| --- | --- | --- |
| Advertising | seller account + invoice ID | 289 of 289 invoices: lines plus adjustments equal the base, and the invoice's tax equals the tax |
| Monthly storage | seller account + marketplace + the month before the posting month | 22 of 22 country-months: the rows equal the base |
| Aged storage | seller account + marketplace + the posting month | 18 of 20 country-months (section 13 has the two) |
| Removal and disposal | seller account + removal order ID | 105 of 105 orders: the rows equal base plus tax plus promo |

- **Several charges of one key** are taken together: the rows are compared with their sum.
  - A storage or aged storage month is one transaction per marketplace (71 of 71), and it can hold many items: 20 of the 71 hold several, up to 20 and more.
  - A removal order has 1 to 21 charges; 38 of 105 orders have several.
  - An invoice has one charge (289 of 289).
- **Date.** A reference row takes the date of the earliest Finances charge of its key.
- **Marketplace of a removal row and of an ad invoice line.** Neither source has one; it comes from the same earliest charge. No order had two charges at the earliest instant in different marketplaces (0 of 105), and no order was charged in two currencies.
- **The earliest charge** is the one posted first. Two posted at the same instant are ordered by Amazon's transaction ID, so the result never depends on chance.
- **Currency.** Rows count for a charge only in the charge's own currency.
- **An earlier charge that is stored later** moves the rows to its month, and the payout reports of both months are refreshed (section 12).
- **Month of a storage charge.** Finances preprocessing stores the month a charge covers: the month before posting for monthly storage, the posting month for aged storage. In the sample all 51 monthly storage transactions were posted on the 6th or 7th and all 20 aged storage transactions on the 19th to 21st. A monthly storage charge posted after the 10th, or an aged storage charge posted before the 11th, fails preprocessing.
- **Marketplace of a report row.** Report preprocessing stores it from the row's country: the marketplace of that same country. Ten countries were seen on storage and aged storage rows: US, CA, GB, DE, FR, IT, ES, JP, AU and SG. Another country fails.
- **No Finances charge yet.** A reference row is not a cost until its charge exists.
- **No reference rows for a charge.** The whole charge is a difference (reference not found).

## 8. The inventory ledger: FNSKU and ASIN → SKU

The inventory ledger is its own table, loaded per seller account and month and versioned like the money tables (section 5). It is the only place that turns an FNSKU or an ASIN into a SKU.

**Who searches it**

| Who searches | By | Ledger months read |
| --- | --- | --- |
| The calculation | FNSKU, or ASIN for a returns fee | the months the row names (below) |
| The cron job that fills in default assignments | ASIN, for a product listed by ASIN only | all loaded months of the seller account |
| The screen: the warning with its assignment hints | ASIN | all loaded months of the seller account |

- **Where Amazon names the SKU itself, there is no search.** A Sponsored Products or Display ad, a promotion that lists SKUs and a shipment item all state their SKU, and that SKU is used as it stands.
- **The other tables are not asked.** Finances sale rows, ads and promotions also hold a SKU beside an ASIN, but no search reads them (section 11 says what that leaves out).

**What Amazon's report gives**

- **Monthly rows.** The report is asked for monthly rows, so the month is Amazon's own column and nothing is computed. Amazon can also give daily rows; they are not used.
- **One row is finer than month, FNSKU and SKU.** It is also per condition (sellable, defective and five more) and per country, with the quantities of the month. One month, FNSKU and SKU has 1 to 19 rows (one row on 618 of 906). The lookup uses seller account, month, and FNSKU or ASIN.
- **A monthly row is a whole month, whatever date range was asked** (Europe June 2026, in two requests: 59 of 59 rows equal). So the month is read from the row, never from the request.
- **A finished month did not change.** Downloaded again after two days, 537 of 537 rows were equal (Japan, Australia, Europe; January to October 2026). Two days cannot prove that Amazon never corrects a month later; if it does, the month gets a new version and the results that read it are calculated again. By default the last three finished months are asked again (section 14).
- **The product title is not a ledger fact.** Between two downloads the title text differed on 19 of 56 rows, and nothing else did.
- **The running month is not loaded.** Amazon has no monthly rows for it.

**Each row names the ledger months it reads.** Its own preprocessing works them out and stores them on the row. The database takes every SKU the ledger names for the row's FNSKU, or ASIN, in those months, and nothing else.

| Row | Ledger months the row names | Rows whose months are held: found |
| --- | --- | --- |
| Storage row | the month of charge | 5,579 of 5,579 |
| Aged storage row | the snapshot month, taken in UTC | 237 of 237 |
| Removal order row | the request month through the last-updated month, both taken from the instant in UTC | 358 of 358 |
| Liquidation item in Finances | the six months before the posting month, and the posting month | 59 of 59, each with one SKU |
| Returns fee in Finances, by its ASIN | every month from the start to the end that Amazon writes on the fee | 2 of 2 fees that could be tested, each with one SKU |

- **The only assumed number is the six months of a liquidation item.** Every other row takes its months from its own dates. All 59 liquidation items were found in a month before the posting month: 51 one month back, 3 two, 5 four. For 13 of them the month just before the posting month is the only one that has the FNSKU, so the posting month alone would not be enough. The six months are a preprocessing rule, so changing the number is a new preprocessing version, not a change to the database.
- **Why UTC for a removal row.** The row has no marketplace, and Amazon prints its dates with an offset that changes between downloads (section 5). The printed month and the UTC month differ on 37 of 568 rows. Both ways find every FNSKU, so the stable one is used.
- **Not used:** letting the database pick "the latest month that has the FNSKU", or repeating an FNSKU's last SKU in later months. The first puts an assumption inside the database; the second puts rows into the ledger that Amazon did not give.

**What the ledger names decides the outcome**

| The ledger names, in the months of the row | Result |
| --- | --- |
| one SKU | that SKU's company |
| several SKUs of one company | that company |
| several SKUs of different companies | difference: split ownership |
| a SKU without a company, alone or among others that agree | difference: no assignment (section 6) |
| no SKU, and a month the row names is not loaded yet | difference: ledger month not loaded; it resolves itself when the month is loaded |
| no SKU, and every month the row names is loaded | difference: not in the ledger |

- **A SKU found in the loaded months counts at once.** The row does not wait for its other months. If a month loaded later names another SKU, the result is calculated again, like every result that late data changes (section 12).
- **The six months are not checked in Finances preprocessing,** which does not see the ledger. If six is ever too few, the item shows as "not in the ledger", and the number is raised in preprocessing.
- **A month older than Amazon's reach** (about 19 months) also shows as "ledger month not loaded", and that one does not resolve itself (section 13).

**Why a month at all.** The ledger says which SKU an FNSKU belongs to month by month, and the answer changes. Of 85 FNSKUs in five seller accounts, 7 are named under two or three SKUs across the months held; within one month only 1 of 905 is. A lookup without a month would take the SKUs of other months too.

**Edge cases of naming months**

| Edge case | Result |
| --- | --- |
| A date on the first or last day of a month | 38 removal dates, all found |
| A removal order that spans two months | 71 rows; the FNSKU is in both months on all 71 |
| An FNSKU that changes its SKU inside the named months | several SKUs: one company, or a difference |
| A row that finds its FNSKU only in the running month | a difference until the month is over and loaded. It concerns aged storage rows, which name their snapshot month alone, and removal rows requested in the running month |

**Other facts**

- **No payout is affected** if a month's rows are there within two months. October 2026 was there on 21 November.

## 9. Tax

- **Finances** states base and tax separately on every charge.
- **Reference rows** get one treatment each: no tax, tax added on top, or tax already included.
- **Worked out in preprocessing.** Each row stores Amazon's amount as given and, beside it, its base and its tax. The rule needs only the row's own source: its country, or its seller account and currency.
- **Removal rows** have no country, so their treatment is keyed by seller account and currency. Three pairs include tax: yen in the Japan account and Australian dollars in the Australia account at 10%, and Singapore dollars in the Singapore account at 9%. Four pairs have none: euros and pounds in the Europe account, US and Canadian dollars in the North America account. With that, the rows equal what Finances charged on 105 of 105 orders of the sample, and on Singapore's 2 orders of July 2025 (11.45 = 10.50 + 0.95 and 10.46 = 9.60 + 0.86; asked from Finances on 24 November 2026). A row with a fee and a pair never seen fails. A row without a fee needs no treatment: 240 of 568 rows carry none, and 222 of those print no currency at all.
- **A promo is a discount on a fee,** stated beside base and tax. It counts with the base, for the tax check and for the comparison with reference rows. Seen on 24 fulfilment fees, which go with their SKU, and on one Japanese disposal: base −60, promo +60, and the removal report shows a fee of 0.
- **Ad invoices** state their own tax rate, and preprocessing uses it (section 10).
- **One tax table, used twice.** Finances preprocessing checks it against the base and tax Amazon states on every cost charge; report preprocessing applies it to its rows. A cost charge that breaks it fails Finances preprocessing.
- **It has three parts.** The rate, by marketplace and cost type. For a storage or aged storage row, whether the printed amount already includes that tax. And for a removal row, which has no marketplace, rate and treatment by seller account and currency (above).
- **Entries carry no dates.** One value was seen per entry over the whole sample. When Amazon changes a rate, preprocessing fails, and the entry gets a date then.
- **One value per entry:** no tax, or one rate. Report preprocessing has to split a row without seeing its Finances charge, so an entry can never say "this or that".
- **How exact the check is.** Where an entry has a rate, Amazon's tax must be that rate of the base within one smallest unit of the currency, or within 0.2% of the base. The smallest unit comes from the list of currencies (section 2). All 141 such charges pass; 24 of them state no tax because the base is too small. With one unit alone, 4 Japanese items fail, because Amazon sums their tax from several products rounded one by one. Where an entry has no tax, the tax must be zero: 1,339 of 1,339. A charge of zero amount states no tax: 75 of 75.
- **Which tax it is** (the rate differs by who charges it, so each entry has its own rate):

| Tax | Rate | On what | How it is known |
| --- | --- | --- | --- |
| Japanese consumption tax | 10% | Japan: storage, aged storage, removal, disposal, labeling | Amazon's tax fits 10% on the fees, and the published rate is 10%. Korean VAT is 10% too, so the data cannot tell the two apart; the rate is the same |
| Australian GST | 10% | Australia: storage, aged storage, disposal | fits 10% exactly on 18 of 18 disposals, and the published rate is 10%. The same remark holds |
| Singapore GST | 9% | Singapore: storage, aged storage, disposal | the published rate is 9% since 2024. Two disposals and two aged storage charges of July and August 2025 fit 9% and neither 8% nor 10% (4 of 4; asked from Finances on 24 November 2026), and so does the fulfilment fee on 9 of 9 items. The storage charges alone are too small to tell 9% from 10% |
| Korean VAT | 10% | advertising billed in Australia and Singapore | the invoice itself names the tax "VAT" and the taxed country "South Korea", on 16 of 16 taxed invoices. It follows the seller's own country, not the marketplace |
| British Columbia's sales tax | 7% | Canada: the disposal on a customer return | British Columbia has taxed marketplace services at 7% since July 2022. Two Canadian fees carry tax: the one disposal on a customer return (3 cents on 36) and one fulfilment fee, which fits 7% and no other rate. The record does not name the province |

- **Canada.** Each Canadian entry is what was seen on its own cost type: no tax on storage, aged storage and disposals by removal order (10, 7 and 6 charges), and 7% on the disposal on a customer return (1 charge). A Canadian storage charge with tax, or a customer-return disposal without, fails Finances preprocessing and is examined then (section 13).
- **Splitting a report row.** The amounts on rows are positive, and the rate is the entry's. For a row that includes tax, the tax is rate/(1 + rate) of the amount, which is 10/110 at 10% and 9/109 at 9%, rounded half up to the smallest unit of the currency, and the base is the rest, so base and tax add up to Amazon's amount exactly. For a row before tax, the base is the amount and the tax is the rate of it, rounded the same way. Where the entry has no tax, the base is the amount. Amazon's own split is sometimes a few yen away; the remainder shows as a difference, "totals differ" (section 13).
- **What the table covers:** the cost charges (section 1).
- **Outside the table:** every amount that is not a cost charge, which means the product types, liquidations, the returns fee and SelBox types. They keep the base and tax Amazon states, and no rate is asserted on them. Seen there: subscription fees with 10% tax in Australia and 16% in Mexico.
- **Key of the table:** marketplace and cost type; a disposal fee has two entries, by removal order and by customer order.

**The tax table: every entry, with the number of charges seen**

| Cost type | Tax in | No tax in |
| --- | --- | --- |
| Storage | Japan 10% (58), Australia 10% (15), Singapore 9% (4) | US 250, UK 53, Germany 44, France 11, Canada 10, Italy 5, Spain 2 |
| Aged storage | Japan 10% (3), Australia 10% (7), Singapore 9% (2 ‡) | US 63, Canada 7, UK 4, Germany 3 ‡ |
| Disposal by removal order | Japan 10% (9), Australia 10% (18), Singapore 9% (2 ‡) | UK 188, US 87, Germany 15, Spain 9, Canada 6, France 1 |
| Disposal on a customer return | Canada 7% (1) | US 132, UK 30, Germany 28, Spain 2, Italy 1 |
| Removal | Japan 10% (2) | US 7, UK 3 |
| Labeling | Japan 10% (8) | |
| Placement | | US 16 |
| Transport | | Germany 15, US 8, UK 6 |
| Transport program | | Germany 15, UK 6 |
| Inbound defect | | UK 1 |
| Advertising | Australia 10% (13), Singapore 10% (3), both Korean VAT | US 73, UK 73, Japan 37, France 25, Germany 24, Italy 11, Belgium 6, Sweden 6, Spain 5, Poland 5, Netherlands 4, Ireland 4 |
| Coupon | | US 4, Canada 2 |
| Deal | | France 10, UK 8, Italy 8, Germany 3, Japan 2, US 2, Spain 2 |

‡ Seen outside the sample, asked from Finances on 24 November 2026: Singapore for July to September 2025, Germany for March 2026.

- **No entry, no pass.** A marketplace and cost type that is not in this table has no entry. A cost charge with an amount and no entry fails Finances preprocessing, and a storage or aged storage row with an amount and no entry fails report preprocessing. Mexico has none at all. An inbound defect fee has an entry for the United Kingdom only, from the one fee seen; elsewhere it fails until a real one is examined. An entry for one cost type in one marketplace, such as the Canadian disposal on a customer return, is just one more line of this table.
- **A charge or row of zero amount needs no entry.** No rate makes a tax out of nothing, so its base and tax are zero whatever the entry would say. A cost charge whose base with promo is zero must state no tax: 75 of 75 in the sample. The counts in the table leave these out; with them the check covers 1,555 charges. Seen without an entry: aged storage in Spain and Italy, 3 charges and 2 report rows of 0.00 in March 2026.
- **Why the ‡ entries were added.** The saved Europe aged storage report holds two German rows of March 2026, €1.41 together, and the sample had no German aged storage charge. Asked from Finances, Amazon charged €1.41 without tax on 19 March 2026, the same amount as the rows. Singapore's two disposals in the sample had a zero amount, but its removal report also holds two orders of July 2025 with a fee, and their charges carry 9%.

| Row | Amount on the row is | Checked where tax is charged |
| --- | --- | --- |
| Ad invoice line | before tax | Australia and Singapore: 16 of 16 invoices |
| Storage row | before tax, everywhere | Japan 1 of 1 month, Australia 1 of 1, Singapore 2 of 2 |
| Aged storage row | before tax in Australia, tax included in Japan, not seen in Singapore | Australia 3 of 3 months, Japan 3 of 3 |
| Removal order row | tax included, in Japan, Australia and Singapore | 23 of 23 orders of the sample, and Singapore's 2 of July 2025 |

- **Singapore's aged storage row is the one treatment not seen.** Amazon charged aged storage there in July and August 2025, but the report for those months was refused twice on 24 November 2026 (processing status FATAL, no document). So a Singapore aged storage row with an amount fails report preprocessing until one is examined.

## 10. Advertising

- **One invoice, one Finances charge** (289 of 289). All were paid from the Amazon balance and fully paid. An invoice paid another way has no Finances charge, so it is never asked for and is no cost here; whether such invoices exist was not measured.
- **Campaign key.** Amazon's campaign ID on the invoice line (`campaignId`). Every line has one: 2,888 of 2,888. Names are labels only: 9 of 150 campaigns were renamed.
- **Asking Amazon about a campaign.** A line carries two IDs, `campaignId` and `campaignAID`. The Ads API finds Sponsored Products, Brands and Display campaigns by the first (149 of 149) and the one TV campaign only by the second. The answer is stored under the line's `campaignId`.
- **A line's cost already includes Amazon's regulatory advertising fee.** The invoice also lists that fee on its own, on 187 invoices, £489 and €568 in all. It is not added again: with the line costs alone the invoices equal Finances, 289 of 289.
- **The invoice names its own tax.** Every invoice states the tax's name, rate and country. All 289 say "VAT"; 16 are taxed at 10% with the country "South Korea", the seller's own. So the tax on advertising follows the seller, not the marketplace, and preprocessing uses the rate the invoice states. Three values of the rate were seen: 0, 10, and 1000 on 14 invoices whose tax is 10%. Another value fails.
- **Adjustments are taxed like lines.** On the 3 taxed invoices that have an adjustment, the invoice's tax is 10% of lines plus adjustments, and not of the lines alone. So an adjustment has a base and a tax like a line.
- **A line's tax is not rounded.** It is the invoice's rate of the line's base, kept exact; Amazon rounds once, on the invoice's total. Summed and then rounded half up it equals the invoice's tax on 16 of 16 taxed invoices. Rounding each line first misses it by a cent on 9 of the 16.
- **Ad programs.** Sponsored Products, Brands, Display and TV. Another program name fails preprocessing.
- **Where an ad lists its products.** Preprocessing reads the settings names it knows; another name fails.

| Ad program | Setting that lists the products | What it gives |
| --- | --- | --- |
| Sponsored Products | product creative | SKU and ASIN (376 ads) |
| Sponsored Display | responsive e-commerce, product video | SKU only (7 ads) |
| Sponsored Brands | product collection, product video | ASIN only (18 ads) |
| TV | video | no product (1 ad) |

- **Campaigns without any product:** 2 of 150, the TV campaign and one Sponsored Products campaign without ads. Their default assignment stays blank.
- **The invoice's own list of promotions** was empty on 289 of 289. A filled one would be an ad credit that changes the amounts, so it fails preprocessing.
- **Adjustments.** Three texts are known; another text fails preprocessing. Preprocessing stores which of the three an adjustment is.

| Adjustment text | Outcome | Seen |
| --- | --- | --- |
| "Applying Over Delivery Click Credits" | SelBox type, account fee: the invoice names no campaign for it | 113; £7.18, €6.18, $4.30, A$3.18 and ¥105 in all |
| "Rounding Adjustment" | SelBox type, account fee | 62, a few cents in all |
| "Over Delivery Adjustment Applied Against Campaign: (name)" | the campaign of the one line with that name in the same invoice. Preprocessing stores that campaign on the adjustment and fails unless exactly one line has the name. | 6, and exactly one line on 6 of 6 |

## 11. Assignments

- **Keys.** A SKU by its text: one assignment, which holds in every seller account. A campaign, promotion or shipment by its Amazon ID.
- **Versioned.** Every change is a new version with a memo.
- **Fee rates** exist only on SKUs, per marketplace and period.
- **Applied to all dates.** The current assignment decides past months too; published payouts are refreshed.
- **An assignment names a company, nothing else.** There is no assignment to SelBox itself, and no way to attribute a difference by hand. A dummy company can stand in if ever needed. Today's explicit "no company" for a SKU is not carried over: a missing company is always a difference. An administrator can clear an assignment. It is then without a company, which is a difference like any other, and it stays so until an administrator sets one.

**Default assignment of a campaign, promotion or shipment**

1. A cron job of its own writes it. It belongs to no preprocessing and is not a step of the sync run. The database only receives the assignment, as it would from an administrator.
2. The default is the company, if all SKUs of its products belong to one company. Otherwise the assignment stays blank.
   - **A SKU without a company is not ignored.** The assignment stays blank until every SKU has a company and it is the same one.
   - **An empty product list** gives no company.
   - **Only real SKUs count.** The SKUs are the values stored as SKU (section 6). An FNSKU or an ASIN is never read as a SKU.
3. A product listed by ASIN only is converted to SKUs first, through the inventory ledger (see "ASIN → SKU" below). An ASIN that the ledger does not name is a product without a company, so the assignment stays blank.
4. The version memo says it is automatic.
5. It is a helpful guess. The cron job asks the database which companies the SKUs point to, which is the question the warning asks too.
6. **It writes the first assignment and nothing else.** Each time it runs, the cron job takes every campaign, promotion and shipment that has information and has never been assigned. Once one has an assignment, written by the cron job or by an administrator, the cron job never touches it again. That holds too when an administrator cleared the company: it stays without one until an administrator sets one. Only an administrator changes an assignment.
7. It goes by what is stored, so it needs no signal from a sync run. A run that stops halfway loses nothing: the next run finds the same ones again. Between a sync run and the cron job's next run, a newly loaded campaign, promotion or shipment is blank, and its charges are a difference. How often it runs is a setting.

| | Default assignment | Warning |
| --- | --- | --- |
| Must stay as it was | yes: it is a version, a payout pins it, an administrator may change it | no |
| Must always be current | no | yes |
| So it is | stored, by its own cron job | a database function, joined when the screen asks |

- **Not a live join.** A default that is only joined could not be pinned or changed, and it would move money without a version whenever a SKU changes company.

**What the cron job does over time**

| Case | What happens |
| --- | --- |
| A campaign is loaded before its SKUs have a company | it is blank, and its charges are a difference; the cron job fills in the company at its next run after the SKUs have one |
| One SKU of a blank campaign has no company, and the others belong to company A | it stays blank; the cron job fills in A at its next run after that SKU belongs to A too. If the SKU gets another company, the next row applies |
| The SKUs of a blank campaign belong to different companies | it stays blank until an administrator assigns it, or until the SKUs agree |
| A SKU of an assigned campaign moves to another company | the campaign keeps its company; the warning shows it |
| An ASIN of an assigned campaign gains a SKU of another company | the campaign keeps its company; the warning shows it |
| An administrator clears the company of a campaign | it stays without a company, and its charges are a difference. The cron job never fills it in again; only an administrator sets a company |

- **Without an administrator, money moves in one direction only:** from a difference to a company, and always with a version. That applies to past months too, like every assignment change. It never moves from one company to another.
- **The cron job does not need to know who assigned.** It only asks whether the campaign, promotion or shipment has ever been assigned. The memo tells people that a version was automatic.
- **ASIN → SKU is used each time a never-assigned one is looked at,** not only at the first load. It never changes an assignment.

**Warning for the screen**

- A database function lists every campaign, promotion and shipment whose assignment is blank, or whose SKUs (including ASINs converted to SKUs) point to another company or to several.
- It is a display aid. It is not a constraint and changes no amount.
- **Assignment hints.** The warning also shows, for each of them, the SKUs of its products and their companies. An ASIN is turned into SKUs through the ledger (section 8).

**ASIN → SKU**

- **The conversion reads the inventory ledger alone** (section 8). An ASIN gives every SKU the ledger names for it in the loaded months of the seller account, because a campaign or promotion states no period for a product.
- **Which products need it.** Only those that Amazon lists by ASIN alone: Sponsored Brands campaigns and some promotions. Every other product list names its SKUs.
- **Checked on those products:** 15 Sponsored Brands campaigns and 4 promotions, 22 different ASINs. The ledger names a SKU for 20 of the 22 ASINs, and for every ASIN of 17 of the 19 campaigns and promotions. Of the 20, 8 name one SKU, 8 two and 4 three.
- **The two ASINs the ledger misses.** One was sold from Amazon's warehouses in 2024 and 2025, before the ledger months held for that account, so a ledger loaded as far back as Amazon allows would likely have it. The other has no stock and no sale in the months held. A campaign with such an ASIN stays blank until an administrator assigns it.
- **Other tables name more SKU texts, and they are not read.** Finances sale and refund rows, Sponsored Products ads and promotions also hold a SKU beside an ASIN. On the 22 ASINs they name 14 SKU texts that the ledger lacks:

| Why the ledger lacks the SKU text | SKU texts |
| --- | --- |
| It shares its FNSKU with another SKU, and the ledger lists that FNSKU under the other one | 10 |
| Its FNSKU is not in the ledger months held | 2 |
| Its ASIN is not in the ledger months held | 2 |

- **So the ledger is not missing data.** One product in the warehouse has one FNSKU and can be offered under several SKU texts (section 6); the ledger names one of them. Of the 14 SKU texts, 8 were sold from Amazon's warehouse in months the ledger holds, 4 were never sold and are named only by an ad or a promotion, and 2 belong to the two ASINs the ledger lacks. A default therefore needs fewer SKUs to agree. It would not notice a selling SKU of another company on the same ASIN; that SKU still needs its own assignment for its sales.
- **How the FNSKU of those SKUs was known:** from an inventory list fetched once for this check. It is not a source of these rules.

## 12. Payouts

- **Timing.** A month is paid out two calendar months later.
- **Late data.** A new version of a money table, of the inventory ledger or of an assignment refreshes the affected payout reports. So does anything stored for the first time that a report would have read: a later or earlier charge of a key, a ledger month, a customer order's sale record. There is no limit in months: a saved report is calculated again however old it is, and a new version is saved if a record changed. What can still change is decided by how far back Amazon is asked again (section 14). There is no separate "all reports present" check.
- **Pins.** A payout report pins the versions it used: of the money tables, of the inventory ledger and of the assignments.
- **Nothing about assignments or references blocks.** Unassigned or unmatched amounts are differences and show in the Financial review tab. Assigning or matching them later refreshes the payout.
- **Unchanged:** Finances itself must be complete for the month, checked against `listSummary` as today.

## 13. Known limits

- **Evidence.** Finances: three or four full months per seller account (June to September 2026) and single weeks back to October 2024, 64,840 transactions in all; twelve months for Canada. Almost half of them, 30,054, are release copies that are not activity (section 3). Ledger: April 2025 to October 2026. A full backfill will meet unseen shapes and stop, by design.
- **Counts come from checks run on different days,** while the sample grew, so two counts of the same kind of row can rest on different totals. The counts in sections 7, 8, 9 and 16 were measured again on 23 November 2026, on the whole sample.
- **Three shapes in old sample weeks are not on today's list of types.** The returns fee is added with this change. The other two fail preprocessing until they are added:

| Shape | Seen | Carries | Route once added |
| --- | --- | --- | --- |
| An inventory reimbursement in an older layout | 7 amounts, October 2024 | a SKU | the SKU's company |
| The tax on a refund's restocking deduction | 1, January 2025, ¥37 | a SKU | the SKU's company |
| A returns fee | 1 in the sample; 4 in 24 months when asked from Finances, $47.80 | an ASIN and a period, no SKU | the ASIN, through the ledger (sections 6 and 8); added now |

- **Differences that stay.** An inbound charge without a shipment ID. A row whose ledger month is older than Amazon's reach. A disposal on a customer return whose order is older than the Finances data. Rows and charges that do not add up. They stay with SelBox, because a difference cannot be attributed by hand (section 11).
- **Finances reaches back about two years.** On 23 November 2026 a request for 6 to 16 November 2024 was refused (HTTP 400), and one for December 2024 was answered.
- **Not measured.** Whether ad invoices exist that are not paid from the Amazon balance. How soon after a month ends its ledger rows are there. When a campaign's first invoice or a shipment's first fee arrives. Whether Amazon corrects a ledger month later than two days.
- **Reports were there when their charge was.** On 23 November 2026 Japan's storage report for October was there (225 rows), 16 days after the charge is normally posted.
- **Tax split of a report row,** compared with Amazon's own tax per key: monthly storage in Japan exact on 1 of 1 month; aged storage in Japan on 1 of 3 months, the others 1 and 2 yen away; removal orders in Japan on 5 of 7, in Australia on 16 of 16. Rounding down instead is 23 yen away on the Japanese storage month.
- **Liquidation items have no usable ID.** 44 of 59 carry an ID that the Orders API does not know. The other 15 carry the original customer order, whose SKU is the one the customer bought; it differs from the ledger's SKU on 2 of 15. The ledger rule is used for all.
- **Report quota.** North America refused report requests for some hours after about 12 in a day.
- **Two aged storage months do not match:** UK June 2026 by £0.38 (unexplained) and US January 2026 by $0.04 (Amazon's rounding).
- **Canada: one taxed cost charge** (section 9). The disposal on a customer return is the only Canadian cost charge with tax: 0.03 CAD on 0.36 CAD, which rounded half up fits 7%, 8% and 9% and not 10%. Its entry is 7% from that one charge. The record does not name the province, so an untaxed one may come. It stops preprocessing until the entry is examined, and so does a Canadian storage, aged storage or removal-order disposal charge with tax. Not verified: which charges are tied to British Columbia.
- **Singapore: 9%** (section 9). The four storage charges of the sample, 0.28 SGD with 0.03 SGD tax in all, fit 9% and 10% alike. The two disposals and two aged storage charges of July and August 2025 fit 9% only.
- **Singapore has storage, removal and ledger reports.** Its storage report equals Finances on 2 of 2 months, its removal report holds the two zero-fee disposal orders of July 2026 and two orders of July 2025 with a fee, and its ledger names one SKU for each of the 4 storage rows. Its aged storage report could not be downloaded (section 9).
- **Gone with Data Kiosk:** advertising cost per SKU, seller-entered cost figures such as cost of goods, and the comparison of Finances sales with a second source in the Financial review tab.

## 14. Each preprocessing, step by step

There are nine preprocessings, one per table. All nine run through the same four stages.

**The four stages**

| Stage | What happens | If it goes wrong |
| --- | --- | --- |
| 1. Download | Amazon is asked, and its answer is kept exactly as it came. | nothing is stored; the download is repeated |
| 2. Check | The whole answer is checked against the rules observed for this source. | the preprocessing fails for this answer |
| 3. Work out | What this source alone can tell is added beside Amazon's values. | the same |
| 4. Store | The rows go into the table of this source, marked with the preprocessing version. | all rows of the answer are stored, or none |

- **One answer** is one download: Finances of one seller account and period, one report, one invoice, the information of one campaign, promotion or shipment.
- **A failure stops only its own answer.** Nothing of that answer is stored, what was stored before stays, and the other preprocessings go on.
- **No other table is read in any stage.** What a preprocessing must be told (a period, a month, a list of IDs, the decimals of each currency) is handed to it from outside.
- **Every preprocessing fails on a currency that is not on the list of currencies** (section 2).
- **The kept answer is what lets a rule change.** A new preprocessing version is applied to the kept answers; Amazon is not asked again. This matters because Amazon's own reach is limited, for the ledger to about 19 months. Today's project works this way.
- **Stage 4 for a versioned table:** content that did not change keeps its version; changed content is a new version.
- **Stage 4 for an information table:** the latest answer replaces the earlier one.
- **The month of a date.** A Finances posting date is taken in the marketplace's local time, as in today's project. A removal row has no marketplace, so its months are taken in UTC (section 8). A storage row states its month itself, and an aged storage snapshot falls on the 14th or 15th.
- **Finances preprocessing keeps today's rules** for what is downloaded, for the type of each amount, for what is activity, for the check against Amazon's `listSummary` and for one version per transaction. These rules change only where a cost finds its company.

What each one asks Amazon for, and by what, is the table in section 4. The IDs it is told come from the ID list (section 2).

**Order within a sync run**

1. Finances.
2. Ad invoices, with the invoice IDs from step 1.
3. The three reports and the inventory ledger. They need nothing from another table, so their place in the order is free.
4. Campaigns, with the IDs from step 2. Promotions and shipments, with the IDs from step 1.

The default assignment is not a step of the sync run: it is a cron job of its own (section 11). The database calculates amounts whenever they are asked for.

**How far back each asks when the administrator names no period**

| Preprocessing | Default period | Why |
| --- | --- | --- |
| Finances | transactions posted in the last three calendar months | a held-back sale was released up to 60 days after it was posted (section 3) |
| Removal orders | orders requested in the last twelve months | an order changed up to 185 days after its request; twelve months is about twice that (below) |
| Storage, aged storage | the last three finished months | no later change was seen, and none was looked for |
| Inventory ledger | the last three finished months; every month Amazon still has, about 19, while none is stored for the seller account | a finished month did not change in two days; nothing longer was measured (section 8) |
| Ad invoices, campaigns, promotions, shipments | none | they are asked by ID (section 5) |

- **These are settings of the sync service,** not rules of the database, and an administrator can name another period for any run. Days and months are taken in UTC.
- **A change that comes later than its period is not silent where it carries money.** The new charge is in Finances, the stored rows no longer explain it, and that is a difference in the Financial review tab (section 3). Running that preprocessing for the period loads the change.
- **A saved payout report has no period of its own** (section 12).

**Finances**

One row is one amount of a charge: base, tax or promo.

Fails when:

- an amount has a type that is not on the list (section 17);
- a transaction names no marketplace (0 of 64,840), its total is not the sum of its items, or an item's total is not the sum of its amounts, as today;
- the answer would change whether a transaction stored from another answer is activity, as today (section 3);
- the status is not one of DEFERRED, DEFERRED_RELEASED and RELEASED;
- a record carries both deferral links, or a release copy is not RELEASED;
- an original and its release copy in the same answer do not name each other, or differ in marketplace, account type, transaction type, amount or currency;
- the transactions of complete days do not add up to Amazon's own totals;
- a product type carries no SKU, outside a liquidation item;
- a cost charge with an amount has no entry in the tax table, or a tax that its entry does not expect; or a cost charge of zero amount states a tax (section 9);
- a monthly storage charge is posted after the 10th, or an aged storage charge before the 11th;
- two places of one charge hold different shipment IDs;
- a deal fee comes by the lightning deal path (`SellerDealPayment`), until one is examined (section 6);
- the SKU field of a liquidation item lacks the shape of an FNSKU, or the SKU field of any other item has it (section 6);
- a returns fee lacks an ASIN of "B0" and eight characters, or the start or the end of its period, or its start is after its end.

Works out:

- the type of each amount, and whether it is base, tax or promo;
- whether the record is activity (section 3);
- the amount SelBox's service fee applies to;
- the kind of ID a charge carries and the ID itself (section 6);
- the month a storage charge covers;
- the ledger months that a liquidation item or a returns fee names (section 8).

Leaves to the database: whose amount it is, and every match with another table.

- **The list of types** is today's: Amazon's transaction type and the path of an amount inside its item give one of 49 types (section 17). Run over the sample, it knows every amount but 9, the three shapes of section 13. The returns fee becomes the fiftieth. On the list and not in the sample: Vine, and the lightning deal path of deal fees.
- **A transaction and its items, checked on 64,840 transactions.** Amazon gives every item its own amounts: price, tax and fees.
  - The total of a transaction equals the sum of its items on 64,702 of 64,702. An item's total equals the sum of its own amounts on 66,186 of 66,186. So no amount exists at the transaction level only, and nothing has to be split.
  - The date, the marketplace and the order ID are on the transaction, and each item takes them. An invoice ID is on the item, and so is the shipment ID of some inbound fees (section 6).
  - 884 transactions have more than one item. 267 of them name more than one SKU: 263 order payments, and 4 that Amazon describes as "FBAShipmentInjectionFulfillmentFee". Those 4 hold fulfilment fees, a product type, so each item goes with its SKU. In the other 617 the items share one SKU or name none.
  - Two items of one transaction can be equal in every field (48 transactions). Both count; the totals above only hold with both. How an item is told apart is left to the schema design; today's project already keeps repeated amounts.
  - 138 transactions have no items: 59 bank transfers, 78 cross-account adjustments, 1 retrocharge refund. Each is one charge.

**Ad invoices**

One row is one campaign's cost on an invoice, or one adjustment.

Fails when:

- the ad program is not Sponsored Products, Brands, Display or TV;
- a line has no campaign ID;
- the invoice's list of promotions is not empty;
- an adjustment text is not one of the three known;
- a named adjustment does not fit exactly one line of its invoice;
- the tax rate is not 0, 10 or 1000.

Works out: base and tax of each line and each adjustment, by the rate the invoice states and without rounding; which of the three an adjustment is; the campaign of a named adjustment.

Leaves to the database: whether the invoice agrees with its Finances charge.

**Storage rows, aged storage rows, removal order rows**

| | Storage rows | Aged storage rows | Removal order rows |
| --- | --- | --- | --- |
| One row | one row of the report: an FNSKU's fee in a warehouse for a month | one row of the report: an FNSKU's fee at a snapshot | one row of the report: a product of a removal order |
| Fails when | the country is unknown; a row with an amount has no entry in the tax table; an FNSKU lacks the shape of one | the country is unknown; a row with an amount has no entry in the tax table, or an entry whose treatment was not seen (Singapore); the snapshot is not a readable instant; one month has two snapshot days; an FNSKU lacks the shape of one | a row with a fee has a pair of seller account and currency never seen; a date is not a readable instant; an FNSKU lacks the shape of one; the rows of one order have different request dates (0 of 426 orders); an order ID has the shape of a customer order (0 of 426); an order stored before is missing from a newer answer that covers its request date |
| Marketplace | from the country | from the country | none on the row; the database takes it from the earliest charge |
| Base and tax | the amount is before tax | before tax in Australia, tax included in Japan | tax included for yen in the Japan account, Australian dollars in the Australia account and Singapore dollars in the Singapore account |
| Dates | the month of charge, as printed | the snapshot, stored as an instant | request and last update, stored as instants |
| Ledger months named | the month of charge | the snapshot month, in UTC | the request month through the last-updated month, in UTC |
| Kept as information only | | the SKU the report prints | the SKU the report prints |

- None of the three calls Finances. Whether a report agrees with its Finances charge is the database's difference.
- **The removal report selects by the request date of an order.** Asked for August 2026, Europe gave the 7 rows requested in August and none of the 3 rows that were only updated in August. The range is in UTC: asked for July 2026, Japan gave the one row requested in July and not the row that is printed as July and falls on 30 June in UTC.
- **A removal order keeps changing after its request.** Of 426 orders, the last update came a median of 4 days after the request, within 18 days for nine in ten, and after 185 days at most. The late ones are few: later than 60 days for 6 of the 398 orders old enough to show it, later than 150 days for 2 of 325, later than 212 days for none of 280, and for none of the 216 orders requested more than a year before the download. So past request months are asked again, by default the orders requested in the last twelve months, and a changed order is a new version. Its charges came 0 to 47 days after the request, and at most 3 days after the last update.

**Inventory ledger**

| | |
| --- | --- |
| One row | Amazon's monthly row: one FNSKU of one SKU in one month, per condition and country |
| Fails when | a row's date is not a month and year; an MSKU has the shape of an FNSKU, or an FNSKU lacks it (section 6) |
| Works out | nothing; the month is Amazon's own column |
| Not loaded | the running month, for which Amazon has no monthly rows |

**Campaigns, promotions, shipments**

| | Campaigns | Promotions | Shipments |
| --- | --- | --- | --- |
| One row | the latest information of one campaign | of one promotion | of one shipment |
| Product list, as Amazon gives it | SKU and ASIN for Sponsored Products; SKU only for Display; ASIN only for Sponsored Brands; none for TV | ASIN and SKU; ASIN only for coupons | SKU and FNSKU |
| Works out | nothing | nothing | nothing |
| Stored | the latest answer replaces the earlier one | the same | the same |

- **Fails when** a product's SKU has the shape of an FNSKU, or a shipment item's FNSKU lacks it (section 6); or an ad lists its products under a setting that preprocessing does not know (section 10).
- **An ID that Amazon does not know** gives no information row. Nothing fails. The assignment stays blank, the charge is a difference, and an administrator can still assign the ID. This follows the rule for every missing piece: it is a difference, never a stop. In the sample Amazon knew every ID asked: 150 campaigns, 22 promotions, 38 shipments.

## 15. Decisions, and what is postponed

**Left to the schema design, and answered in section 8 of `remove-data-kiosk-schema.md`**

| # | Point | What the rules already say |
| --- | --- | --- |
| 1 | Whether an assignment version records who set it, automatic or administrator | The cron job does not need it: it goes by whether a company is there. The memo says that a version was automatic. |
| 2 | When each preprocessing runs, how often the default assignment cron job runs, and running one by hand | Decided: an administrator runs the preprocessings, about once a day, and no schedule is designed. Each is a separate function that is safe to run again. The least that must happen: money tables before information; information again when new money rows carry its ID. A database trigger on the information row would fire before the row's product list is stored. |
| 3 | Whether an administrator can remove a company without setting another | Decided: yes, and the cron job never fills a cleared one in again (section 11). |
| 4 | How a Finances item or a report row is told apart when no set of columns identifies it | Two items or rows that are equal in every field both count (sections 5 and 14). Today's project already keeps repeated amounts of a transaction. |
| 5 | How far back each report is asked again | Decided: Finances three calendar months; removal orders requested in the last twelve months; storage, aged storage and the inventory ledger the last three finished months, and every ledger month Amazon still has on the first run (section 14). A saved payout report is calculated again whenever something it read changes, with no limit in months (section 12). |

**Decisions, and where each is written**

A decision marked † was written in from a rule you set, or from what today's project does, without a question to you. Say so if one should be otherwise.

| Topic | Decision | Section |
| --- | --- | --- |
| Outcomes | SelBox types and differences are kept apart. Reference not found, not in the ledger, split ownership and no assignment are differences. | 3 |
| | † Bank transfers and release copies of held-back sales are not activity, as today. | 3 |
| | † Company amounts, SelBox types and differences add up to the Finances total of every month. | 3 |
| | A reference row takes the date of its key's earliest charge. † Where several charges share one key, the difference is worked out once for them together; a removal order charged in two months shows a positive difference in the first month and a negative one in the later month, and they cancel. † Every amount of the calculation is in Finances's sign, so a negative difference is a cost that SelBox bears. | 3, 7 |
| | † Row amounts keep Amazon's decimals; a key's total is rounded before it is compared, and the remainder is a difference "rounding". | 3 |
| | † The two ad invoice adjustments that name no campaign are SelBox types of the group account fee. |  3, 10 |
| | A missing fee rate is not a difference; it holds back that one company's payout report. † SelBox's service fee keeps today's definition, and SelBox types keep today's three groups. | 3 |
| | There is no assignment to SelBox itself and no manual attribution of a difference. A dummy company can stand in if ever needed. Today's explicit "no company" for a SKU is not carried over. Some differences therefore stay with SelBox for good. | 11, 13 |
| Routes | † The type of an amount chooses its route, with the two exceptions of section 6; a product type without a SKU fails. | 6, 17 |
| | A SKU without a company is not ignored, wherever a rule asks whether all SKUs belong to one company. † If the SKUs that have a company already disagree, the reason shown is split ownership. | 6, 8, 11 |
| | † Sales of a SKU without a company are a difference until the SKU is assigned. Today they block the payout. | 3 |
| | † A SKU needs an assignment even if no sale ever names it. † One SKU without a company holds back the whole cost of every campaign, promotion and shipment that lists it, and of every row that names it. | 6 |
| | An inbound defect fee follows its shipment's company. Its tax entry is the United Kingdom, no tax; † elsewhere it fails preprocessing until a real one is examined. | 6, 9 |
| | An inbound charge without a shipment ID is a difference. † So is any charge whose type needs an ID and carries none; two places with different shipment IDs fail. | 6 |
| | A returns fee is looked up in the ledger by its ASIN, over the period Amazon writes on it. | 6, 8 |
| | † A customer order is found through its sale or refund rows in the same seller account, also rows that are not activity. † A disposal or removal fee goes by the kind of its order ID; without any order ID it is a difference. † The returns fee joins the list of types with this change. | 6 |
| | † Every amount of a liquidation item follows its FNSKU, its tax included. This changes today's list for 4 amounts, −£1.60. | 6 |
| | † Every Amazon ID is keyed together with its seller account. | 6 |
| | Only a value that preprocessing stored as a SKU counts as a SKU. † A value stored as a SKU that has the shape of an FNSKU fails preprocessing. | 6 |
| Ledger | The inventory ledger is its own table, and every search by FNSKU or ASIN reads it: the calculation, the cron job and the screen. For an ASIN the cron job and the screen read all loaded months. Where Amazon names the SKU itself, that SKU is used and nothing is searched. | 8, 11 |
| | Each row names the ledger months it reads. A liquidation item names the six months before its posting month and the posting month; the latest SKU is not carried forward. The six months are not checked in Finances preprocessing: a row whose months name no SKU is a difference, and if six proves too few the number is changed in preprocessing. | 8 |
| | The ledger holds Amazon's monthly rows only; the running month is not loaded, and a row that finds its FNSKU in no loaded month is a difference until then. † A SKU found in the loaded months counts at once. | 8 |
| | Everything a payout report reads is versioned, the ledger included. | 5 |
| Reference rows | † Each report is asked once per seller account, and the latest answer replaces the same unit. A request that Amazon cancels for lack of data counts as loaded with no rows. | 4, 5 |
| | † A date on a report row is stored as an instant, and a removal row's months are taken in UTC. † The aged storage unit is the snapshot month. | 5, 8 |
| | † Rows count for a charge only in its currency, and two charges at the same instant are ordered by transaction ID. † A removal order that is missing from a newer answer covering its request date fails that answer. | 7, 14 |
| Tax | One tax table: checked in Finances preprocessing, applied by report preprocessing. Each entry has its own rate, and an entry for one cost type in one marketplace is just one more line. Report preprocessing does not call Finances. † The check allows one smallest unit, or 0.2% of the base. † Each entry has one value: no tax, or one rate. † A charge or row of zero amount needs no entry, and a report row with an amount and no entry fails report preprocessing. | 9 |
| | † An ad invoice adjustment is taxed like a line, and a line's tax is not rounded. † A promo counts with the base. † The table covers the cost charges only. † A report row's tax is worked out by one rounding rule; what Amazon's own split leaves is a difference. | 9, 10 |
| Preprocessing | One preprocessing per table, with no exception. Each is a separate function that can be run again. | 2, 14 |
| | A step that needs only its own source is worked out in preprocessing and stored on the row: base and tax, the month a storage charge covers, the ledger months a row names, the marketplace of a report row, the campaign of a named ad adjustment. | 2 |
| | † Amazon's answer is kept as it came, and a new preprocessing version is applied to the kept answers. One failed answer stops only itself. | 14 |
| | Ad invoice preprocessing does not compare the invoice with its Finances charge; that is the database's difference. † A line without a campaign ID, or an invoice with a filled list of promotions, fails. | 10, 14 |
| | † Ad invoices are asked by the invoice IDs on Finances charges, so Finances runs before them. | 2, 14 |
| | The decimals of a currency are one fixed list in the database, and each preprocessing run is handed it. Its rows are added, never changed or removed. A currency not on the list fails preprocessing. | 2, 3, 9 |
| Periods | An administrator runs the preprocessings, about once a day; no schedule is designed. Without a named period each asks: Finances three calendar months back; removal orders requested in the last twelve months; storage, aged storage and the inventory ledger the last three finished months, and every ledger month Amazon still has while none is stored. | 14 |
| | A saved payout report is calculated again whenever something it read changes, however old it is. No number of months limits it. | 12 |
| Assignments | The default assignment is a cron job of its own. It writes only the first assignment of a campaign, promotion or shipment and never changes one that exists, a cleared one included. It is stored, not joined live. | 11 |
| | † A blank filled by the cron job moves its charges from a difference to that company, for past months too. A default that later stops fitting is not corrected; the warning shows it. † A campaign billed before its information arrives has no assignment and is a difference until then. | 11 |
| | Information of a campaign, promotion or shipment is asked again whenever a sync run stores new money rows with its ID. † An ID that Amazon does not know gives no row and fails nothing. | 5, 14 |

## 16. Assumptions and their evidence

Every rule that rests on what Amazon's data looked like, with the count behind it. Counts are from 23 and 24 November 2026.

| # | Assumption | Evidence | When it stops holding |
| --- | --- | --- | --- |
| | **Finances** | | |
| 1 | Every amount has a type on today's list | all but 9 amounts, of three old shapes (section 13) | preprocessing fails |
| 2 | A release copy carries the ID of its original, and a bank transfer is told by its type | 30,054 of 30,054 release copies carry the link; 27,704 of 27,704 pairs agree; 59 transfers | fails on an unknown status or contradicting links |
| 2a | The activity equals Amazon's own totals, whatever the status of a held-back record | 18 of 18 totals of one week; Japan, the eight complete days 22 to 29 September, from a copy with 179 records still deferred and from one with none | fails, as today |
| 3 | A transaction's total is the sum of its items, and an item's total the sum of its amounts | 64,702 of 64,702; 66,186 of 66,186 | fails, as today |
| 4 | A product type carries a SKU | 410,222 of 410,222 amounts | fails |
| 5 | Only a liquidation item holds an FNSKU in the SKU field | 59 of 59 items; 0 of 64,462 other items | fails |
| 6 | The tax of a cost charge fits the tax table | 141 of 141 where an entry has a rate, 1,339 of 1,339 where it has none, 75 of 75 of zero amount | fails |
| 7 | Monthly storage is posted by the 10th, aged storage from the 11th | 51 of 51; 20 of 20 | fails |
| 8 | Each charge carries its ID in the stated place | advertising 289 of 289; coupon and deal 41 of 41; removal 348 of 348; inbound 65 of 75 | no ID is a difference; two different IDs fail |
| 9 | Deferred records are only sales, refunds and liquidations, and one liquidation adjustment | every cost charge was "released" | nothing; the activity rule covers any type |
| 9b | Every transaction names a marketplace | 64,840 of 64,840 | fails |
| 9c | An order ID of three, seven and seven digits is a customer order, and no removal order has that shape | 0 of 426 removal orders | removal preprocessing fails |
| 9d | No Amazon ID appears in two seller accounts | 0 of 34,732 customer orders, 289 invoices, 105 removal orders, 22 promotions and 17 shipments | nothing; every ID is keyed with its seller account |
| 9a | A returns fee names an ASIN of "B0" and eight characters, and a period whose start is not after its end | 4 of 4 fees, asked from Finances for 24 months; the period was three months each time, which the rule does not rely on | fails |
| | **Ad invoices** | | |
| 10 | One invoice per charge; lines and adjustments equal the base; the invoice's tax equals the tax | 289 of 289 | a difference |
| 11 | Every line has a campaign ID | 2,888 of 2,888 | fails |
| 12 | Three adjustment texts; a named one fits exactly one line | 181 adjustments; 6 of 6 | fails |
| 13 | The tax rate is 0, 10, or 1000 meaning 10 | 273, 2 and 14 invoices | fails |
| 14 | The invoice's list of promotions is empty | 289 of 289 | fails |
| 15 | A line's cost includes the regulatory advertising fee | 289 of 289 equal Finances without adding it | a difference |
| 15a | The invoice's tax is its rate of lines plus adjustments, rounded once on the total | 16 of 16 taxed invoices; 3 of 3 that have an adjustment | a difference |
| | **Reports** | | |
| 16 | A report covers the whole seller account | 5 pairs of requests gave the same rows | rows would repeat; the unit rule replaces them |
| 17 | Storage rows equal the charge's base | 22 of 22 country-months | a difference |
| 18 | Aged storage rows equal the charge | 18 of 20 country-months | a difference |
| 19 | Removal rows equal the charge | 105 of 105 orders | a difference |
| 19a | The charges of a key have one earliest charge, in one marketplace and one currency | 0 of 105 orders with two charges at the earliest instant in different marketplaces; none in two currencies | ordered by transaction ID; rows count in the charge's currency |
| 19b | One aged storage snapshot a month; the rows of one removal order share one request date | 35 of 35 account-months; 426 of 426 orders | fails |
| 20 | A row's country is one of ten | every row | fails |
| 21 | The removal report selects by request date, in UTC | Europe, August 2026: 7 rows requested then and none of 3 only updated then. Japan, July 2026: 1 of 1 row by UTC | later updates would be missed; the orders requested in the last twelve months are asked again |
| 21a | A removal order does not change later than twelve months after its request | 426 orders: 185 days at most; later than 212 days, 0 of the 280 old enough to show it; 0 of the 216 requested more than a year before the download | a charge that the stored rows do not explain is a difference; the administrator asks for that period |
| 22 | A printed date is an instant with a changing offset | 7 of 7 rows, two downloads | stored as instants, so nothing |
| 23 | Two rows equal in every column both count | 1 of 1 charged order | a difference |
| 24 | Seller account and currency tell a removal row's tax | 105 of 105 orders | a pair never seen fails |
| | **Inventory ledger** | | |
| 25 | A monthly row is a whole month, and a finished month did not change in two days | 59 of 59 rows; 537 of 537 (21 to 23 November) | a new version, while the month is among the last three finished ones or an administrator names it; results are calculated again |
| 26 | The months a row names hold its FNSKU, or for a returns fee its ASIN | storage 5,579 of 5,579; aged storage 237 of 237; removal 358 of 358; liquidation 59 of 59; returns fee 2 of 2 that could be tested | a difference |
| 27 | An FNSKU is "X0" or "B0" and eight characters, and no SKU is | 85 of 85 FNSKUs; 0 SKUs in any source | fails |
| | **Campaigns, promotions, shipments** | | |
| 28 | Amazon knows every ID asked | 150 campaigns, 22 promotions, 38 shipments | no row; the charge is a difference |
| 29 | A campaign is found by its `campaignId`, a TV campaign by `campaignAID` | 149 of 149; 1 of 1 | no row; the charge is a difference |
| 30 | An ad lists its products under a known setting | 402 of 402 ads | fails |
| 31 | An ASIN that a campaign or promotion lists is in the ledger | 20 of 22 ASINs; 17 of 19 campaigns and promotions | the default stays blank |
| | **Not validated** | | |
| 32 | Vine fees, lightning deal fees | none in the sample | Vine keeps today's route; a lightning deal fee fails |
| 33 | Singapore's warehouse fees are taxed at 9%. In Canada only the disposal on a customer return is taxed, at 7% | Singapore: 4 of 4 disposal and aged storage charges of 2025 fit 9% only. Canada: 23 of 23 storage, aged storage and removal-order disposal charges without tax, 1 of 1 customer-return disposal with it (section 13) | fails |
| 34 | The rounding of a report row's tax | exact on 21 of 23 removal orders in Japan and Australia, and on 1 of 3 aged storage months in Japan | a difference of a few yen |
| 35 | No ad invoice is paid outside the Amazon balance | all 289 were; the reverse was not measured | such an invoice is no cost here |
| 36 | How soon a month's ledger rows are there | October was there on 21 November | a difference until loaded |

## 17. Every Finances type and its route

The types are today's list of 49, read from Amazon's transaction type and the path of an amount inside its item. The route is what these rules add.

| Route | Today's types | Seen in the sample |
| --- | --- | --- |
| The SKU on the item | product sales and refunds, shipping credits and refunds, gift wrap (3 types), product tax, shipping tax, tax withheld, promotional rebates and refunds, points, referral fees and their refunds, FBA fulfilment fees, shipping chargebacks, refund commission, restocking, inventory reimbursements and their reversals, fulfilment fee corrections and reversals, digital services fees, zero-value activity | 410,222 amounts, every one with a SKU |
| FNSKU, through the ledger | liquidation proceeds, liquidation fees, and the tax amounts of the same item | 59 items |
| Ad invoice lines, then the campaign | advertising | 289 charges |
| Storage rows, then FNSKU | storage fees | 523 charges in 51 transactions |
| Aged storage rows, then FNSKU | aged storage fees | 85 charges in 20 transactions |
| Removal order rows, then FNSKU; or the customer order, then its SKU | disposal fees, removal fees | 530 and 12 charges |
| The shipment | inbound placement, inbound transportation, inbound transportation program, labeling, inbound defect | 16, 29, 21, 8 and 1 charges |
| The promotion | coupon fees, deal fees | 6 and 35 charges |
| SelBox type, account fee | subscription, EPR, supply chain (MCF) credits, Vine, other adjustments | 33, 2, 4, 0 and 4 charges |
| SelBox type, balance movement | debt recovery, cross-account adjustments, reserve movements | 64, 78 and 10 charges |
| SelBox type, tax reclassification | tax reclassification | 10 retrocharge transactions |
| Not activity | bank transfers | 59 |
| ASIN, through the ledger | the returns fee, added with this change as the fiftieth type | 1 in the sample, 4 in 24 months |

- **Changed from today's list:** inbound defect fees go to the shipment, not to SelBox; the tax of a liquidation adjustment goes with its FNSKU, not to tax reclassification; the returns fee is added.
- **Amazon's names for the cost types.** Advertising: `ProductAdsPayment`. Storage: `FBAStorageBilling`. Aged storage: `FBALongTermStorageBilling`. Disposal and removal: `FBADisposal`, `FBARemoval`. Placement: `FBAInboundConvenience`. Transport and transport program: `FBAPostInboundTransportation`. Labeling: `FBAWarehousePrep`. Inbound defect: `FBAInboundDefect`. Coupon: `CouponParticipationEvent`, `CouponPerformanceEvent`. Deal: `DealParticipationEvent`, `DealPerformanceEvent`.
- **On today's list and not in the sample:** Vine, and the lightning deal path of deal fees (`SellerDealPayment`).