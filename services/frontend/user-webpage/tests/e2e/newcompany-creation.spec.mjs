import { expect, test } from "@playwright/test";
import { deferred, mockSupabase, signIn } from "./fixtures.mjs";
import {
  COMPANY,
  OTHER_COMPANY,
  editor,
  item,
  openEditor,
  setup,
} from "./sku-configuration-fixtures.mjs";

const pendingUser = "0198b50b-701a-7000-8000-000000000701";
const nameInput = (page) => page.getByLabel("Company name", { exact: true });
const createButton = (page) => page.getByRole("button", { name: "Create company", exact: true });
const membership = (page) => page.getByRole("dialog", { name: "Company membership", exact: true });
const accountRow = (page, email) =>
  page.getByRole("row").filter({ has: page.getByText(email, { exact: true }) });
const companyDetails = (page, name) =>
  page.getByRole("button", { name: `Show details for ${name}`, exact: true });

function addCompanies(fixture, count) {
  for (let index = 1; index <= count; index += 1) {
    fixture.companyNames[`0198b50b-701a-7000-8000-${String(index).padStart(12, "0")}`] =
      `Company ${String(index).padStart(2, "0")}`;
  }
}

async function start(page, configure = () => {}) {
  return setup(page, "administrator", [item("S1")], (fixture) => {
    fixture.roles[pendingUser] = "unassigned";
    fixture.companyIds[pendingUser] = null;
    fixture.accountEmails[pendingUser] = "pending@example.test";
    configure(fixture);
  });
}

async function expectCompanies(page) {
  await expect(page.getByRole("tab", { name: "Companies", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(nameInput(page)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function openCompany(page, parent = page) {
  await parent.getByRole("button", { name: "Add company", exact: true }).click();
  await expectCompanies(page);
}

async function createCompany(page, name) {
  await nameInput(page).fill(name);
  await createButton(page).click();
  await expect(
    page.getByRole("status").filter({
      hasText: `Company added: ${name.trim()}`,
    }),
  ).toBeVisible();
  await expectCompanies(page);
}

async function returnTo(page, tab) {
  await page.getByRole("button", { name: `Return to ${tab}`, exact: true }).click();
  await expect(page.getByRole("tab", { name: tab, exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

async function openMembership(page) {
  await page.getByRole("tab", { name: "User access", exact: true }).click();
  await accountRow(page, "pending@example.test").click();
  await expect(membership(page)).toBeVisible();
}

test("both Add company headers switch tabs and guide the administrator back without changing assignments", async ({
  page,
}) => {
  const fixture = await start(page);
  await openCompany(page);
  await createCompany(page, "Header North");
  await returnTo(page, "Current fees");
  await page.getByRole("tab", { name: "User access", exact: true }).click();
  await openCompany(page);
  await createCompany(page, "Header South");
  await returnTo(page, "User access");
  await accountRow(page, "pending@example.test").click();
  const company = membership(page).getByRole("combobox", { name: "Company", exact: true });
  for (const name of ["Header North", "Header South"]) {
    await company.fill(name);
    await expect(page.getByRole("option", { name, exact: true })).toBeVisible();
  }
  expect(fixture.companyCreationRequests).toHaveLength(2);
  expect(fixture.membershipRequests).toHaveLength(0);
  expect(fixture.configurationSaves).toHaveLength(0);
  expect(fixture.skuConfigurationItems[0].company_id).toBe(COMPANY);
});

for (const role of ["member", "unassigned"]) {
  test(`${role} cannot see the Companies tab or company-creation controls`, async ({ page }) => {
    const fixture = await mockSupabase(page);
    fixture.roles["member-a"] = role;
    await signIn(page);
    if (role === "member") {
      await page.getByRole("tab", { name: "Current fees", exact: true }).click();
      await expect(page.getByRole("tab", { name: "User access", exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByText("Awaiting company access", { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("tab", { name: "Companies", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add company", exact: true })).toHaveCount(0);
    expect(fixture.companyCreationRequests).toHaveLength(0);
  });
}

test("creating from the fee editor preserves its unfinished draft across tab switching and reload", async ({
  page,
}) => {
  const fixture = await start(page);
  await openEditor(page);
  await editor(page).getByLabel("Fee rate 1 (%)", { exact: true }).fill("6.25");
  await openCompany(page, editor(page));
  await nameInput(page).fill("Draft Company");
  await page.reload();
  await expectCompanies(page);
  await expect(nameInput(page)).toHaveValue("Draft Company");
  expect(fixture.companyCreationRequests).toHaveLength(0);
  await createButton(page).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Company added: Draft Company" }),
  ).toBeVisible();
  await returnTo(page, "Current fees");
  await expect(editor(page)).toBeVisible();
  await expect(editor(page).getByLabel("Fee rate 1 (%)", { exact: true })).toHaveValue("6.25");
  const company = editor(page).getByRole("combobox", { name: "Company", exact: true });
  await expect(company).toHaveValue(COMPANY);
  const newId = fixture.companyCreationRequests[0].result.id;
  await company.selectOption(newId);
  await page.reload();
  await expect(editor(page)).toBeVisible();
  await expect(company).toHaveValue(newId);
  await expect(editor(page).getByLabel("Fee rate 1 (%)", { exact: true })).toHaveValue("6.25");
  expect(fixture.companyCreationRequests).toHaveLength(1);
  expect(fixture.configurationSaves).toHaveLength(0);
});

test("membership creation detour retains the selected user and draft but requires choosing and saving membership", async ({
  page,
}) => {
  const fixture = await start(page);
  await openMembership(page);
  const company = membership(page).getByRole("combobox", { name: "Company", exact: true });
  await company.fill("Beta Company");
  await page.getByRole("option", { name: "Beta Company", exact: true }).click();
  await openCompany(page, membership(page));
  await createCompany(page, "Membership Company");
  await page.reload();
  await expectCompanies(page);
  await returnTo(page, "User access");
  await expect(membership(page)).toBeVisible();
  await expect(company).toHaveValue("Beta Company");
  await expect(accountRow(page, "pending@example.test")).toContainText("Unassigned");
  expect(fixture.membershipRequests).toHaveLength(0);
  await company.fill("Membership Company");
  await page.getByRole("option", { name: "Membership Company", exact: true }).click();
  await membership(page).getByRole("button", { name: "Save membership", exact: true }).click();
  await expect(accountRow(page, "pending@example.test")).toContainText("Membership Company");
  expect(fixture.membershipRequests).toHaveLength(1);
  expect(fixture.membershipRequests[0].body.target_company_id).toBe(
    fixture.companyCreationRequests[0].result.id,
  );
  expect(fixture.companyIds[pendingUser]).not.toBe(OTHER_COMPANY);
});

test("pending, duplicate, failed and uncertain creation attempts never automatically replay or duplicate companies", async ({
  page,
}) => {
  const fixture = await start(page);
  const initialCompanies = Object.keys(fixture.companyNames).length;
  await openCompany(page);
  await nameInput(page).fill("  alpha COMPANY  ");
  await createButton(page).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Company already exists: Alpha Company" }),
  ).toBeVisible();
  expect(Object.keys(fixture.companyNames)).toHaveLength(initialCompanies);
  const started = deferred();
  const release = deferred();
  fixture.beforeCompanyCreation = async () => {
    started.resolve();
    await release.promise;
  };
  fixture.companyCreationStatus = 503;
  await nameInput(page).fill("Retry Company");
  try {
    await nameInput(page).press("Enter");
    await started.promise;
    await expect(createButton(page)).toBeDisabled();
    await page.keyboard.press("Enter");
    expect(fixture.companyCreationRequests).toHaveLength(2);
    release.resolve();
    await expect(
      page.getByRole("region", { name: "Add company", exact: true }).getByRole("alert"),
    ).toBeVisible();
  } finally {
    release.resolve();
  }
  await expect(nameInput(page)).toHaveValue("Retry Company");
  expect(Object.keys(fixture.companyNames)).toHaveLength(initialCompanies);
  fixture.companyCreationStatus = 200;
  fixture.companyCreationNetworkFailure = true;
  await createButton(page).click();
  await expect(createButton(page)).toBeEnabled();
  await expect(
    page.getByRole("region", { name: "Add company", exact: true }).getByRole("alert"),
  ).toBeVisible();
  expect(fixture.companyCreationRequests).toHaveLength(3);
  expect(Object.keys(fixture.companyNames)).toHaveLength(initialCompanies + 1);
  fixture.companyCreationNetworkFailure = false;
  await createButton(page).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Company already exists: Retry Company" }),
  ).toBeVisible();
  expect(fixture.companyCreationRequests).toHaveLength(4);
  expect(fixture.companyCreationRequests[3].result).toEqual({
    ...fixture.companyCreationRequests[2].result,
    created: false,
  });
  expect(Object.keys(fixture.companyNames)).toHaveLength(initialCompanies + 1);
  await page.reload();
  await expectCompanies(page);
  expect(fixture.companyCreationRequests).toHaveLength(4);
  expect(fixture.configurationSaves).toHaveLength(0);
  expect(fixture.membershipRequests).toHaveLength(0);
});

test("Companies lists saved company details and opens exact SKU transactions or company-filtered members", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await start(page);
  await page.getByRole("tab", { name: "Companies", exact: true }).click();
  await expectCompanies(page);
  await expect(page.getByRole("button", { name: /^Return to / })).toHaveCount(0);
  await companyDetails(page, "Alpha Company").click();
  await expect(page.getByText(COMPANY, { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("companies-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Show transactions for S1", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Transactions", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect
    .poll(() => fixture.requests.filter((entry) => entry.args?.p_skus).at(-1)?.args.p_skus)
    .toEqual(["S1"]);
  await page.getByRole("tab", { name: "Companies", exact: true }).click();
  await companyDetails(page, "Beta Company").click();
  await expect(
    page.getByText("No SKUs are assigned to this company.", { exact: true }),
  ).toBeVisible();
  await page
    .locator(".mantine-Accordion-item")
    .filter({ has: companyDetails(page, "Beta Company") })
    .getByRole("button", { name: "View members", exact: true })
    .click();
  await expect(page.getByRole("tab", { name: "User access", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(accountRow(page, "member-b@example.test")).toBeVisible();
  await expect(accountRow(page, "pending@example.test")).toHaveCount(0);
  await expect
    .poll(() =>
      fixture.requests
        .filter((entry) => entry.dataset === "accounts")
        .at(-1)
        ?.params.get("company_id"),
    )
    .toBe(`in.(${OTHER_COMPANY})`);
  await page.reload();
  await expect(accountRow(page, "member-b@example.test")).toBeVisible();
  await expect(accountRow(page, "pending@example.test")).toHaveCount(0);
});

test("creation reveals the result using the current page size and keeps details expanded while the request was pending", async ({
  page,
}) => {
  const fixture = await start(page, (fixture) => addCompanies(fixture, 80));
  await page.getByRole("tab", { name: "Companies", exact: true }).click();
  const started = deferred();
  const release = deferred();
  fixture.beforeCompanyCreation = async () => {
    started.resolve();
    await release.promise;
  };
  await nameInput(page).fill("Company 40a");
  try {
    await createButton(page).click();
    await started.promise;
    await page.getByLabel("Rows", { exact: true }).selectOption("50");
    await companyDetails(page, "Company 02").click();
    release.resolve();
    await expect(
      page.getByRole("status").filter({ hasText: "Company added: Company 40a" }),
    ).toBeVisible();
    await expect(page.getByRole("form", { name: "Page 1 of 2", exact: true })).toBeVisible();
    await expect(companyDetails(page, "Company 40a")).toHaveAttribute("aria-expanded", "true");
    await expect(companyDetails(page, "Company 02")).toHaveAttribute("aria-expanded", "true");
  } finally {
    release.resolve();
  }
  expect(fixture.companyCreationRequests).toHaveLength(1);
});

test("company search, rows, pagination and expanded details persist across reload", async ({
  page,
}) => {
  await start(page, (fixture) => addCompanies(fixture, 30));
  await page.getByRole("tab", { name: "Companies", exact: true }).click();
  const search = page.getByLabel("Search companies", { exact: true });
  await page.getByLabel("Rows", { exact: true }).selectOption("25");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await companyDetails(page, "Company 30").click();
  await page.reload();
  await expect(page.getByRole("form", { name: "Page 2 of 2", exact: true })).toBeVisible();
  await expect(companyDetails(page, "Company 30")).toHaveAttribute("aria-expanded", "true");
  await search.fill("alpha");
  await expect(companyDetails(page, "Alpha Company")).toBeVisible();
  await expect(companyDetails(page, "Company 30")).toHaveCount(0);
  await page.getByLabel("Rows", { exact: true }).selectOption("50");
  await page.reload();
  await expect(search).toHaveValue("alpha");
  await expect(page.getByLabel("Rows", { exact: true })).toHaveValue("50");
  await expect(companyDetails(page, "Alpha Company")).toBeVisible();
});

test.describe("phone company creation", () => {
  test.use({ isMobile: true, hasTouch: true });
  for (const [orientation, viewport] of [
    ["portrait", { width: 390, height: 844 }],
    ["landscape", { width: 844, height: 390 }],
  ]) {
    test(`${orientation} uses a readable inline form and restores the fee editor after its creation detour`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      const fixture = await start(page);
      await openEditor(page);
      await openCompany(page, editor(page));
      await nameInput(page).scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          nameInput(page).evaluate((element) =>
            Number.parseFloat(globalThis.getComputedStyle(element).fontSize),
          ),
        )
        .toBeGreaterThanOrEqual(16);
      await createButton(page).scrollIntoViewIfNeeded();
      await expect(createButton(page)).toBeInViewport({ ratio: 1 });
      await createCompany(page, "Phone Company");
      expect(
        await page.evaluate(
          () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`companies-${orientation}.png`),
        fullPage: true,
        animations: "disabled",
      });
      await returnTo(page, "Current fees");
      await expect(editor(page)).toBeVisible();
      await expect(
        editor(page).getByRole("combobox", { name: "Company", exact: true }),
      ).toHaveValue(COMPANY);
      expect(fixture.companyCreationRequests).toHaveLength(1);
      expect(fixture.configurationSaves).toHaveLength(0);
      expect(fixture.membershipRequests).toHaveLength(0);
    });
  }
});
