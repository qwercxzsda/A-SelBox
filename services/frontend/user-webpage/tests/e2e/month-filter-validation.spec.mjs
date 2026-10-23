import { expect, test } from "@playwright/test";
import { mockSupabase, signIn } from "./fixtures.mjs";

test("invalid text in a month-input fallback stays editable and identifies the invalid field", async ({
  page,
}) => {
  await mockSupabase(page);
  await signIn(page);
  await page.getByRole("tab", { name: "Payout reports", exact: true }).click();
  await page.getByRole("button", { name: "Month", exact: true }).click();
  const options = page.getByRole("dialog", { name: "Month options", exact: true });
  const month = options.getByLabel("Report month", { exact: true });
  test.skip(
    (await month.evaluate((input) => input.type)) === "month",
    "Native month inputs prevent malformed typed values; this case covers the text fallback.",
  );
  await month.fill("2026-13");
  await options.getByRole("button", { name: "Apply month", exact: true }).click();
  await expect(month).toBeFocused();
  await expect(month).toHaveValue("2026-13");
  await expect(month).toHaveAttribute("aria-invalid", "true");
  await expect(month).toHaveAccessibleDescription("Choose a valid month.");
  await expect(options.getByRole("alert")).toHaveText("Choose a valid month.");
  expect(new URL(page.url()).searchParams.has("from")).toBe(false);

  await month.fill("2026-07");
  await expect(month).toBeFocused();
  await expect(month).not.toHaveAttribute("aria-invalid", "true");
  await expect(options.getByRole("alert")).toHaveCount(0);
  await options.getByRole("button", { name: "Apply month", exact: true }).click();
  await expect(options).toBeHidden();
  await expect.poll(() => new URL(page.url()).searchParams.get("from")).toBe("2026-07-01");
});
