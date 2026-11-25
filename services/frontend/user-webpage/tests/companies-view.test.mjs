import assert from "node:assert/strict";
import test from "node:test";
import { companyPageIndex, decodeCompanyList, orderCompanies } from "../src/companies-view.ts";

const company = (id, name, created_at) => ({ id, name, created_at });
const names = (companies) => companies.map(({ name }) => name);

test("saved company lists keep a known sort column and fall back to the name otherwise", () => {
  for (const sortColumn of ["name", "skus", "created"])
    assert.equal(decodeCompanyList({ sortColumn }).sortColumn, sortColumn);
  for (const sortColumn of ["created_at", "email", null, 1])
    assert.equal(decodeCompanyList({ sortColumn }).sortColumn, "name");
});

test("companies order by creation time across offsets, a just-added company last", () => {
  const companies = [
    company("a", "Added", null),
    company("b", "Tokyo", "2026-02-01T08:00:00+09:00"),
    company("c", "Utc", "2026-01-31 23:30:00+00"),
    company("d", "Same time", "2026-01-31T23:30:00Z"),
  ];
  const ascending = orderCompanies(companies, new Map(), {
    sortColumn: "created",
    sortDirection: "asc",
  });
  assert.deepEqual(names(ascending), ["Tokyo", "Same time", "Utc", "Added"]);
  const descending = orderCompanies(companies, new Map(), {
    sortColumn: "created",
    sortDirection: "desc",
  });
  assert.deepEqual(names(descending), ["Added", "Same time", "Utc", "Tokyo"]);
});

test("ordering by creation time rejects a timestamp without an offset", () => {
  assert.throws(
    () =>
      orderCompanies(
        [company("a", "Alpha", "2026-01-31 23:30:00"), company("b", "Beta", null)],
        new Map(),
        { sortColumn: "created", sortDirection: "asc" },
      ),
    /invalid created_at/,
  );
});

test("revealing a company opens the page that lists it, also when the name already existed", () => {
  const companies = Array.from({ length: 60 }, (_, index) =>
    company(
      `id-${String(index).padStart(2, "0")}`,
      `Company ${String(index).padStart(2, "0")}`,
      `2026-01-01T00:${String(index).padStart(2, "0")}:00Z`,
    ),
  );
  const state = (sortDirection) => ({ sortColumn: "created", sortDirection, pageSize: 50 });
  // Add company with an existing name returns that company without its saved timestamp.
  const existing = { ...companies[0], created_at: null };
  assert.equal(companyPageIndex(companies, existing, new Map(), state("asc")), 0);
  assert.equal(companyPageIndex(companies, existing, new Map(), state("desc")), 1);
  // A company just created is the newest until the catalog refreshes.
  const added = company("id-new", "Added", null);
  assert.equal(companyPageIndex(companies, added, new Map(), state("asc")), 1);
  assert.equal(companyPageIndex(companies, added, new Map(), state("desc")), 0);
});
