import fs from "fs";
import path from "path";
import Papa from "papaparse";

function die(msg) {
  console.error("ERROR:", msg);
  process.exit(1);
}

function readCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  if (parsed.errors?.length) throw new Error(parsed.errors[0].message);
  return parsed.data;
}

function isGoalieJson(p) {
  const pos = String(p.position ?? "").trim().toUpperCase();
  return pos === "G" || pos.startsWith("G");
}

function n(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

function computeSPFromJson(p) {
  // Weights (locked)
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

  const gk = (
    saves * 10 +
    shutout +
    n(p.passes) * 2.5 +
    n(p.goals) * 65 +
    n(p.assists) * 30
  );

  return gk;
}

function normName(s) {
  return String(s ?? "").trim().toLowerCase();
}

function fmtClockFromSeconds(seconds) {
  const sec = Math.max(0, Math.floor(Number(seconds) || 0));
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function buildScoreSummary(data) {
  const players = Array.isArray(data.players) ? data.players : [];
  const goals = Array.isArray(data?.teamStats?.goals) ? data.teamStats.goals : [];

  const idToName = new Map(players.map(p => [String(p.steamId), p.name]));

  function nameOrBlank(steamId) {
    if (steamId == null) return "";
    const k = String(steamId);
    return idToName.get(k) || k;
  }

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
    if ((g.team ?? "").toLowerCase() === "red") red++;
    if ((g.team ?? "").toLowerCase() === "blue") blue++;
  }
  return { red, blue, total: goals.length };
}

function resolvePlayerKeyFromSteamId({ steamId, jsonPlayers, playersCsv }) {
  if (!steamId) return { player_key: "", matchedBy: "none", updatedSteam: false };

  const sid = String(steamId);

  // 1) direct steam_id match
  let row = playersCsv.find(r => String(r.steam_id ?? "").trim() === sid);
  if (row) return { player_key: row.player_key || "", matchedBy: "steam_id", updatedSteam: false };

  // 2) bootstrap by name from JSON players[]
  const idToName = new Map((jsonPlayers || []).map(p => [String(p.steamId), p.name]));
  const nm = idToName.get(sid);
  if (!nm) return { player_key: "", matchedBy: "unknown_steamid", updatedSteam: false };

  const rowByName = playersCsv.find(r => normName(r.name) === normName(nm));
  if (!rowByName) return { player_key: "", matchedBy: `no_name_match:${nm}`, updatedSteam: false };

  const hadSteam = String(rowByName.steam_id ?? "").trim() !== "";
  if (!hadSteam) {
    // DRY-RUN: we will report that we'd set it; later the real importer will write it.
    return { player_key: rowByName.player_key || "", matchedBy: `name_bootstrap:${nm}`, updatedSteam: true };
  }

  // Name matched but already has a different steam_id filled -> report conflict
  if (String(rowByName.steam_id).trim() !== sid) {
    return { player_key: rowByName.player_key || "", matchedBy: `CONFLICT_name:${nm}`, updatedSteam: false };
  }

  return { player_key: rowByName.player_key || "", matchedBy: `name:${nm}`, updatedSteam: false };
}

// ---------- main ----------
const matchId = process.argv[2];
if (!matchId) {
  console.error("Usage: node ops/extractor/inspect-games-row.js <match_id> [seasonId] [dataRoot]");
  console.error("Example: node ops/extractor/inspect-games-row.js M1-G1 S2 data");
  process.exit(1);
}

const seasonId = process.argv[3] || "S2";
const dataRoot = process.argv[4] || "data";

const jsonPath = path.join("ops", "incoming", seasonId, `${matchId}.json`);
if (!fs.existsSync(jsonPath)) die(`Missing JSON: ${jsonPath}`);

const schedulePath = path.join(dataRoot, seasonId, "schedule.csv");
const playersPath  = path.join(dataRoot, seasonId, "players.csv");

if (!fs.existsSync(schedulePath)) die(`Missing schedule: ${schedulePath}`);
if (!fs.existsSync(playersPath)) die(`Missing players: ${playersPath}`);

const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const schedule = readCsv(schedulePath);
const playersCsv = readCsv(playersPath);

const sched = schedule.find(r => String(r.match_id) === String(matchId));
if (!sched) die(`match_id ${matchId} not found in ${schedulePath}`);

const teamStats = data.teamStats || {};
const jsonPlayers = Array.isArray(data.players) ? data.players : [];

const { red: homeGoals, blue: awayGoals } = countGoalsByColor(data);
const ot = (data?.teamStats?.goals || []).some(g => Number(g.period) >= 4) ? "1" : "0";

// aggregates: remember your schema is away_* then home_* in many places
const row = {
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

  // hits may not be in teamStats (you have per-player hits)
  away_hits: "",
  home_hits: "",

  away_takeaways: String(teamStats.blueTakeaways ?? ""),
  home_takeaways: String(teamStats.redTakeaways ?? ""),

  away_turnovers: String(teamStats.blueTurnovers ?? ""),
  home_turnovers: String(teamStats.redTurnovers ?? ""),

  away_exits: String(teamStats.blueDZExits ?? ""),
  home_exits: String(teamStats.redDZExits ?? ""),

  away_entries: String(teamStats.blueOZEntries ?? ""),
  home_entries: String(teamStats.redOZEntries ?? ""),

  // touches & possession may not exist at team level; we can compute later if needed
  away_touches: "",
  home_touches: "",

  away_possession_s: String(teamStats.blueTeamPossessionTime ?? ""),
  home_possession_s: String(teamStats.redTeamPossessionTime ?? ""),

  star1_key: "",
  star2_key: "",
  star3_key: "",
  gwg_key: "",
  score_summary: buildScoreSummary(data)
};

// Stars / GWG (steamId -> player_key)
// ---------- computed stars (ignore exporter stars) ----------
const gwgGoal = (data?.teamStats?.goals || []).find(g => g.gwg === true);
const gwgSteam = gwgGoal?.scorer ?? teamStats.gwg ?? null;
const spRows = jsonPlayers.map(p => ({
  steamId: String(p.steamId ?? ""),
  name: String(p.name ?? ""),
  team: String(p.team ?? ""),
  position: String(p.position ?? ""),
  sp: computeSPFromJson(p)
}));

spRows.sort((a, b) => b.sp - a.sp);
const top3 = spRows.slice(0, 3);

// resolve to player_key using your matching rules
const starResolved = top3.map(r =>
  resolvePlayerKeyFromSteamId({ steamId: r.steamId, jsonPlayers, playersCsv })
);

row.star1_key = starResolved[0]?.player_key || "";
row.star2_key = starResolved[1]?.player_key || "";
row.star3_key = starResolved[2]?.player_key || "";


const gwgResolved = resolvePlayerKeyFromSteamId({ steamId: gwgSteam, jsonPlayers, playersCsv });
row.gwg_key = gwgResolved.player_key || "";

// ---------- output ----------
console.log("DRY RUN — games.csv row preview");
console.log("match_id:", matchId);
console.log("home (Red):", sched.home_team_id, "away (Blue):", sched.away_team_id);
console.log("score:", row.home_goals, "-", row.away_goals, "OT:", row.ot);

console.log("\nStars (computed by SP):");
top3.forEach((r, i) => {
  const res = starResolved[i];
  console.log(
    `  star${i+1}: ${r.name} [${r.team}] pos=${r.position} SP=${r.sp.toFixed(1)} -> ${res.player_key} (${res.matchedBy}${res.updatedSteam ? ", would set steam_id" : ""})`
  );
});
console.log(`  gwg: ${gwgSteam ?? ""} -> ${gwgResolved.player_key} (${gwgResolved.matchedBy}${gwgResolved.updatedSteam ? ", would set steam_id" : ""})`);

console.log("\nRow object (key fields):");
console.log({
  match_id: row.match_id,
  home_team_id: row.home_team_id,
  away_team_id: row.away_team_id,
  home_goals: row.home_goals,
  away_goals: row.away_goals,
  ot: row.ot,
  star1_key: row.star1_key,
  star2_key: row.star2_key,
  star3_key: row.star3_key,
  gwg_key: row.gwg_key
});

console.log("\nscore_summary preview (first 200 chars):");
console.log(String(row.score_summary).slice(0, 200) + (String(row.score_summary).length > 200 ? "..." : ""));

console.log("\nDone. (No files modified.)");
