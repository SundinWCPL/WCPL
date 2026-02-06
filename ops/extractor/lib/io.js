import fs from "fs";
import Papa from "papaparse";

export function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

export function readCsv(filePath) {
  const text = readText(filePath);
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false
  });

  if (parsed.errors?.length) {
    throw new Error(`CSV parse error in ${filePath}: ${parsed.errors[0].message}`);
  }
  return parsed.data;
}

export function exists(filePath) {
  return fs.existsSync(filePath);
}
