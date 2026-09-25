import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient } from "../src/api/client.ts";
import {
  AMOUNT_ORDER_LIMIT_MESSAGE,
  AmountOrderingLimitError,
} from "../src/api/amount-ordering.ts";
import { pageRequest, responseJson, SETTINGS } from "./api-fixtures.mjs";

test("amount page limits become actionable errors without exposing other database details", async () => {
  for (const dataset of ["live", "settlement", "data_kiosk"]) {
    const client = createApiClient(SETTINGS, async () =>
      responseJson(
        {
          code: "22023",
          message: AMOUNT_ORDER_LIMIT_MESSAGE,
          details: "private database detail",
          hint: "private hint",
        },
        400,
      ),
    );
    await assert.rejects(
      client.fetchDatasetPage(
        pageRequest(dataset, {
          sort: { column: dataset === "live" ? "source_amount" : "amount", direction: "desc" },
        }),
      ),
      (error) => {
        assert.ok(error instanceof AmountOrderingLimitError);
        assert.equal(error.message, AMOUNT_ORDER_LIMIT_MESSAGE);
        assert.equal(error.message.includes("private"), false);
        return true;
      },
    );
  }
});

test("only the exact amount-limit contract is exposed and failed RPCs never fall back", async () => {
  for (const [dataset, column, code, message, status] of [
    ["live", "source_amount", "22023", "private SQL detail", 400],
    ["live", "source_amount", "42501", AMOUNT_ORDER_LIMIT_MESSAGE, 400],
    ["live", "activity_date", "22023", AMOUNT_ORDER_LIMIT_MESSAGE, 400],
    ["data_kiosk", "amount", "22023", AMOUNT_ORDER_LIMIT_MESSAGE, 503],
  ]) {
    let requests = 0;
    const client = createApiClient(SETTINGS, async () => {
      requests += 1;
      return responseJson({ code, message }, status);
    });
    await assert.rejects(
      client.fetchDatasetPage(pageRequest(dataset, { sort: { column, direction: "desc" } })),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, status);
        assert.equal(error.message.includes(message), false);
        return true;
      },
    );
    assert.equal(requests, 1);
  }
  const malformed = createApiClient(
    SETTINGS,
    async () => new Response("private non-JSON error", { status: 400 }),
  );
  await assert.rejects(
    malformed.fetchDatasetPage(
      pageRequest("live", { sort: { column: "source_amount", direction: "asc" } }),
    ),
    ApiError,
  );
});
