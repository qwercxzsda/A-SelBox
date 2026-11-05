import assert from "node:assert/strict";
import test from "node:test";
import {
  parseWorkspaceSearch,
  stringifyWorkspaceSearch,
  validateWorkspaceSearch,
} from "../src/router-search.ts";

test("workspace routing preserves repeated filters and literal search values", () => {
  const search = "?tab=live&sku=001&sku=A%2BB&type=null&search=true&company=123&campaign=help";
  const parsed = parseWorkspaceSearch(search);
  assert.deepEqual(parsed, {
    tab: "live",
    sku: ["001", "A+B"],
    type: "null",
    search: "true",
    company: "123",
    campaign: "help",
  });
  assert.deepEqual(parseWorkspaceSearch(stringifyWorkspaceSearch(parsed)), parsed);
});

test("inventory null and string filters retain their existing JSON-encoded URL contract", () => {
  const params = new URLSearchParams();
  for (const value of [null, "null", "001", 'A / + "SKU"']) {
    params.append("sku", JSON.stringify(value));
  }
  const result = new URLSearchParams(
    stringifyWorkspaceSearch(parseWorkspaceSearch(params.toString())),
  );
  assert.deepEqual(result.getAll("sku").map(JSON.parse), [null, "null", "001", 'A / + "SKU"']);
});

test("empty query values and unrelated repeated parameters survive routing", () => {
  const parsed = parseWorkspaceSearch(
    "?reportCurrency=&campaign=a&campaign=b&search=%E9%9F%93%E5%9B%BD",
  );
  assert.deepEqual(parsed, { reportCurrency: "", campaign: ["a", "b"], search: "韓国" });
  assert.deepEqual(parseWorkspaceSearch(stringifyWorkspaceSearch(parsed)), parsed);
  assert.equal(stringifyWorkspaceSearch({}), "");
});

test("route validation accepts repeated filters, normalizes scalar keys, and rejects nonstring values", () => {
  assert.deepEqual(
    validateWorkspaceSearch({
      tab: ["live", "inventory"],
      page: ["2", "3"],
      sku: ["001", "null"],
      reportCurrency: "",
      campaign: ["a", "b"],
      invalid: { nested: "value" },
      number: 3,
    }),
    { tab: "live", page: "2", sku: ["001", "null"], reportCurrency: "", campaign: ["a", "b"] },
  );
});

test("review and report marketplace metadata stay scalar while table marketplace filters repeat", () => {
  const parsed = parseWorkspaceSearch(
    "?reviewMarketplace=Amazon.de&reviewMarketplace=Amazon.fr&marketplace=Amazon.de&marketplace=Amazon.fr&reportMarketplace=&reportCurrency=EUR",
  );
  const validated = validateWorkspaceSearch(parsed);
  assert.deepEqual(validated, {
    reviewMarketplace: "Amazon.de",
    marketplace: ["Amazon.de", "Amazon.fr"],
    reportMarketplace: "",
    reportCurrency: "EUR",
  });
  assert.deepEqual(parseWorkspaceSearch(stringifyWorkspaceSearch(validated)), validated);
});
