export function summaryBucket(activityDate, reportedAmount, options) {
  return { activity_date: activityDate, ...aggregateValues(reportedAmount, options) };
}

export function typeBucket(type, reportedAmount, options) {
  return { component_type: type, ...aggregateValues(reportedAmount, options) };
}

function aggregateValues(
  reportedAmount,
  {
    currency = "USD",
    serviceFee = "0",
    companyAmount = reportedAmount,
    rowCount = 1,
    knownCompanyCount = rowCount,
  } = {},
) {
  return {
    currency,
    reported_amount: reportedAmount,
    service_fee: serviceFee,
    company_amount: companyAmount,
    row_count: String(rowCount),
    known_company_count: String(knownCompanyCount),
  };
}

export function summaryCards(page) {
  return {
    summaries: page.getByRole("region", { name: "Estimated totals", exact: true }),
    day: page.getByRole("article", { name: "Latest day estimated totals", exact: true }),
    month: page.getByRole("article", { name: "Latest month estimated totals", exact: true }),
    selected: page.getByRole("article", { name: "Selected dates estimated totals", exact: true }),
  };
}

export function summaryAmount(card, label) {
  return card.getByText(label, { exact: true }).locator("..").locator("dd");
}
