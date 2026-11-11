import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../src/api/client.ts";
import { decodeFinancialSourceSelection } from "../src/api/financial-source.ts";
import {
  SETTINGS,
  COMPANY_ID,
  OTHER_COMPANY_ID,
  datasetRecord,
  responseJson,
} from "./api-fixtures.mjs";

const selection = { source: "FINANCES", rowId: COMPANY_ID, versionId: OTHER_COMPANY_ID };
const record = datasetRecord("finances", {
  id: selection.rowId,
  version_id: selection.versionId,
  amount: "9007199254740993.000000001",
  native_transaction_id: "NATIVE-EXACT",
});

test("source record uses exact row and version and keeps monetary text", async () => {
  const client = createApiClient(SETTINGS, async (url, init) => {
    assert.equal(new URL(url).pathname, "/rest/v1/rpc/financial_source_record");
    assert.deepEqual(JSON.parse(init.body), {
      p_source: "FINANCES",
      p_row_id: selection.rowId,
      p_version_id: selection.versionId,
    });
    return responseJson(record);
  });
  const result = await client.fetchFinancialSourceRecord("access", selection);
  assert.equal(result.amount, record.amount);
  assert.equal(result.id, record.id);
});

test("native ID lookup is exact, bounded, and distinguishes retained observations", async () => {
  const client = createApiClient(SETTINGS, async (url, init) => {
    assert.equal(new URL(url).pathname, "/rest/v1/rpc/financial_source_transaction_lookup");
    assert.deepEqual(JSON.parse(init.body), {
      p_native_transaction_id: "NATIVE-EXACT",
      p_limit: 26,
      p_offset: 25,
    });
    return responseJson(Array.from({ length: 26 }, () => ({ ...record, is_current: "false" })));
  });
  const result = await client.fetchFinancialSourceTransactions("access", "NATIVE-EXACT", 1);
  assert.equal(result.rows.length, 25);
  assert.equal(result.hasNext, true);
  assert.equal(result.rows[0].is_current, "false");
  assert.equal(result.rows[0].amount, record.amount);
});

test("source detail fails closed on substituted version or numeric JSON amounts", async () => {
  for (const response of [
    { ...record, version_id: COMPANY_ID },
    { ...record, amount: 0 },
  ]) {
    const client = createApiClient(SETTINGS, async () => responseJson(response));
    await assert.rejects(client.fetchFinancialSourceRecord("access", selection));
  }
  const client = createApiClient(SETTINGS, async () => responseJson(null));
  assert.equal(await client.fetchFinancialSourceRecord("access", selection), null);
  assert.equal(decodeFinancialSourceSelection({ ...selection, rowId: "not-id" }), null);
});

test("lookup rejects malformed requests and mismatched native IDs", async () => {
  const noRequest = createApiClient(SETTINGS, () => assert.fail("Unexpected request"));
  for (const id of ["", " ", "a".repeat(513)])
    await assert.rejects(noRequest.fetchFinancialSourceTransactions("access", id));
  await assert.rejects(noRequest.fetchFinancialSourceTransactions("access", "native", -1));
  const client = createApiClient(SETTINGS, async () =>
    responseJson([{ ...record, native_transaction_id: "wrong", is_current: "true" }]),
  );
  await assert.rejects(client.fetchFinancialSourceTransactions("access", "NATIVE-EXACT"));
});
