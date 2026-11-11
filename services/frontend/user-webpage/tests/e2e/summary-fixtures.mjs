export function summaryBucket(activityDate, reportedAmount, options) {
  return { activity_date: activityDate, ...aggregateValues(reportedAmount, options) };
}

export function typeBucket(type, reportedAmount, options) {
  return {
    component_type: type,
    ...aggregateValues(reportedAmount, {
      category: categoriesByType.get(type) ?? "FINANCES",
      ...options,
    }),
  };
}

function aggregateValues(
  reportedAmount,
  {
    currency = "USD",
    marketplace = "Amazon.com",
    category = "FINANCES",
    serviceFee = "0",
    companyAmount = reportedAmount,
    rowCount = 1,
    knownCompanyCount = rowCount,
  } = {},
) {
  return {
    marketplace_name: marketplace,
    category,
    currency,
    reported_amount: reportedAmount,
    service_fee: serviceFee,
    company_amount: companyAmount,
    row_count: String(rowCount),
    known_company_count: String(knownCompanyCount),
  };
}

export function summaryRegion(page) {
  return page.getByRole("region", { name: "Current totals", exact: true });
}

export function summaryCard(page, period) {
  return summaryRegion(page).getByRole("article", { name: `${period} totals`, exact: true });
}

export function summaryTable(page, period) {
  return summaryRegion(page).getByRole("table", {
    name: `${period} marketplace totals`,
    exact: true,
  });
}

export function summaryPeriods(page, marketplace = "Amazon.com") {
  const group = (period) =>
    summaryTable(page, period).locator(`tbody[data-marketplace=${JSON.stringify(marketplace)}]`);
  return {
    summaries: summaryRegion(page),
    day: group("Last day"),
    month: group("Last month"),
    selected: group("Selected dates"),
  };
}

export function summaryAmount(scope, label, currency = "USD") {
  const field = {
    "Reported amount": "reportedAmount",
    "Service fee": "serviceFee",
    "Company amount": "companyAmount",
    "Known company amount": "companyAmount",
  }[label];
  const tableAmount = scope.locator(
    `tr[data-currency=${JSON.stringify(currency)}] [data-amount-field=${JSON.stringify(field)}]`,
  );
  const detailAmount = scope
    .locator("dl")
    .filter({ hasText: currency })
    .getByText(label, { exact: true })
    .locator("..")
    .locator("dd");
  return tableAmount.or(detailAmount);
}
import transactionTypes from "../../src/generated/transaction-types.json" with { type: "json" };

const categoriesByType = new Map(transactionTypes.map(({ type, category }) => [type, category]));
