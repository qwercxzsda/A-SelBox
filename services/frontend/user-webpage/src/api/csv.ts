export type CsvRecord = Record<string, string | null>;

interface CsvCell {
  quoted: boolean;
  value: string;
}

function parseCsvRows(csv: string): CsvCell[][] {
  const rows: CsvCell[][] = [];
  let row: CsvCell[] = [];
  let field = "";
  let fieldQuoted = false;
  let inQuotes = false;
  let closedQuote = false;

  const finishField = (): void => {
    row.push({ quoted: fieldQuoted, value: field });
    field = "";
    fieldQuoted = false;
    closedQuote = false;
  };

  const finishRow = (): void => {
    finishField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];

    if (inQuotes) {
      if (character === '"') {
        if (csv[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          closedQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (closedQuote && character !== "," && character !== "\r" && character !== "\n") {
      throw new Error("CSV contains characters after a closing quote");
    }

    if (character === '"') {
      if (field.length > 0) {
        throw new Error("CSV contains a quote inside an unquoted field");
      }
      fieldQuoted = true;
      inQuotes = true;
    } else if (character === ",") {
      finishField();
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && csv[index + 1] === "\n") {
        index += 1;
      }
      finishRow();
    } else {
      field += character;
    }
  }

  if (inQuotes) {
    throw new Error("CSV contains an unterminated quoted field");
  }

  if (closedQuote || field.length > 0 || row.length > 0) {
    finishRow();
  }

  return rows;
}

export function parseCsv(csv: string): CsvRecord[] {
  if (/^[\r\n]*$/.test(csv)) {
    return [];
  }

  const rows = parseCsvRows(csv);
  if (rows.length === 0) {
    return [];
  }

  const headers = rows[0].map((header, index) =>
    index === 0 ? header.value.replace(/^\uFEFF/, "") : header.value,
  );
  if (headers.some((header) => header.length === 0)) {
    throw new Error("CSV contains a blank header");
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error("CSV contains duplicate headers");
  }

  return rows.slice(1).map((values) => {
    if (values.length !== headers.length) {
      throw new Error("CSV row has an unexpected number of fields");
    }

    const record: CsvRecord = Object.create(null) as CsvRecord;
    headers.forEach((header, index) => {
      const cell = values[index];
      record[header] = cell.value === "" && !cell.quoted ? null : cell.value;
    });
    return record;
  });
}
