export const REVIEW_COMPANY = "0198b50b-701a-7000-8000-000000000041";
export const REVIEW_REPORT = "0198b50b-701a-7000-8000-000000000042";

export function setupFinancialReview(fixture) {
  fixture.roles["member-a"] = "administrator";
  fixture.companyIds["member-a"] = REVIEW_COMPANY;
  fixture.companyNames[REVIEW_COMPANY] = "Review Company";

  fixture.payoutRows = [
    {
      id: REVIEW_REPORT,
      company_id: REVIEW_COMPANY,
      marketplace_name: "Amazon.com",
      currency: "USD",
      start_date: "2026-06-01",
      end_date: "2026-06-30",
      created_at: "2026-09-27T13:20:10Z",
      source_amount: "100",
      fee_amount: "-5",
      company_amount: "95",
    },
  ];
  fixture.payoutRecords = [
    {
      source_row_id: "payout-record",
      report_id: REVIEW_REPORT,

      source: "FINANCES",
      source_amount: "100",
      fee_amount: "-5",
      company_amount: "95",
      component_type: "PRODUCT_SALES",
    },
  ];
}
