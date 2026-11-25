import { PAGE_SIZES } from "./view-model.ts";

// Decoders for list state read back from browser storage or a shared link. A value outside
// these shapes falls back to the default, because the saved state is only a convenience.

/** Bounded text without NUL characters. */
export const isSavedText = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 10000 && !value.includes("\0");

export const savedText = (value: unknown) => (isSavedText(value) ? value : "");

export const savedPageIndex = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;

export const savedPageSize = (value: unknown) =>
  PAGE_SIZES.find((size) => size === value) ?? PAGE_SIZES[0];
