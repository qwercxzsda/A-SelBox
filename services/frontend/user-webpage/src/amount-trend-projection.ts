import { compareAbsoluteDecimals } from "./decimal.ts";

export function chartScale(values: readonly string[]) {
  let minimum = "0";
  let maximum = "0";
  for (const value of values) {
    if (value.startsWith("-")) {
      if (compareAbsoluteDecimals(value, minimum) > 0) minimum = value;
    } else if (compareAbsoluteDecimals(value, maximum) > 0) maximum = value;
  }
  const numericMinimum = Number(minimum);
  const numericMaximum = Number(maximum);
  if (!Number.isFinite(numericMinimum) || !Number.isFinite(numericMaximum))
    throw new Error("Chart values cannot be projected");
  const magnitude = Math.max(1, Math.abs(numericMinimum), numericMaximum);
  const low = numericMinimum / magnitude;
  const high = numericMaximum / magnitude;
  const padding = (high - low || 1) * 0.12;
  const y = (value: string) =>
    ((high + padding - Number(value) / magnitude) / (high - low + padding * 2)) * 100;
  const ticks = [...new Set([maximum, "0", minimum])]
    .map((value) => ({ value, y: y(value) }))
    // A small opposite-sign value may sit directly beside zero on a shared scale.
    .filter((tick) => tick.value === "0" || Math.abs(tick.y - y("0")) >= 8);
  return { y, ticks };
}

export function chartLines(
  indices: readonly number[],
  positions: readonly number[],
  periodCount: number,
): string[] {
  const segments: string[][] = [];
  for (const [index, periodIndex] of indices.entries()) {
    if (index === 0 || indices[index - 1] !== periodIndex - 1) segments.push([]);
    segments[segments.length - 1].push(
      `${String(((periodIndex + 0.5) / periodCount) * 1000)},${String(positions[index] * 2)}`,
    );
  }
  return segments.map((segment) => segment.join(" "));
}
