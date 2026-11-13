function literalPattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** History controls and version records share the main report table, not a nested table. */
export const payoutHistoryControls = (page, scope) =>
  page.getByRole("group", { name: `Report versions for ${scope}`, exact: true });

export const payoutHistoryRows = (page, scope) =>
  page.getByRole("row", {
    name: new RegExp(`^Previous version for ${literalPattern(scope)}, saved `),
  });

export const payoutLatestRow = (page, scope) =>
  page
    .getByRole("button", {
      name: new RegExp(`^(?:Show|Hide) versions for ${literalPattern(scope)}$`),
    })
    .locator("xpath=ancestor::tr");

export const payoutScopeRows = (page, scope) =>
  payoutLatestRow(page, scope)
    .or(payoutHistoryRows(page, scope))
    .or(payoutHistoryControls(page, scope).locator("xpath=ancestor::tr"));
