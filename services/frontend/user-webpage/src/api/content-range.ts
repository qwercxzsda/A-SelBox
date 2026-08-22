export function parseTotalCount(contentRange: string | null): number | null {
  if (contentRange === null) {
    return null;
  }

  const separatorIndex = contentRange.lastIndexOf("/");
  if (separatorIndex === -1) {
    throw new Error("Data response has an invalid Content-Range header");
  }

  const totalText = contentRange.slice(separatorIndex + 1);
  if (totalText === "*") {
    return null;
  }
  if (!/^\d+$/.test(totalText)) {
    throw new Error("Data response has an invalid total count");
  }

  const total = Number(totalText);
  if (!Number.isSafeInteger(total)) {
    throw new Error("Data response total count exceeds JavaScript's safe range");
  }
  return total;
}
