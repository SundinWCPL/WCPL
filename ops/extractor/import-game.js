import fs from "fs";
import path from "path";
import minimist from "minimist";
import { readCsv } from "./lib/io.js";
import { readCsvWithHeader, writeCsv, upsertByKey } from "./lib/csvio.js";

function die(msg) {
  console.error("ERROR:", msg);
  process.exit(1);
}

function normName(s) {
  return String(s ?? "").trim().toLowerCase();
}

function n(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

function isGoalieJson(p) {
  const pos = String(p.position ?? "").trim().toUpperCase();
  return pos === "G" || pos.startsWith("G");
}

// ---------- SP weights (LOCKED from you) ----------
function computeSPFromJson(p) {
  const sk = (
    n(p.goals) * 65 +
    n(p.assists) * 30 +
    n(p.sog) * 5 +
    n(p.passes) * 2.5 +
    n(p.takeaways) * 7.5 +
    n(p.turnovers) * -5 +
    n(p.entries) * 1 +
    n(p.exits) * 1 +
    n(p.hits) * 2.5
  );
  if (!isGoalieJson(p)) return sk;

  const saves = n(p.saves);
  const ga = n(p.goalsAllowed);
  const shutout = (ga === 0) ? 50 : 0;

  return (
    saves * 10 +
    shutout +
    n(p.passes) * 2.5 +
    n(p.goals) * 65 +
    n(p.assists) * 30
  );
}

function fmtClockFromSeconds(seconds) {
  const sec = Math.max(0, Math.floor(Number(seconds) || 0));
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function buildScoreSummary(data) {
  const jsonPlayers = Array.isArray(data.players) ? data.players : [];
  const goals = Array.isArray(data?.teamStats?.goals) ? data.teamStats.goals : [];

  const idToName = new Map(jsonPlayers.map(p => [String(p.steamId), p.name]));

  const nameOrBlank = (steamId) => {
    if (steamId == null) return "";
    const k = String(steamId);
    return idToName.get(k) || k;
  };

  const lines = goals.map(g => {
    const t = `P${g.period} ${fmtClockFromSeconds(g.gameTime)}`;
    const team = g.team ?? "";
    const scorer = nameOrBlank(g.scorer);
    const a1 = nameOrBlank(g.primaryAssist);
    const a2 = nameOrBlank(g.secondaryAssist);
    return `${t}|${team}|${scorer}|${a1}|${a2}`;
  });

  return lines.join(";");
}

function countGoalsByColor(data) {
  const goals = Array.isArray(data?.teamStats?.goals) ? data.teamStats.goals : [];
  let red = 0, blue = 0;
  for (const g of goals) {
    const t = String(g.team ?? "").toLowerCase();
    if (t === "red") red++;
    if (t === "blue") blue++;
  }
  return { red, blue };
}

function resolvePlayerKeyFromSteamId({ steamId, jsonPlayers, playersCsv }) {
  if (!steamId) return { player_key: "", matchedBy: "none" };
  const sid = String(steamId);

  // 1) direct steam_id match
  const rowSteam = playersCsv.find(r => String(r.steam_id ?? "").trim() === sid);
  if (rowSteam) return { player_key: rowSteam.player_key || "", matchedBy: "steam_id" };

  // 2) bootstrap by name (read-only for now)
  const idToName = new Map((jsonPlayers || []).map(p => [String(p.steamId), p.name]));
  const nm = idToName.get(sid);
  if (!nm) return { player_key: "", matchedBy: "unknown_steamid" };

  const rowName = playersCsv.find(r => normName(r.name) === normName(nm));
  if (!rowName) return { player_key: "", matchedBy: `no_name_match:${nm}` };

  const hasSteam = String(rowName.steam_id ?? "").trim() !== "";
  if (!hasSteam) return { player_key: rowName.player_key || "", matchedBy: `name_bootstrap:${nm}` };

  // conflict case
  if (String(rowName.steam_id).trim() !== sid) {
    return { player_key: rowName.player_key || "", matchedBy: `CONFLICT_name:${nm}` };
  }

  return { player_key: rowName.player_key || "", matchedBy: `name:${nm}` };
}

function sumTeam(jsonPlayers, teamLabel, field) {
  const t = String(teamLabel).toLowerCase();
  return jsonPlayers
    .filter(p => String(p.team ?? "").toLowerCase() === t)
    .reduce((acc, p) => acc + n(p[field]), 0);
}

// ---------- main ----------
const args = minimist(process.argv.slice(2));
const seasonId = args.season || args.s;
const matchId = args.match || args.m;
const dataRoot = args["data-root"] || args.dataroot || "data";
const apply = Boolean(args.apply);

if (!seasonId) die("Missing --season (example: --season S2)");
if (!matchId) die("Missing --match (example: --match M1-G1)");

const jsonPath = path.join("ops", "incoming", seasonId, `${matchId}.json`);
if (!fs.existsSync(jsonPath)) die(`JSON not found: ${jsonPath}`);

const schedulePath = path.join(dataRoot, seasonId, "schedule.csv");
const playersPath  = path.join(dataRoot, seasonId, "players.csv");
const gamesPath    = path.join(dataRoot, seasonId, "games.csv");

if (!fs.existsSync(schedulePath)) die(`Season schedule not found: ${schedulePath}`);
if (!fs.existsSync(playersPath)) die(`Season players not found: ${playersPath}`);
// games.csv may exist empty; if missing, that's okay—we’ll create it from header we read below.

const schedule = readCsv(schedulePath);
const playersCsv = readCsv(playersPath);
const sched = schedule.find(r => String(r.match_id) === String(matchId));
if (!sched) die(`match_id ${matchId} not found in ${schedulePath}`);

const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const teamStats = data.teamStats || {};
const jsonPlayers = Array.isArray(data.players) ? data.players : [];

const { red: homeGoals, blue: awayGoals } = countGoalsByColor(data);
const ot = (data?.teamStats?.goals || []).some(g => Number(g.period) >= 4) ? "1" : "0";

// GWG: prefer goals[].gwg === true
const gwgGoal = (data?.teamStats?.goals || []).find(g => g.gwg === true);
const gwgSteam = gwgGoal?.scorer ?? teamStats.gwg ?? null;
const gwgResolved = resolvePlayerKeyFromSteamId({ steamId: gwgSteam, jsonPlayers, playersCsv });

// Stars: computed top 3 by SP
const spRows = jsonPlayers.map(p => ({
  steamId: String(p.steamId ?? ""),
  name: String(p.name ?? ""),
  team: String(p.team ?? ""),
  position: String(p.position ?? ""),
  sp: computeSPFromJson(p)
}));
spRows.sort((a, b) => b.sp - a.sp);
const top3 = spRows.slice(0, 3);
const starResolved = top3.map(r => resolvePlayerKeyFromSteamId({ steamId: r.steamId, jsonPlayers, playersCsv }));
console.log("\nDEBUG — Star candidates from JSON:");
top3.forEach((r, i) => {
  console.log(
    `star${i+1}: name="${r.name}" steamId="${r.steamId}" team=${r.team} SP=${r.sp.toFixed(1)}`
  );
});


// Build row matching your games.csv schema
const newRow = {
  match_id: matchId,
  home_team_id: sched.home_team_id,
  away_team_id: sched.away_team_id,
  home_goals: String(homeGoals),
  away_goals: String(awayGoals),
  ot,

  away_shots: String(teamStats.blueTeamSogs ?? ""),
  home_shots: String(teamStats.redTeamSogs ?? ""),

  away_passes: String(teamStats.blueTeamPasses ?? ""),
  home_passes: String(teamStats.redTeamPasses ?? ""),

  away_fow: String(teamStats.blueFaceoffsWon ?? ""),
  home_fow: String(teamStats.redFaceoffsWon ?? ""),

  away_fol: String(teamStats.blueFaceoffsLost ?? ""),
  home_fol: String(teamStats.redFaceoffsLost ?? ""),

  // Not in teamStats; compute from players
  away_hits: String(sumTeam(jsonPlayers, "Blue", "hits")),
  home_hits: String(sumTeam(jsonPlayers, "Red", "hits")),

  away_takeaways: String(teamStats.blueTakeaways ?? ""),
  home_takeaways: String(teamStats.redTakeaways ?? ""),

  away_turnovers: String(teamStats.blueTurnovers ?? ""),
  home_turnovers: String(teamStats.redTurnovers ?? ""),

  away_exits: String(teamStats.blueDZExits ?? ""),
  home_exits: String(teamStats.redDZExits ?? ""),

  away_entries: String(teamStats.blueOZEntries ?? ""),
  home_entries: String(teamStats.redOZEntries ?? ""),

  // Not in teamStats; compute from players
  away_touches: String(sumTeam(jsonPlayers, "Blue", "puckTouches")),
  home_touches: String(sumTeam(jsonPlayers, "Red", "puckTouches")),

  away_possession_s: String(teamStats.blueTeamPossessionTime ?? ""),
  home_possession_s: String(teamStats.redTeamPossessionTime ?? ""),

  star1_key: starResolved[0]?.player_key || "",
  star2_key: starResolved[1]?.player_key || "",
  star3_key: starResolved[2]?.player_key || "",
  gwg_key: gwgResolved.player_key || "",

  score_summary: buildScoreSummary(data)
};

console.log("WCPL Importer ✅");
console.log("Mode:", apply ? "APPLY" : "DRY RUN");
console.log("Season:", seasonId);
console.log("Match:", matchId);
console.log("dataRoot:", dataRoot);
console.log("Will write:", gamesPath);

console.log("\nScore:", newRow.home_goals, "-", newRow.away_goals, "OT:", newRow.ot);

console.log("\nStars (computed by SP):");
top3.forEach((r, i) => {
  const res = starResolved[i];
  console.log(
    `  star${i + 1}: ${r.name} [${r.team}] pos=${r.position} SP=${r.sp.toFixed(1)} -> ${res.player_key} (${res.matchedBy})`
  );
});

console.log(`\nGWG: ${gwgSteam ?? ""} -> ${gwgResolved.player_key} (${gwgResolved.matchedBy})`);

console.log("\nRow object (key fields):");
console.log({
  match_id: newRow.match_id,
  home_team_id: newRow.home_team_id,
  away_team_id: newRow.away_team_id,
  home_goals: newRow.home_goals,
  away_goals: newRow.away_goals,
  ot: newRow.ot,
  star1_key: newRow.star1_key,
  star2_key: newRow.star2_key,
  star3_key: newRow.star3_key,
  gwg_key: newRow.gwg_key
});

console.log("\nscore_summary preview (first 200 chars):");
console.log(String(newRow.score_summary).slice(0, 200) + (String(newRow.score_summary).length > 200 ? "..." : ""));

const { header, rows } = readCsvWithHeader(gamesPath);

// If games.csv doesn’t exist yet, we create header from your known schema
const defaultHeader = [
  "match_id","home_team_id","away_team_id","home_goals","away_goals","ot",
  "away_shots","home_shots","away_passes","home_passes","away_fow","home_fow","away_fol","home_fol",
  "away_hits","home_hits","away_takeaways","home_takeaways","away_turnovers","home_turnovers",
  "away_exits","home_exits","away_entries","home_entries","away_touches","home_touches",
  "away_possession_s","home_possession_s",
  "star1_key","star2_key","star3_key","gwg_key","score_summary"
];

const hdr = header && header.length ? header : defaultHeader;

// Ensure row contains all columns (missing -> "")
const normalizedRow = {};
for (const c of hdr) normalizedRow[c] = (newRow[c] ?? "").toString();

const up = upsertByKey({ rows, keyField: "match_id", keyValue: matchId, newRow: normalizedRow });
console.log(`\nGames upsert action: ${up.action}`);

if (!apply) {
  console.log("✅ Dry run complete. No files modified.");
  process.exit(0);
}

// APPLY: write games.csv
writeCsv(gamesPath, hdr, up.rows);
console.log("✅ Wrote:", gamesPath);
