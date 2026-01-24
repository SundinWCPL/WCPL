// js/data.js
// Contract: blanks stay blanks. Numeric parsing returns null for "".

export async function loadCSV(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${path} (HTTP ${res.status})`);
  const text = await res.text();
  return parseCSV(text);
}

export function parseCSV(text) {
  const cleaned = text.replace(/^\uFEFF/, "").trim();
  if (!cleaned) return [];

  const lines = cleaned.split(/\r?\n/);
  const headers = splitCSVLine(lines[0]).map(h => h.trim());

  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;

    const cols = splitCSVLine(line);
    const row = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = (cols[c] ?? "").trim();
    }
    out.push(row);
  }
  return out;
}

// Handles commas inside quotes and escaped quotes ("")
function splitCSVLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function toIntMaybe(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function toNumMaybe(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function truthy01(v) {
  // seasons.csv uses 1/0. Treat blank as 0.
  const n = toIntMaybe(v);
  return n === 1;
}
