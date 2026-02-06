import fs from "fs";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node ops/extractor/inspect-json.js <path-to-json>");
  process.exit(1);
}

const raw = fs.readFileSync(filePath, "utf8");
const data = JSON.parse(raw);

function typeOf(v) {
  if (Array.isArray(v)) return `array(${v.length})`;
  if (v === null) return "null";
  return typeof v;
}

console.log("JSON file:", filePath);
console.log("\nTop-level keys:");
for (const k of Object.keys(data)) {
  console.log(`  - ${k}: ${typeOf(data[k])}`);
}

// Show any big arrays (likely events)
const arrays = Object.entries(data)
  .filter(([_, v]) => Array.isArray(v))
  .map(([k, v]) => ({ key: k, len: v.length }))
  .sort((a, b) => b.len - a.len);

if (arrays.length) {
  console.log("\nTop-level arrays:");
  for (const a of arrays.slice(0, 10)) {
    console.log(`  - ${a.key}: ${a.len} items`);
  }
}

function sample(label, arr) {
  if (!Array.isArray(arr) || arr.length === 0) return;
  const s = arr[0];
  console.log(`\nSample item from ${label}:`);
  if (typeof s === "object" && s !== null) {
    console.log("  keys:", Object.keys(s).join(", "));
  } else {
    console.log("  value:", s);
  }
}

// Try common guesses (harmless if missing)
sample("events", data.events);
sample("gameEvents", data.gameEvents);
sample("plays", data.plays);
sample("goals", data.goals);
sample("players", data.players);

console.log("\nDone. (No files modified.)");
