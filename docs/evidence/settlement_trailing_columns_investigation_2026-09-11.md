# Settlement TSV trailing-column investigation

**Investigation date: 2026-09-11.** These observations support the current
trailing-empty-field parsing convention.

Some archived settlement content rows contain 23 values under a 24-column
header. The accepted rule interprets omitted right-hand values as empty when
the fields may be empty for that row's role and family. It preserves supplied
cells and all required-field checks. The canonical implementation contract is
[trailing empty fields](../data_workflows.md#trailing-empty-fields).

This document preserves the aggregate findings from the local byte audit,
acquisition-log comparison, repeated-download comparison, historical code
inspection, and fresh read-only retrieval controls. Raw report identifiers,
seller/SKU values, response headers, credentials, and signed URLs are omitted.
The evidence below is historical local evidence, not an independent
cryptographic attestation of Amazon's original HTTP responses.

## Observed report structure

The archive contains **27 reports and 35,698 monetary content rows**, plus one
settlement-metadata data row per report. Every file has the same complete
24-column TSV header. Byte inspection preserved tabs and split only line endings;
no whitespace stripping, re-export, or source-file modification was performed.

**Fifteen content rows in four reports contain 23 values.** All other content
rows and all metadata data rows contain 24. Every short row is inside a file,
followed by further records; these are not truncated final download segments.

| Transaction type | Amount type                    | Amount description         | Short rows |
| ---------------- | ------------------------------ | -------------------------- | ---------: |
| `Liquidations`   | `ItemPrice`                    | `Principal`                |          5 |
| `Liquidations`   | `ItemFees`                     | `LiquidationsBrokerageFee` |          5 |
| `AmazonFees`     | `Vine Enrollment Fee`          | `Base fee`                 |          3 |
| `AmazonFees`     | `Coupon Participation Fee`     | `Base fee`                 |          1 |
| `AmazonFees`     | `Coupon Performance Based Fee` | `Base fee`                 |          1 |
| **Total**        |                                |                            |     **15** |

Every occurrence of these exact five combinations in this archive is short;
all other transaction rows have the complete width. Among the 35,683 complete
content rows, 35,140 explicitly retain an empty final `promotion-id` field and
543 have a nonempty promotion field. These counts establish a pattern in this
sample, not a universal Amazon family-format guarantee.

The ten liquidation rows have blank cells 19–21, a nonnumeric identifier in
cell 22 (`sku` under this header), and quantity `1` in cell 23. Their paired
principal and brokerage rows agree on those values. They end before the tab
that would encode an empty final promotion value.

The five Vine/coupon fee rows retain **five trailing tabs** after their last
nonblank value, in cell 18 (`posted-date-time`). Those tabs encode empty cells
19–23. Blanket removal of trailing whitespace does not explain that pattern;
ordinary neighboring rows retain their final empty fields as well.

All 27 reports reconcile exactly using their amount cells and first-data-row
total. This validates the amounts, not every identifier or column position. The
candidate liquidation SKU values have no independent complete-row counterpart
in this archive. Identifier shape alone does not prove whether a value is a
merchant SKU, FNSKU, or ASIN; no such identity match was established here.

## Acquisition evidence

The first byte audit could not distinguish Amazon output from later file
handling. The subsequent acquisition-log comparison supplied stronger evidence:

- **All 27 archived files exactly match their logged SDK `payload.document`
  strings encoded as UTF-8.** No newline normalization was needed. All 15 short
  rows already exist in those returned strings.
- One affected report was downloaded twice on May 9 and once on May 10. The
  three logged document strings have identical SHA-256 values and match the
  archive, including its same four short rows.
- The historical application downloader directly called the SDK's
  `get_report_document(..., download=True, file=...)` and logged its returned
  response. No local row splitting, whitespace trimming, or report rewriting
  was found in that path. The log is emitted after the SDK call and file write;
  it records the returned document string independently of rereading the file.
- The installed SDK inspected during the investigation was
  `python-amazon-sp-api` 2.1.20. Its retrieval helpers decode/decompress and write
  document text without rebuilding TSV fields. The historical dependency was
  unpinned, so this does not establish the SDK version used in May. The
  [SDK report-document helper](https://github.com/saleweaver/python-amazon-sp-api/blob/master/sp_api/util/report_document.py)
  shows the corresponding document-level operations.

The short rows therefore predate later archive handling and were already
present in the SDK-returned text at acquisition. The matching logs and files
are stronger evidence than archived bytes alone, but both are local historical
records; they do not authenticate Amazon's historical transport bytes.

## SP-API documentation and retrieval controls

Amazon's [report retrieval guide](https://developer-docs.amazon/sp-api/docs/retrieve-a-report)
describes fetching the document through a signed URL with optional
decompression. Reports API listing filters identify reports; they do not
reconstruct the downloaded TSV's rows. The
[Settlement V2 reference](https://developer-docs.amazon/sp-api/docs/report-type-values-settlement)
lists the report fields, including `promotion-id`, but does not document an
omitted-trailing-field convention or explain the observed short rows.

Fresh authenticated read-only controls used the existing application client:

| Retrieval control                                                         | Observed result              |
| ------------------------------------------------------------------------- | ---------------------------- |
| `getReport` for each of the four affected report IDs                      | All four returned not-found. |
| `getReportDocument` for each document ID recovered from the original logs | All four returned HTTP 400.  |

No fresh body was available for independent comparison. These outcomes do not
establish a universal expiry rule, an exact expiry date, or permanent inability
to retrieve every historical settlement report. They do not explain the missing
field. No report was generated and no financial result was published by these
controls.

**The most likely explanation is a transaction-family-specific Amazon report
serialization path emitting 23 fields while omitting the unused final field.**
This is an inference from the family pattern, acquisition-text matches, and
repeated downloads. Amazon's implementation and the exact historical SDK version
remain unverified. The documentation must not present the inference as a
documented Amazon format guarantee.

## Parsing assumption and limits

The implemented [trailing-empty-field convention](../data_workflows.md#trailing-empty-fields)
preserves the complete header, maps supplied cells from the left, and fills only
an omitted suffix when those fields may be empty for the row's role and family.
Required-field checks still apply; diagnostics retain original widths and omitted
field names.

For all observed short rows this supplies only `promotion-id`. Extending the
convention to a longer optional suffix is a policy generalization: the sample
directly demonstrates only a one-field omission. An interior lost delimiter can
sometimes leave plausible values after padding. Field count and exact monetary
reconciliation cannot prove where a value was omitted.

## Relationship to the earlier audit

The [September 8 classification audit](settlement_classification_audit_2026-09-08.md)
reported **116 strictly parsed reports and 174,249 content rows**, excluding
the four short-row archives. A separate diagnostic pass padded the final empty
cell and examined all **27 archives and 35,698 rows**, finding no classification
violations. Those historical strict and diagnostic measurements remain unchanged.

The acquisition findings do not make the earlier diagnostic pass a strict parse
under the parser used on September 8. The current
[seven-family classification rules](../settlement_component_categories.md),
[SKU completeness evidence](settlement_sku_completeness_2026-09-07.md), and source-selection
policy are unchanged by this structural convention.
