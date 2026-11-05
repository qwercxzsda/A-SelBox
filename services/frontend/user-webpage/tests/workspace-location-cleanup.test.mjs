import assert from "node:assert/strict";
import test from "node:test";
import { withoutWorkspaceLocation } from "../src/workspace-location-cleanup.ts";

test("logout clears workspace navigation while preserving unrelated URL state", () => {
  const url = new URL(
    "https://example.test/app?tab=inventory&sku=A&sku=B&health=low&reviewMarketplace=Amazon.de&report=saved&reportCurrency=EUR&reportMarketplace=Amazon.de&campaign=help#instructions",
  );
  const next = withoutWorkspaceLocation(url);
  assert.equal(next.href, "https://example.test/app?campaign=help#instructions");
  assert.equal(url.searchParams.get("tab"), "inventory");
  assert.deepEqual(url.searchParams.getAll("sku"), ["A", "B"]);
});
