import { searchValues } from "./search-fixtures.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createApiClient } from "../src/api/client.ts";
import { DATASET_CONFIG } from "../src/api/config.ts";
import { SETTINGS, responseJson, datasetRecord, csvRecord, pageRequest } from "./api-fixtures.mjs";

test("206 CSV pages retain exact money and stable dataset-specific ordering", async () => {
  for (const dataset of ["payouts", "accounts"]) {
    let requested;
    const record = datasetRecord(dataset);
    const client = createApiClient(SETTINGS, async (url, init) => {
      requested = { url: new URL(url), init };
      return new Response(csvRecord(record), {
        status: 206,
        headers: { "Content-Range": "25-25/129", "Content-Type": "text/csv" },
      });
    });
    const result = await client.fetchDatasetPage(
      pageRequest(dataset, {
        pageIndex: 1,
        search: "row",
        searchValues: searchValues({ skus: ["row"] }),
      }),
    );
    assert.equal(result.totalCount, 129);
    assert.equal(result.rows.length, 1);
    assert.equal(requested.url.searchParams.get("offset"), "25");
    assert.equal(requested.url.searchParams.get("limit"), "25");
    const orderedColumns = requested.url.searchParams
      .get("order")
      .split(",")
      .map((term) => term.split(".")[0]);
    assert.equal(new Set(orderedColumns).size, orderedColumns.length);
    for (const column of DATASET_CONFIG[dataset].idColumns)
      assert.ok(orderedColumns.includes(column));
    assert.equal(new Headers(requested.init.headers).get("Accept"), "text/csv");
    assert.equal(new Headers(requested.init.headers).get("Authorization"), "Bearer test-access");
  }
});

test("416 page responses retain the count needed to clamp pagination", async () => {
  const client = createApiClient(
    SETTINGS,
    async () => new Response("", { status: 416, headers: { "Content-Range": "*/10" } }),
  );
  assert.deepEqual(
    await client.fetchDatasetPage(
      pageRequest("payouts", {
        pageIndex: 9,
        search: "row",
        searchValues: searchValues({ skus: ["row"] }),
      }),
    ),
    {
      rows: [],
      totalCount: 10,
    },
  );
});

test("invalid local pagination and sorting fail before any HTTP request", async () => {
  let requests = 0;
  const client = createApiClient(SETTINGS, async () => {
    requests += 1;
    return responseJson([]);
  });
  for (const overrides of [
    { pageIndex: -1 },
    { pageSize: 0 },
    { pageIndex: Number.MAX_SAFE_INTEGER, pageSize: 100 },
    { sort: { column: "unsupported_column", direction: "asc" } },
  ]) {
    await assert.rejects(client.fetchDatasetPage(pageRequest("live", overrides)));
  }
  assert.equal(requests, 0);
});

test("forbidden source reads are errors rather than successful empty pages", async () => {
  const client = createApiClient(SETTINGS, async () =>
    responseJson({ message: "private source details" }, 403),
  );
  await assert.rejects(
    client.fetchDatasetPage(pageRequest()),
    (error) =>
      error instanceof ApiError &&
      error.status === 403 &&
      !error.message.includes("private source details"),
  );
});

test("dataset cancellation forwards the signal and preserves the abort reason", async () => {
  const controller = new AbortController();
  const client = createApiClient(SETTINGS, async (_url, { signal }) => {
    assert.equal(signal, controller.signal);
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  });
  const request = client.fetchDatasetPage(pageRequest("live", { signal: controller.signal }));
  const aborted = assert.rejects(request, (error) => error === controller.signal.reason);
  controller.abort();
  await aborted;
});

test("transport failures have a retryable status without exposing private network details", async () => {
  const client = createApiClient(SETTINGS, async () => {
    throw new TypeError("private network detail");
  });
  await assert.rejects(
    client.fetchDatasetPage(pageRequest()),
    (error) =>
      error instanceof ApiError &&
      error.status === null &&
      !error.message.includes("private network detail"),
  );
});

test("resolved search values stay literal JSON arrays on all three transaction tabs", async () => {
  const search = ' SKU_100%*,or(source.eq.DATA_KIOSK)"\\ 한글 ';
  for (const dataset of ["live", "settlement", "data_kiosk"]) {
    const client = createApiClient(SETTINGS, async (url, init) => {
      assert.equal(new URL(url).search, "");
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body).p_search_skus, [search.trim()]);
      assert.equal("p_search" in JSON.parse(init.body), false);
      assert.equal(JSON.parse(init.body).p_offset, 50);
      assert.equal(
        new URL(url).pathname,
        `/rest/v1/rpc/${dataset === "live" ? "transaction_page" : "source_transaction_page"}`,
      );
      return responseJson({ rows: [], total_count: "0" });
    });
    await client.fetchDatasetPage(
      pageRequest(dataset, {
        search,
        searchValues: searchValues({ skus: [search.trim()] }),
        pageIndex: 2,
      }),
    );
  }
});

test("SKU fee expansion reads every marketplace period despite a smaller server page cap", async () => {
  const sellerSkuId = "0198b50b-701a-7000-8000-000000000001";
  const records = ["Amazon.com", "Amazon.ca", "Amazon.co.jp"].map((marketplace, index) =>
    datasetRecord("fees", {
      seller_sku_id: sellerSkuId,
      marketplace_name: marketplace,
      fee_period_id: `period-${String(index)}`,
      fee_rate_percent: "4.123456",
    }),
  );
  const offsets = [];
  const signal = new AbortController().signal;
  const client = createApiClient(SETTINGS, async (url, init) => {
    const params = new URL(url).searchParams;
    const offset = Number(params.get("offset"));
    offsets.push(offset);
    assert.equal(params.get("seller_sku_id"), `eq.${sellerSkuId}`);
    assert.equal(params.get("order"), "marketplace_name.asc,valid_period.asc,fee_period_id.asc");
    assert.equal(init.signal, signal);
    const page = records.slice(offset, offset + 2);
    const csv = page
      .map((record, index) => (index === 0 ? csvRecord(record) : csvRecord(record).split("\n")[1]))
      .join("\n");
    return new Response(csv, {
      status: 206,
      headers: { "Content-Range": `${String(offset)}-${String(offset + page.length - 1)}/3` },
    });
  });
  const result = await client.fetchSkuFees("test-access", sellerSkuId, signal);
  assert.deepEqual(offsets, [0, 2]);
  assert.deepEqual(
    result.map((row) => row.marketplace_name),
    records.map((row) => row.marketplace_name),
  );
  assert.ok(result.every((row) => row.fee_rate_percent === "4.123456"));
  await assert.rejects(client.fetchSkuFees("test-access", "invalid-id"), /valid seller SKU ID/);
});

test("body-read failures preserve cancellations and classify interrupted downloads without exposing details", async () => {
  for (const dataset of ["live", "payouts"]) {
    for (const kind of ["network", "abort", "cancelled"]) {
      const controller = new AbortController();
      const failure =
        kind === "abort"
          ? new DOMException("Cancelled", "AbortError")
          : new TypeError("private download detail");
      const client = createApiClient(SETTINGS, async () => {
        if (kind === "cancelled") controller.abort(failure);
        return new Response(
          new ReadableStream({
            start(stream) {
              stream.error(failure);
            },
          }),
        );
      });
      await assert.rejects(
        client.fetchDatasetPage(
          pageRequest(dataset, {
            search: "literal search",
            searchValues: searchValues(),
            signal: controller.signal,
          }),
        ),
        (error) => {
          if (kind !== "network") assert.equal(error, failure);
          else {
            assert.ok(error instanceof ApiError);
            assert.equal(error.status, null);
            assert.equal(error.message.includes("private download"), false);
          }
          return true;
        },
      );
    }
  }
  const invalid = createApiClient(SETTINGS, async () => new Response("{"));
  await assert.rejects(invalid.fetchDatasetPage(pageRequest()), (error) => {
    assert.equal(error instanceof ApiError, false);
    assert.match(error.message, /invalid JSON/);
    return true;
  });
});

test("multi-page fee reads refuse repeated identities and incomplete responses", async () => {
  const id = "0198b50b-701a-7000-8000-000000000001";
  for (const repeated of [true, false]) {
    let calls = 0;
    const client = createApiClient(SETTINGS, async (_url, init) => {
      calls += 1;
      assert.equal(new Headers(init.headers).has("Prefer"), calls === 1);
      return new Response(
        repeated || calls === 1 ? csvRecord(datasetRecord("fees", { fee_period_id: "fee-1" })) : "",
        {
          headers: { "Content-Range": calls === 1 ? "0-0/2" : "*/*" },
        },
      );
    });
    await assert.rejects(
      client.fetchSkuFees("token", id),
      repeated ? /did not advance/ : /incomplete page/,
    );
    assert.equal(calls, 2);
  }
});
