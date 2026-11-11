import { isJsonObject } from "./validation.ts";

/** Machine-readable error details are the contract; database diagnostic text stays private. */
export function rpcErrorDetails(body: unknown) {
  if (!isJsonObject(body) || typeof body.code !== "string" || typeof body.details !== "string")
    return null;
  try {
    const detail: unknown = JSON.parse(body.details);
    return isJsonObject(detail) ? { sqlstate: body.code, detail } : null;
  } catch {
    return null;
  }
}
