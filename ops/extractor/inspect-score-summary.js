import fs from "fs";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node ops/extractor/inspect-score-summary.js <path-to-json>");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

const players = Array.isArray(data.players) ? data.players : [];
const goals = Array.isArray(data?.teamStats?.goals) ? data.teamStats.goals : [];

const idToName = new Map(players.map(p => [String(p.steamId), p.name]));

function nameOrBlank(steamId) {
  if (steamId == null) return "";
  const k = String(steamId);
  return idToName.get(k) || k; // fallback to steamId if name not found
}

function fmtClockFromSeconds(seconds) {
  const sec = Math.max(0, Math.floor(Number(seconds) || 0));
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

/**
 * Event string: GameTime, Team, Scorer, PrimaryAssist, SecondaryAssist
 * Stored as a single-cell string joined by ";"
 *
 * Current format proposal:
 *   P{period} {MM:SS}|{team}|{scorer}|{a1}|{a2}
 */
function eventString(g) {
  const t = `P${g.period} ${fmtClockFromSeconds(g.gameTime)}`;
  const team = g.team ?? "";
  const scorer = nameOrBlank(g.scorer);
  const a1 = nameOrBlank(g.primaryAssist);
  const a2 = nameOrBlank(g.secondaryAssist);
  return `${t}|${team}|${scorer}|${a1}|${a2}`;
}

console.log("Goals found:", goals.length);

const lines = goals.map(eventString);

console.log("\nPer-goal preview:");
lines.forEach((l, i) => console.log(`${String(i + 1).padStart(2, "0")}. ${l}`));

const scoreSummary = lines.join(";");
console.log("\nScoreSummary (single cell):");
console.log(scoreSummary);

console.log("\nDone. (No files modified.)");
