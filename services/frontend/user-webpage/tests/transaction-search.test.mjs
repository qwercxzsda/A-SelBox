import assert from "node:assert/strict";
import test from "node:test";
import { resolveTransactionSearch } from "../src/transaction-search.ts";
import { createDatasetScope } from "../src/dataset-query-cache.ts";

const empty = { skus: [], types: [], marketplaces: [], sources: [] };

test("literal search trims and ignores case while preserving exact punctuation and Unicode SKU keys", () => {
  const skus = ['  Test_%*.\\"(SKU)  ', "Other", "ＳＫＵ－１", "Ärger"];
  assert.deepEqual(resolveTransactionSearch("live", "member", skus, '  %*.\\"(sku) '), {
    ...empty,
    skus: [skus[0]],
  });
  assert.deepEqual(resolveTransactionSearch("live", "member", skus, "ｋｕ"), {
    ...empty,
    skus: ["ＳＫＵ－１"],
  });
  assert.deepEqual(resolveTransactionSearch("live", "member", skus, "ÄR"), {
    ...empty,
    skus: ["Ärger"],
  });
  assert.deepEqual(resolveTransactionSearch("live", "member", skus, "^[a-z]+$"), empty);
});

test("one term collects matches across fields using raw keys and displayed type/source labels", () => {
  const found = resolveTransactionSearch("live", "administrator", ["AMAZON-SKU"], "amazon");
  assert.deepEqual(found.skus, ["AMAZON-SKU"]);
  assert.ok(found.marketplaces.includes("Amazon.com"));
  assert.ok(found.types.includes("AmazonFees/Coupon Participation Fee/Base fee"));
  assert.deepEqual(resolveTransactionSearch("live", "member", [], "data kiosk").sources, [
    "DATA_KIOSK",
  ]);
  assert.deepEqual(resolveTransactionSearch("live", "member", [], "data_kiosk").sources, [
    "DATA_KIOSK",
  ]);
  assert.ok(
    resolveTransactionSearch("live", "member", [], "Product sales").types.includes("PRODUCT_SALES"),
  );
  assert.ok(
    resolveTransactionSearch("live", "member", [], "PRODUCT_SALES").types.includes("PRODUCT_SALES"),
  );
});

test("blank search is inactive while unmatched or currency-only text stays active with empty sets", () => {
  assert.equal(resolveTransactionSearch("live", "administrator", [], " \t "), null);
  for (const term of ["USD", "NO-SUCH-VALUE"])
    assert.deepEqual(resolveTransactionSearch("live", "administrator", [], term), empty);
  assert.deepEqual(
    resolveTransactionSearch("settlement", "administrator", [], "Data Kiosk"),
    empty,
  );
  assert.deepEqual(
    resolveTransactionSearch("data_kiosk", "administrator", [], "Settlements"),
    empty,
  );
});

test("member type search respects allocation categories and raw tabs search only their source", () => {
  const term = "Subscription fee";
  assert.deepEqual(resolveTransactionSearch("live", "member", [], term), empty);
  assert.ok(
    resolveTransactionSearch("live", "administrator", [], term).types.includes("SUBSCRIPTION_FEE"),
  );
  assert.deepEqual(resolveTransactionSearch("data_kiosk", "administrator", [], term).types, [
    "SUBSCRIPTION_FEE",
  ]);
  assert.deepEqual(resolveTransactionSearch("settlement", "administrator", [], term).types, [
    "other-transaction/other-transaction/Subscription Fee",
  ]);
});

test("new SKU matches change page/count scope while reordered catalog values preserve cache identity", () => {
  const identity = {
    session: { user: { id: "u" } },
    account: { access_role: "administrator", company_id: null },
    skuOptions: ["B"],
  };
  const options = { dataset: "live", search: "new-" };
  const old = createDatasetScope(identity, options);
  const fresh = createDatasetScope({ ...identity, skuOptions: ["NEW-1", "B"] }, options);
  assert.notDeepEqual(old.key, fresh.key);
  assert.notDeepEqual(old.countKey, fresh.countKey);
  assert.deepEqual(fresh.searchValues, { ...empty, skus: ["NEW-1"] });
  assert.deepEqual(
    fresh.key,
    createDatasetScope({ ...identity, skuOptions: ["B", "NEW-1", "NEW-1"] }, options).key,
  );
});
