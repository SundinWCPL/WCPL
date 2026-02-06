console.log("WCPL Importer ready ✅");
import path from "path";
import minimist from "minimist";
import { readCsv, exists } from "./lib/io.js";

function die(msg) {
  console.error("ERROR:", msg);
  process.exit(1);
}

const args = minimist(process.argv.slice(2));
const seasonId = args.season || args.s;
const matchId = args.match || args.m;

if (!seasonId) die("Missing --season (example: --season S2)");
if (!matchId) die("Missing --match (example: --match 001)");

const jsonPath = path.join("ops", "incoming", seasonId, `${matchId}.json`);
const csvPath  = path.join("ops", "incoming", seasonId, `${matchId}.csv`);

console.log("WCPL Importer ✅");
console.log("Season:", seasonId);
console.log("Match:", matchId);
console.log("Expected JSON:", jsonPath);
console.log("Expected CSV :", csvPath);

if (!exists(jsonPath)) die(`JSON not found: ${jsonPath}`);
if (!exists(csvPath)) die(`CSV not found: ${csvPath}`);

const schedulePath = path.join("data", seasonId, "schedule.csv");
if (!exists(schedulePath)) die(`Season schedule not found: ${schedulePath}`);

const schedule = readCsv(schedulePath);
const row = schedule.find(r => String(r.match_id) === String(matchId));
if (!row) die(`match_id ${matchId} not found in ${schedulePath}`);

console.log("\nSchedule row:");
console.log(`  week: ${row.week}`);
console.log(`  stage: ${row.stage}`);
console.log(`  home: ${row.home_team_id}`);
console.log(`  away: ${row.away_team_id}`);
console.log(`  status: ${row.status || "(blank)"}`);
console.log(`  imported_on: ${row.imported_on || "(blank)"}`);

console.log("\n✅ Preflight passed. (No files were modified.)");
