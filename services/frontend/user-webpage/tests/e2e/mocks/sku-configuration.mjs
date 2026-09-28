function configurationItems(fixture) {
  if (fixture.skuConfigurationItems !== null) return fixture.skuConfigurationItems;
  const skus = [
    ...new Set(
      [
        ...fixture.assignments.map((item) => item.sku),
        ...(fixture.liveRows ?? []).map((row) => row.sku),
        ...fixture.settlementRows.map((row) => row.sku),
        ...fixture.kioskRows.map((row) => row.sku),
      ].filter(Boolean),
    ),
  ];
  return skus.map((sku) => {
    const assignment = fixture.assignments.find((item) => item.sku === sku);
    return {
      sku,
      sku_id: assignment?.id ?? null,
      company_id: assignment?.company_id ?? null,
      terms_version_id: assignment?.terms_version_id ?? null,
      periods: fixture.feeRows
        .filter((row) => row.sku_id === assignment?.id)
        .map((row) => {
          const [, valid_from, valid_to] = /^\[([^,]+),([^)]*)\)$/.exec(row.valid_period);
          return {
            marketplace_name: row.marketplace_name,
            valid_from,
            valid_to: valid_to || null,
            fee_rate_percent: row.fee_rate_percent,
          };
        }),
      requirements: [],
      issues: assignment?.company_id
        ? []
        : [
            {
              sku,
              kind: "missing_company",
              marketplace_name: null,
              valid_from: null,
              valid_to: null,
            },
          ],
    };
  });
}

export async function respondWithSkuConfiguration(
  fixture,
  { request, url, user, accessToken, reply, route, track },
) {
  if (url.pathname.endsWith("/sku_configuration")) {
    const entry = { user, accessToken, completed: false, failure: null };
    fixture.configurationRequests.push(entry);
    track(request, entry);
    await fixture.beforeConfiguration(entry);
    if (fixture.configurationStatus !== 200) return reply({}, fixture.configurationStatus);
    const items = configurationItems(fixture).filter(
      (item) => fixture.roles[user] === "operator" || item.company_id === fixture.companyIds[user],
    );
    return reply({ items });
  }
  const args = request.postDataJSON();
  fixture.configurationSaves.push(args);
  await fixture.beforeConfigurationSave(args);
  if (fixture.roles[user] !== "operator") return reply({}, 403);
  if (fixture.configurationSaveNetworkFailure) return route.abort("failed");
  if (fixture.configurationSaveStatus !== 200)
    return reply(fixture.configurationSaveError, fixture.configurationSaveStatus);
  const items = configurationItems(fixture);
  const published = args.p_changes.map((change, index) => {
    const terms_version_id = `10000000-0000-4000-8000-${String(fixture.configurationSaves.length * 100 + index).padStart(12, "0")}`;
    const current = items.find((item) => item.sku === change.sku);
    const item = {
      ...current,
      sku: change.sku,
      sku_id: current?.sku_id ?? terms_version_id,
      terms_version_id,
      company_id: change.company_id,
      periods: change.periods,
      requirements: current?.requirements ?? [],
      issues: [],
    };
    const position = items.findIndex((existing) => existing.sku === change.sku);
    if (position < 0) items.push(item);
    else items[position] = item;
    const assignment = {
      id: item.sku_id,
      sku: item.sku,
      company_id: item.company_id,
      terms_version_id,
    };
    fixture.assignments = [
      ...fixture.assignments.filter((row) => row.sku !== item.sku),
      assignment,
    ];
    return { sku: change.sku, terms_version_id };
  });
  fixture.skuConfigurationItems = items;
  fixture.revisions.fees = String(Number(fixture.revisions.fees) + 1);
  return reply({ published, changed_count: published.length });
}
