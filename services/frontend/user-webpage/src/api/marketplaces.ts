import marketplaces from "../generated/marketplaces.json" with { type: "json" };

export function isMarketplace(value: unknown): value is string {
  return typeof value === "string" && marketplaces.includes(value);
}

export function requireMarketplace(value: unknown): asserts value is string {
  if (!isMarketplace(value)) throw new Error("Choose a valid marketplace");
}
