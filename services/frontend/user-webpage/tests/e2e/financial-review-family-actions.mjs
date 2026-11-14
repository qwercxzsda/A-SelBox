import { columnTrigger } from "./table-actions.mjs";

export const familyTrigger = (page) => columnTrigger(page, "Type families");
export const familyMenu = (page) =>
  page.getByRole("dialog", { name: "Type families options", exact: true });

export async function chooseFamilies(page, names) {
  await familyTrigger(page).click();
  for (const name of names)
    await familyMenu(page).getByRole("checkbox", { name, exact: true }).check();
  await familyMenu(page).getByRole("button", { name: "Done", exact: true }).click();
}

export async function clearFamilies(page) {
  await familyTrigger(page).click();
  await familyMenu(page)
    .getByRole("button", { name: "Clear type families", exact: true })
    .press("Enter");
  await familyMenu(page).getByRole("button", { name: "Done", exact: true }).press("Enter");
}
