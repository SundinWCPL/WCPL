import fs from "fs";
import Papa from "papaparse";

export function readCsvWithHeader(filePath) {
  if (!fs.existsSync(filePath)) return { header: null, rows: [] };
  const text = fs.readFileSync(filePath, "utf8");
  if (!text.trim()) return { header: null, rows: [] };

  const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
  const headerLine = lines[0] ?? "";
  const header = headerLine.split(",").map(s => s.trim());

  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  if (parsed.errors?.length) {
    throw new Error(`CSV parse error in ${filePath}: ${parsed.errors[0].message}`);
  }
  return { header, rows: parsed.data };
}

export function writeCsv(filePath, header, rows) {
  const csv = Papa.unparse(rows, { columns: header });
  fs.writeFileSync(filePath, csv + "\n", "utf8");
}

export function upsertByKey({ rows, keyField, keyValue, newRow }) {
  const kv = String(keyValue);
  const idx = rows.findIndex(r => String(r[keyField]) === kv);
  if (idx === -1) {
    return { rows: [...rows, newRow], action: "insert" };
  }
  const merged = { ...rows[idx], ...newRow };
  const out = rows.slice();
  out[idx] = merged;
  return { rows: out, action: "update" };
}
