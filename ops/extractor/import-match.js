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

function isGoaliePosition(pos) {
  const p = String(pos ?? "").trim().toUpperCase();
  return p === "G" || p.startsWith("G");
}

function isGoalieJson(p) {
  return isGoaliePosition(p?.position);
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

// ScoreSummary: "P{period} mm:ss|Team|Scorer|A1|A2;..."
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

  // 2) bootstrap by name (read-only)
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

function resolvePlayerRowFromJsonPlayer({ jp, playersCsv }) {
  // Prefer steam_id match; fallback name match
  const sid = String(jp?.steamId ?? "").trim();
  if (sid) {
    const rSteam = playersCsv.find(r => String(r.steam_id ?? "").trim() === sid);
    if (rSteam) return rSteam;
  }
  const nm = String(jp?.name ?? "");
  return playersCsv.find(r => normName(r.name) === normName(nm)) || null;
}

function sumTeam(jsonPlayers, teamLabel, field) {
  const t = String(teamLabel).toLowerCase();
  return jsonPlayers
    .filter(p => String(p.team ?? "").toLowerCase() === t)
    .reduce((acc, p) => acc + n(p[field]), 0);
}

function todayISO() {
  // local machine time is fine here; it’s just a stamp
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
// -----------------------------
// Shot classification tunables (ported from build_master_shots.py)
// -----------------------------
const DEKE_LOOKBACK_S = 1.5;
const DEKE_MIN_DX_M = 1.0;
const DEKE_WITHIN_NET_M = 5.0;
const ONE_TIMER_WINDOW_S = 2.0;
const REBOUND_WINDOW_S = 2.5;
const REBOUND_Y_MAX_M = 5.0;

const NET_Z = 42.0; // after mirroring

function safeFloat(x) {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
}

function mirrorCoordsByTeam(xRaw, zRaw, teamRaw) {
  let x = safeFloat(xRaw);
  let z = safeFloat(zRaw);
  if (x == null || z == null) return { x: null, z: null };

  const team = String(teamRaw ?? "").trim().toLowerCase();

  // Mirror ALL blue-team shots so both teams attack the same net
  if (team === "blue") {
    x = -x;
    z = -z;
  }

  return { x, z };
}

function absTime(periodRaw, gameTimeRaw) {
  const per = safeFloat(periodRaw);
  const gt  = safeFloat(gameTimeRaw);
  if (per == null || gt == null) return null;
  return per * 10000.0 + gt;
}

function classifyShot(recentEvents, { shotT, shooterSteam, shotX, shotZ, shotOutcome }) {
  // Rebound (highest priority)
  for (let i = recentEvents.length - 1; i >= 0; i--) {
    const ev = recentEvents[i];
    if (shotT - ev.t > REBOUND_WINDOW_S) break;
    if (ev.name === "save") {
      if (shotZ != null) {
        const y = NET_Z - shotZ;
        if (y <= REBOUND_Y_MAX_M) return "rebound";
      }
      break;
    }
  }

  // Deke
  const nearNet = (shotZ != null) && ((NET_Z - shotZ) <= DEKE_WITHIN_NET_M);
  if (nearNet && shooterSteam) {
    for (let i = recentEvents.length - 1; i >= 0; i--) {
      const ev = recentEvents[i];
      if (shotT - ev.t > DEKE_LOOKBACK_S) break;
      if (ev.name === "touch" && ev.steam === shooterSteam) {
        if (ev.x != null && shotX != null && Math.abs(ev.x - shotX) >= DEKE_MIN_DX_M) {
          return "deke";
        }
        break;
      }
    }
  }

  // One-timer
  if (shooterSteam) {
    let passEv = null;

    for (let i = recentEvents.length - 1; i >= 0; i--) {
      const ev = recentEvents[i];
      if (shotT - ev.t > ONE_TIMER_WINDOW_S) break;
      if (ev.name === "pass" && ev.outcome === "successful" && ev.steam && ev.steam !== shooterSteam) {
        passEv = ev;
        break;
      }
    }

    if (passEv) {
      for (let i = recentEvents.length - 1; i >= 0; i--) {
        const ev = recentEvents[i];
        if (ev.t < passEv.t) break;
        if (ev.name === "touch" && ev.steam === shooterSteam) return "one_timer";
      }
    }
  }

  return "shot";
}

function fmtClockFromSecondsNum(seconds) {
  const sec = Math.max(0, Math.floor(Number(seconds) || 0));
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

// Reads CSV content and returns { header: string[], rows: object[] }
function parseCsvText(csvText) {
  // Handle BOM + split lines
  const lines = String(csvText ?? "").replace(/^\uFEFF/, "").split(/\r?\n/);

  // skip leading sep=, line
  let i = 0;
  if ((lines[0] || "").toLowerCase().startsWith("sep=")) i++;

  // find first non-empty line as header
  while (i < lines.length && (lines[i] || "").trim() === "") i++;
  if (i >= lines.length) return { header: [], rows: [] };

  const header = splitCsvLine(lines[i]).map(h => h.trim());
  i++;

  const rows = [];
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;
    const cells = splitCsvLine(line);
    if (cells.length === 0) continue;
    const r = {};
    for (let c = 0; c < header.length; c++) r[header[c]] = (cells[c] ?? "");
    rows.push(r);
  }

  return { header, rows };
}

// Minimal CSV splitter handling quotes
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQ = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // escaped quote
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function buildShotSummaryFromCsv({ csvPath }) {
  if (!fs.existsSync(csvPath)) return "";

  let text = "";
  try {
    text = fs.readFileSync(csvPath, "utf8");
  } catch {
    return "";
  }

  const { rows } = parseCsvText(text);
  if (!rows.length) return "";

  // Required columns (same set your python expects)
  const required = [
    "name","outcome","xCoord","zCoord","forcemagnitude",
    "period","gameTime","team","playerReferenceSteamID"
  ];
  const missingAny = required.some(c => !(c in rows[0]));
  if (missingAny) return ""; // silently ignore non-gamelog CSV

  const maxWindow = Math.max(DEKE_LOOKBACK_S, ONE_TIMER_WINDOW_S, REBOUND_WINDOW_S) + 1.0;
  const recent = []; // rolling window of events
  const shotEvents = [];

  for (const row of rows) {
    const name = String(row.name ?? "").trim().toLowerCase();
    const outcome = String(row.outcome ?? "").trim().toLowerCase();

    const t = absTime(row.period, row.gameTime);
    if (t == null) continue;

    const steam = String(row.playerReferenceSteamID ?? "").trim();
    const { x, z } = mirrorCoordsByTeam(
  row.xCoord,
  row.zCoord,
  row.team
);

    // prune old window
    while (recent.length && (t - recent[0].t) > maxWindow) recent.shift();

    // capture shots (on net / goal only)
    if (name === "shot" && (outcome === "on net" || outcome === "goal")) {
      const shotType = classifyShot(recent, {
        shotT: t,
        shooterSteam: steam,
        shotX: x,
        shotZ: z,
        shotOutcome: outcome
      });

      const periodNum = String(row.period ?? "").trim();
      const clock = fmtClockFromSecondsNum(row.gameTime);

      // Keep team as raw "Red"/"Blue" like your score_summary does (your csv uses row.team)
      const team = String(row.team ?? "").trim();

      const speed = safeFloat(row.forcemagnitude);
      const res = (outcome === "goal") ? "G" : "S";

      // record fields: P{period} mm:ss|Team|SteamID|shotType|speed|x|z|result
      shotEvents.push([
        `P${periodNum} ${clock}`,
        team,
        steam,
        shotType,
        speed == null ? "" : String(speed),
        x == null ? "" : String(x),
        z == null ? "" : String(z),
        res
      ].join("|"));
    }

    // add to rolling window after processing
    if (name === "touch" || name === "pass" || name === "shot" || name === "save") {
      recent.push({ t, name, steam, x, z, outcome });
    }
  }

  return shotEvents.join(";");
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
const boxscoresPath= path.join(dataRoot, seasonId, "boxscores.csv");

if (!fs.existsSync(schedulePath)) die(`Season schedule not found: ${schedulePath}`);
if (!fs.existsSync(playersPath)) die(`Season players not found: ${playersPath}`);
// games.csv / boxscores.csv can be missing; we will create with default headers.

const schedule = readCsv(schedulePath);
const playersCsv = readCsv(playersPath);

const sched = schedule.find(r => String(r.match_id) === String(matchId));
if (!sched) die(`match_id ${matchId} not found in ${schedulePath}`);

const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const teamStats = data.teamStats || {};
const jsonPlayers = Array.isArray(data.players) ? data.players : [];

const { red: homeGoals, blue: awayGoals } = countGoalsByColor(data);
const ot = (data?.teamStats?.goals || []).some(g => Number(g.period) >= 4) ? "1" : "0";

// winner/loser for goalie W
const homeWin = homeGoals > awayGoals;
const awayWin = awayGoals > homeGoals;

// GWG
const gwgGoal = (data?.teamStats?.goals || []).find(g => g.gwg === true);
const gwgSteam = gwgGoal?.scorer ?? teamStats.gwg ?? null;
const gwgSteamId = gwgSteam ? String(gwgSteam) : "";

const gamelogCsvPath = path.join("ops", "incoming", seasonId, `${matchId}.csv`);
const shotSummary = buildShotSummaryFromCsv({ csvPath: gamelogCsvPath });

// =============== 1) games.csv upsert (your schema) ===============
const newGameRow = {
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

  away_touches: String(sumTeam(jsonPlayers, "Blue", "puckTouches")),
  home_touches: String(sumTeam(jsonPlayers, "Red", "puckTouches")),

  away_possession_s: String(teamStats.blueTeamPossessionTime ?? ""),
  home_possession_s: String(teamStats.redTeamPossessionTime ?? ""),

  gwg_steam_id: gwgSteamId,
  score_summary: buildScoreSummary(data),
  shot_summary: shotSummary
};

const defaultGamesHeader = [
  "match_id","home_team_id","away_team_id","home_goals","away_goals","ot",
  "away_shots","home_shots","away_passes","home_passes","away_fow","home_fow","away_fol","home_fol",
  "away_hits","home_hits","away_takeaways","home_takeaways","away_turnovers","home_turnovers",
  "away_exits","home_exits","away_entries","home_entries","away_touches","home_touches",
  "away_possession_s","home_possession_s",
  "gwg_steam_id","score_summary","shot_summary"
];

const g = readCsvWithHeader(gamesPath);
const gamesHeader = (g.header && g.header.length) ? g.header : defaultGamesHeader;
const gameNormalized = {};
for (const c of gamesHeader) gameNormalized[c] = (newGameRow[c] ?? "").toString();
const gamesUp = upsertByKey({ rows: g.rows, keyField: "match_id", keyValue: matchId, newRow: gameNormalized });

// =============== 2) boxscores.csv replace rows for this match ===============
const defaultBoxHeader = [
  "match_id","team_id","player_name","steam_id","position",
  "g","a","shots","passes","exits","entries","hits","turnovers","takeaways","touches",
  "poss_s","fow","fol",
  "sa","ga","body_sv","stick_sv","w","so",
  "toi_s","sp"
];

const b = readCsvWithHeader(boxscoresPath);
const boxHeader = (b.header && b.header.length) ? b.header : defaultBoxHeader;

// remove any existing rows for this match_id (safe re-import)
const kept = b.rows.filter(r => String(r.match_id) !== String(matchId));

// build fresh rows from JSON
const boxRowsNew = [];
for (const jp of jsonPlayers) {
  const teamColor = String(jp.team ?? "").toLowerCase(); // "red"/"blue"
  const team_id = (teamColor === "red") ? sched.home_team_id : (teamColor === "blue" ? sched.away_team_id : "");

  const pos = String(jp.position ?? "");
  const goalie = isGoalieJson(jp);

  // goalie W/SO only for goalie appearances
  const w = goalie ? ((teamColor === "red" && homeWin) || (teamColor === "blue" && awayWin) ? "1" : "0") : "";
  const so = goalie ? (n(jp.goalsAllowed) === 0 ? "1" : "0") : "";

  const row = {
    match_id: matchId,
    team_id,
    player_name: String(jp.name ?? ""),
    steam_id: String(jp.steamId ?? ""),
    position: pos,

    g: String(n(jp.goals)),
    a: String(n(jp.assists)),
    shots: String(n(jp.sog)),
    passes: String(n(jp.passes)),
    exits: String(n(jp.exits)),
    entries: String(n(jp.entries)),
    hits: String(n(jp.hits)),
    turnovers: String(n(jp.turnovers)),
    takeaways: String(n(jp.takeaways)),
    touches: String(n(jp.puckTouches)),
    poss_s: String(n(jp.possessionTimeSeconds)),
    fow: String(n(jp.faceoffWins)),
    fol: String(n(jp.faceoffLosses)),

    sa: goalie ? String(n(jp.shotsFaced)) : "",
    ga: goalie ? String(n(jp.goalsAllowed)) : "",
    body_sv: goalie ? String(n(jp.bodySaves)) : "",
    stick_sv: goalie ? String(n(jp.stickSaves)) : "",
    w,
    so,

    toi_s: String(n(jp.timeOnIce)),
    sp: String(computeSPFromJson(jp))
  };

  // normalize columns
  const out = {};
  for (const c of boxHeader) out[c] = (row[c] ?? "").toString();
  boxRowsNew.push(out);
}

const boxAll = [...kept, ...boxRowsNew];

// =============== 3) schedule.csv mark imported/final ===============
const schedHeader = readCsvWithHeader(schedulePath).header || ["match_id","week","home_team_id","away_team_id","stage","status","imported_on"];
const schedRows = readCsvWithHeader(schedulePath).rows;

const stamp = todayISO();
// Your schedule currently uses "scheduled". We’ll flip to "final".
const scheduleUp = upsertByKey({
  rows: schedRows,
  keyField: "match_id",
  keyValue: matchId,
  newRow: {
    match_id: matchId,
    status: "final",
    imported_on: stamp
  }
});

// =============== 4) players.csv recompute totals from boxscores ===============
function safeDiv(a, b) {
  const aa = n(a), bb = n(b);
  if (bb <= 0) return 0;
  return aa / bb;
}

function aggregatePlayersFromBoxscores({ playersCsvRows, boxRows }) {
  // --- Build authoritative buckets by SteamID ---
  const bucketsBySteam = new Map(); // steam_id -> [box rows]
  const steamToNames = new Map();   // steam_id -> Set(normalized names seen)
  const nameToSteams = new Map();   // normalized name -> Set(steam_ids seen)
  
  const unmatchedBoxscorePlayers = new Map(); // steam_id -> name

for (const r of boxRows) {
  const sid = String(r.steam_id ?? "").trim();
  const nm  = String(r.player_name ?? "").trim();
  const nn  = normName(nm);

  // Track boxscore players not in roster (by steam_id)
  if (sid && !playersCsvRows.some(p => String(p.steam_id ?? "").trim() === sid)) {
    if (!unmatchedBoxscorePlayers.has(sid)) {
      unmatchedBoxscorePlayers.set(sid, nm);
    }
  }

  if (!sid) continue;

  if (!bucketsBySteam.has(sid)) bucketsBySteam.set(sid, []);
  bucketsBySteam.get(sid).push(r);

  if (!steamToNames.has(sid)) steamToNames.set(sid, new Set());
  if (nn) steamToNames.get(sid).add(nn);

  if (nn) {
    if (!nameToSteams.has(nn)) nameToSteams.set(nn, new Set());
    nameToSteams.get(nn).add(sid);
  }
}

  // --- Build roster lookup safety nets ---
  const rosterNameToRows = new Map(); // normalized name -> [player rows]
  const rosterSteamToRow = new Map(); // steam_id -> player row (if already assigned)

  for (const pr of playersCsvRows) {
    const sid = String(pr.steam_id ?? "").trim();
    const nn = normName(pr.name ?? "");

    if (nn) {
      if (!rosterNameToRows.has(nn)) rosterNameToRows.set(nn, []);
      rosterNameToRows.get(nn).push(pr);
    }
    if (sid) {
      // If duplicates exist in roster, keep the first; we’ll warn later if needed
      if (!rosterSteamToRow.has(sid)) rosterSteamToRow.set(sid, pr);
    }
  }

  // clone so we keep roster rows even if no games
  const out = playersCsvRows.map(r => ({ ...r }));

  // helper: safe bootstrap
  function tryBootstrapSteamId(pr) {
    const sid0 = String(pr.steam_id ?? "").trim();
    if (sid0) return sid0;

    const nn = normName(pr.name ?? "");
    if (!nn) return "";

    // 1) Name must map to exactly one SteamID in the boxscores
    const sids = nameToSteams.get(nn);
    if (!sids || sids.size !== 1) {
      if (sids && sids.size > 1) {
        console.warn(`[WARN] Ambiguous name->steam mapping for "${pr.name}": ${Array.from(sids).join(", ")}. Skipping bootstrap.`);
      }
      return "";
    }
    const sid = Array.from(sids)[0];

    // 2) Roster name must be unique (avoid two roster entries with same name)
    const rosterRows = rosterNameToRows.get(nn) || [];
    if (rosterRows.length !== 1) {
      console.warn(`[WARN] Roster has ${rosterRows.length} rows named "${pr.name}". Skipping bootstrap for safety.`);
      return "";
    }

    // 3) SteamID must not already belong to a DIFFERENT roster player
    const existing = rosterSteamToRow.get(sid);
    if (existing && normName(existing.name) !== nn) {
      console.warn(
        `[WARN] SteamID ${sid} already assigned to roster name "${existing.name}", ` +
        `but boxscores name is "${pr.name}". Skipping bootstrap.`
      );
      return "";
    }

    // 4) Optional extra paranoia: if this SteamID was seen with multiple names in the same import, flag it
    const namesSeen = steamToNames.get(sid);
    if (namesSeen && namesSeen.size > 1) {
      console.warn(
        `[WARN] SteamID ${sid} appears with multiple names in boxscores: ${Array.from(namesSeen).join(", ")}. ` +
        `Skipping bootstrap for "${pr.name}".`
      );
      return "";
    }

    // Safe: assign & persist
    pr.steam_id = sid;
    rosterSteamToRow.set(sid, pr);
    return sid;
  }

  for (const pr of out) {
    // establish steam id (existing or safely bootstrapped)
    const sid = tryBootstrapSteamId(pr);

    // aggregate ONLY using steam buckets
    const rows = sid ? (bucketsBySteam.get(sid) || []) : [];

    // reset accumulators
    let gp_s = 0, gp_g = 0;

    let g = 0, a = 0, shots = 0, passes = 0, exits = 0, entries = 0, hits = 0, turnovers = 0, takeaways = 0, touches = 0, possession_s = 0;
    let fow = 0, fol = 0;

    let sa = 0, ga = 0, body_sv = 0, stick_sv = 0, wins = 0, so = 0;
    let toi_s = 0, toi_g = 0;
    let sp = 0;

    for (const r of rows) {
      const pos = String(r.position ?? "");
      const goalie = isGoaliePosition(pos);

      const toi = n(r.toi_s);
      sp += n(r.sp);

      if (goalie) {
        gp_g += 1;
        toi_g += toi;

        sa += n(r.sa);
        ga += n(r.ga);
        body_sv += n(r.body_sv);
        stick_sv += n(r.stick_sv);
        wins += n(r.w);
        so += n(r.so);

        // goalies can still have skater fields in your JSON
        g += n(r.g);
        a += n(r.a);
        passes += n(r.passes);
        shots += n(r.shots);
        exits += n(r.exits);
        entries += n(r.entries);
        hits += n(r.hits);
        turnovers += n(r.turnovers);
        takeaways += n(r.takeaways);
        touches += n(r.touches);
        possession_s += n(r.poss_s);
      } else {
        gp_s += 1;
        toi_s += toi;

        g += n(r.g);
        a += n(r.a);
        shots += n(r.shots);
        passes += n(r.passes);
        exits += n(r.exits);
        entries += n(r.entries);
        hits += n(r.hits);
        turnovers += n(r.turnovers);
        takeaways += n(r.takeaways);
        touches += n(r.touches);
        possession_s += n(r.poss_s);
        fow += n(r.fow);
        fol += n(r.fol);
      }
    }

    const pts = g + a;
    const gp_total = gp_s + gp_g;
    const toi_total = toi_s + toi_g;

    // write back into your players.csv schema fields (as strings)
    pr.gp_s = String(gp_s);
    pr.gp_g = String(gp_g);

    pr.g = String(g);
    pr.a = String(a);
    pr.pts = String(pts);

    // Per-15-minute normalization (WCPL standard)
pr.p_per_gp = String(
  toi_s > 0 ? safeDiv(pts * 900, toi_s) : safeDiv(pts, gp_s)
);

pr.sp_per_gp = String(
  toi_total > 0 ? safeDiv(sp * 900, toi_total) : safeDiv(sp, gp_total)
);


    pr.shots = String(shots);
    pr.passes = String(passes);
    pr.exits = String(exits);
    pr.entries = String(entries);
    pr.hits = String(hits);
    pr.turnovers = String(turnovers);
    pr.takeaways = String(takeaways);
    pr.touches = String(touches);
    pr.possession_s = String(possession_s);
    pr.fow = String(fow);
    pr.fol = String(fol);

    pr.sa = String(sa);
    pr.ga = String(ga);
    pr.body_sv = String(body_sv);
    pr.stick_sv = String(stick_sv);

    pr.wins = String(wins);
    pr.so = String(so);

    pr.toi_s = String(toi_s);
    pr.toi_g = String(toi_g);
    pr.toi_total = String(toi_total);

    pr.toi_gp_s = String(safeDiv(toi_s, gp_s));
    pr.toi_gp_g = String(safeDiv(toi_g, gp_g));
    pr.toi_gp = String(safeDiv(toi_total, gp_total));

    pr.gaa = String(toi_g > 0 ? safeDiv(ga * 900, toi_g) : 0);
    pr.sv_pct = String(sa > 0 ? (1 - (ga / sa)) : 0);

    pr.sp = String(sp);
  }
if (unmatchedBoxscorePlayers.size > 0) {
  console.warn("\n[WARN] Boxscore players not found in players.csv (excluded from season totals):");
  for (const [sid, name] of unmatchedBoxscorePlayers.entries()) {
    console.warn(`  - ${name} (steam_id=${sid})`);
  }
}
  return out;
}

const playersRead = readCsvWithHeader(playersPath);
const playersHeader = playersRead.header; // keep exact header order
if (!playersHeader || !playersHeader.length) die(`players.csv header missing: ${playersPath}`);

const playersRebuilt = aggregatePlayersFromBoxscores({
  playersCsvRows: playersRead.rows,
  boxRows: boxAll
});

// =============== OUTPUT / APPLY ===============
console.log("WCPL Import Match ✅");
console.log("Mode:", apply ? "APPLY" : "DRY RUN");
console.log("Season:", seasonId);
console.log("Match:", matchId);
console.log("Will write:");
console.log(" -", gamesPath);
console.log(" -", boxscoresPath);
console.log(" -", schedulePath);
console.log(" -", playersPath);

console.log("\nScore:", newGameRow.home_goals, "-", newGameRow.away_goals, "OT:", newGameRow.ot);
console.log("Schedule -> status=final, imported_on=", stamp);
console.log("Boxscore rows:", boxRowsNew.length);

if (!apply) {
  console.log("\n✅ Dry run complete. No files modified.");
  process.exit(0);
}
function sanitizeRowCells(rows, header) {
  for (const r of rows) {
    for (const c of header) {
      const v = r[c];
      if (v == null) continue;
      // Remove embedded newlines that break CSV row structure
      r[c] = String(v).replace(/\r?\n/g, "").trim();
    }
  }
}
sanitizeRowCells(gamesUp.rows, gamesHeader);
sanitizeRowCells(boxAll, boxHeader);
sanitizeRowCells(scheduleUp.rows, schedHeader);
sanitizeRowCells(playersRebuilt, playersHeader);

// APPLY writes
writeCsv(gamesPath, gamesHeader, gamesUp.rows);
writeCsv(boxscoresPath, boxHeader, boxAll);
writeCsv(schedulePath, schedHeader, scheduleUp.rows);
writeCsv(playersPath, playersHeader, playersRebuilt);

console.log("\n✅ Done.");
