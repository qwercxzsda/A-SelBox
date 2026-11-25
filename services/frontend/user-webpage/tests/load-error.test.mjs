import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "../src/api/transport.ts";
import { loadErrorDetail } from "../src/load-error.ts";

test("HTTP failures give the status as the cause, without the subject", () => {
  assert.equal(loadErrorDetail(new ApiError("Inventory", 503)), "The server returned HTTP 503.");
});

test("network failures and timeouts are told apart", () => {
  assert.equal(loadErrorDetail(new ApiError("Current fees", null)), "No response from the server.");
  assert.equal(loadErrorDetail(new ApiError("Current fees", null, true)), "The request timed out.");
});

test("other errors keep their own sentence, ending with one period", () => {
  assert.equal(
    loadErrorDetail(new Error("Inventory returned an incomplete row")),
    "Inventory returned an incomplete row.",
  );
  assert.equal(
    loadErrorDetail(new Error("Inventory changed while loading.")),
    "Inventory changed while loading.",
  );
  assert.equal(loadErrorDetail("unexpected"), "Unexpected request failure.");
  assert.equal(loadErrorDetail(new Error("  ")), "Unexpected request failure.");
});
