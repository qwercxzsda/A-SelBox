export const WORKSPACE_COMPANY = "0198b50b-701a-7000-8000-000000000041";
const WORKSPACE_REPORT = "0198b50b-701a-7000-8000-000000000042";

/** member-a becomes an administrator of one company that has one saved payout report. */
export function setupAdministratorWorkspace(fixture) {
  fixture.roles["member-a"] = "administrator";
  fixture.companyIds["member-a"] = WORKSPACE_COMPANY;
  fixture.companyNames[WORKSPACE_COMPANY] = "Workspace Company";

  fixture.payoutRows = [
    {
      id: WORKSPACE_REPORT,
      company_id: WORKSPACE_COMPANY,
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
      report_id: WORKSPACE_REPORT,
      source: "FINANCES",
      source_amount: "100",
      fee_amount: "-5",
      company_amount: "95",
      component_type: "PRODUCT_SALES",
    },
  ];
}
