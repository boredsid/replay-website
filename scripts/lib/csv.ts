// scripts/lib/csv.ts
// Minimal RFC-4180-ish CSV parser. Handles quoted fields, embedded commas,
// embedded newlines, and "" escaped quotes. Returns objects keyed by header.
// No I/O — operates on an already-read string.

export function parseCsv(text: string): Record<string, string>[] {
  const rows = parseRows(text);
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    if (cells.length === 1 && cells[0].trim() === '') continue; // blank line
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (cells[idx] ?? '').trim();
    });
    out.push(obj);
  }
  return out;
}

function parseRows(text: string): string[][] {
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (s.length === 0) return [];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  row.push(field);
  rows.push(row);
  return rows;
}
