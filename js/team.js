// js/team.js
import { loadCSV, toIntMaybe, toNumMaybe } from "./data.js";
import { initSeasonPicker, getSeasonId, onSeasonChange, saveStage, playoffsHaveBegun, applyDefaultStage } from "./season.js";

const elSeason = document.getElementById("seasonSelect");
const elStatus = document.getElementById("status");
const elStage = document.getElementById("stageSelect");

const elRateMode = document.getElementById("rateMode");

let lastRoster = [];
let lastAdvOn = false;

const elHero = document.getElementById("teamHero");
const elLogo = document.getElementById("teamLogo");
const elName = document.getElementById("teamName");
const elMeta = document.getElementById("teamMeta");
const elViewScheduleBtn = document.getElementById("viewScheduleBtn");

const skatersBody = document.querySelector("#skatersTable tbody");
const goaliesBody = document.querySelector("#goaliesTable tbody");

const elTeamEmpty = document.getElementById("teamEmpty");
const elTeamBody = document.getElementById("teamBody");

const elTeamAnalyticsStatus = document.getElementById("teamAnalyticsStatus");
const elTeamAnalytics = document.getElementById("teamAnalytics");

boot();

// -------------------- Roster sorting --------------------
let skSortKey = "pts";
let skSortDir = "desc";
let gSortKey  = "svp";
let gSortDir  = "desc";
let rosterSortWired = false;

function cmp(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "string" || typeof b === "string") return String(a).localeCompare(String(b));
  return Number(a) - Number(b);
}

function sortRows(rows, key, dir) {
  const mul = (dir === "asc") ? 1 : -1;
  return rows.slice().sort((A, B) => {
    const primary = cmp(A[key], B[key]) * mul;
    if (primary !== 0) return primary;

    // stable-ish tie breaks (keeps list feeling consistent)
    const pts = cmp(A.pts, B.pts) * -1;
    if (pts !== 0) return pts;
    const g = cmp(A.g, B.g) * -1;
    if (g !== 0) return g;
    return String(A.name ?? "").localeCompare(String(B.name ?? ""));
  });
}

function wireSortHeaders(tableSel, onSortClick) {
  const ths = document.querySelectorAll(`${tableSel} thead th[data-key]`);
  for (const th of ths) {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => onSortClick(th.dataset.key));
  }
}

function setSortClasses(tableSel, key, dir) {
  const ths = document.querySelectorAll(`${tableSel} thead th[data-key]`);
  for (const th of ths) th.classList.remove("sort-asc", "sort-desc");

  const th = document.querySelector(`${tableSel} thead th[data-key="${CSS.escape(key)}"]`);
  if (!th) return;

  th.classList.add(dir === "asc" ? "sort-asc" : "sort-desc");
}

function setSortIndicator(tableSel, key, dir) {
  clearSortIndicators(tableSel);

  const th = document.querySelector(`${tableSel} thead th[data-key="${CSS.escape(key)}"]`);
  if (!th) return;

  th.classList.add("sorted", dir === "asc" ? "sorted-asc" : "sorted-desc");

  const span = document.createElement("span");
  span.className = "sort-arrow";
  span.textContent = (dir === "asc") ? " ▲" : " ▼";
  th.appendChild(span);
}

async function boot() {
  await initSeasonPicker(elSeason);
  onSeasonChange(() => refresh());
elStage.addEventListener("change", () => {
  saveStage(elStage.value, getSeasonId());
  refresh();
});
elRateMode?.addEventListener("change", () => {
  renderRoster(lastRoster, lastAdvOn);
});
  await refresh();
}

async function urlExists(url) {
  try {
    const r = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (r.ok) return true;
    return false;
  } catch {
    try {
      const r = await fetch(url, { method: "GET", cache: "no-store" });
      return r.ok;
    } catch {
      return false;
    }
  }
}

function setPlayoffsOptionEnabled(enabled) {
  const opt = [...elStage.options].find(o => o.value === "PO");
  if (opt) opt.disabled = !enabled;
  if (!enabled && elStage.value === "PO") elStage.value = "REG";
}

async function refresh() {
  const seasonId = getSeasonId();
  const teamId = getUrlParam("team_id");

  if (!teamId) {
    setStatus("Missing team_id in URL. Example: team.html?season=S1&team_id=BOS");
    elHero.hidden = true;
	elTeamBody.hidden = true;
    return;
  }

  setStatus(`Loading ${seasonId} / ${teamId}…`);

  try {
    const teamsPath = `../data/${seasonId}/teams.csv`;
    const regularPlayersPath = `../data/${seasonId}/players.csv`;
	const playoffPlayersPath = `../data/${seasonId}/players_playoffs.csv`;

	// Detect if playoffs file exists for this season; disable option if not.
	const hasPlayoffs = await urlExists(playoffPlayersPath);
	setPlayoffsOptionEnabled(hasPlayoffs);
	
	const seasonsPath = `../data/seasons.csv`;
const gamesPath   = `../data/${seasonId}/games.csv`;
const schedPath   = `../data/${seasonId}/schedule.csv`;
const boxPath = `../data/${seasonId}/boxscores.csv`;

	// Load core first (need schedule+games to auto-default stage)
const [seasons, teams, games, schedule, boxscores] = await Promise.all([
  loadCSV(seasonsPath),
  loadCSV(teamsPath),
  loadCSV(gamesPath),
  loadCSV(schedPath),
  loadCSV(boxPath).catch(() => []),
]);

const playoffsBegun = playoffsHaveBegun(schedule, games);
applyDefaultStage(elStage, seasonId, {
  playoffsEnabled: hasPlayoffs,
  playoffsBegun
});

// Now decide which players file to load
const stage = elStage.value;
const playersPath = (stage === "PO" && hasPlayoffs)
  ? playoffPlayersPath
  : regularPlayersPath;

// Load players AFTER stage is finalized
const players = await loadCSV(playersPath);

const seasonRow = seasons.find(s => String(s.season_id).trim() === seasonId);
const advOn = (toIntMaybe(seasonRow?.adv_stats) ?? 0) === 1;

// toggle CSS class to hide/show advanced columns
document.body.classList.toggle("hide-adv", !advOn);

	const team = teams.find(t => String(t.team_id).trim() === teamId);
	if (!team) {
	// Team doesn't exist in this season (common when seasons introduce new teams)
	renderTeamMissingInSeason(seasonId, teamId, seasons);
	elTeamBody.hidden = true;
	elHero.hidden = false;
	clearStatus();
	return;
	}


    // Build match_id → schedule row lookup (for stage, week, imported_on)
    const schedByMatch = new Map();
    for (const s of schedule) {
      if (!s.match_id) continue;
      schedByMatch.set(String(s.match_id).trim(), s);
    }


const teamGames = games
  .map(g => ({ g, s: schedByMatch.get(String(g.match_id ?? "").trim()) }))
  .filter(({ g }) => {
    if (!g.home_team_id || !g.away_team_id) return false;
    const home = String(g.home_team_id).trim();
    const away = String(g.away_team_id).trim();
    return home === teamId || away === teamId;
  });

const stageMode = (elStage?.value === "PO") ? "PO" : "REG";

const teamGamesForRecord = teamGames
  .filter(({ s }) => {
    const st = String(s?.stage ?? "").trim().toLowerCase();
    if (stageMode === "PO") return isPlayoffStage(st);
    return st === "reg";
  })
  .map(x => x.g);

// Compute record + header line
const rec = computeRecord(teamId, teamGamesForRecord);

// stageMode already computed above — don't redeclare it
const poLabel = (stageMode === "PO")
  ? computePlayoffResultLabel(teamId, teamGames)
  : "";

renderHero(seasonId, team, rec, stageMode, poLabel);

    // Render roster tables
    const roster = players.filter(p => String(p.team_id ?? "").trim() === teamId);
	lastRoster = roster;
	lastAdvOn = advOn;

	renderRoster(roster, advOn);
	renderTeamAnalyticsRadar(teamId, games, schedule, boxscores, stageMode);

	elTeamBody.hidden = false;
    elHero.hidden = false;
    clearStatus();
	} catch (err) {
	console.error(err);
	const seasonId = getSeasonId();
	setStatus(`No data exists for Season ${seasonId}.`);
	elHero.hidden = true;
	elTeamBody.hidden = true;
	
	elTeamEmpty.hidden = true;
	elTeamEmpty.textContent = "";

	}
}

/* ------------------------- Hero ------------------------- */

function renderHero(seasonId, team, rec, stageMode, poLabel) {
  const teamName = (team.team_name ?? "").trim() || team.team_id;
  elName.textContent = teamName;

  // Big logo
  elLogo.src = `../logos/${seasonId}/${team.team_id}.png`;
  elLogo.alt = `${teamName} logo`;
  elLogo.style.visibility = "visible";
  elLogo.onerror = () => (elLogo.style.visibility = "hidden");

  // Apply team theme (CSS variables)
  const bg = (team.bg_color ?? "").trim() || "#0f1319";
  const fg = (team.text_color ?? "").trim() || "#e7e7e7";
  document.documentElement.style.setProperty("--team-bg", bg);
  document.documentElement.style.setProperty("--team-fg", fg);

  // Record text
if (stageMode === "PO") {
  elMeta.textContent = `${rec.W} - ${rec.OTW} - ${rec.OTL} - ${rec.L} — ${poLabel}`;
} else {
  elMeta.textContent = `${rec.W} - ${rec.OTW} - ${rec.OTL} - ${rec.L} — ${rec.PTS} PTS`;
}

  // Style hero
  elHero.classList.add("team-themed");
  
  // Build schedule link
if (elViewScheduleBtn) {
  const seasonId = getSeasonId();
  const teamId = team.team_id;

  elViewScheduleBtn.href =
    `games.html?season=${encodeURIComponent(seasonId)}&team=${encodeURIComponent(teamId)}`;

  // Theme button
  elViewScheduleBtn.style.backgroundColor = bg;
  elViewScheduleBtn.style.color = fg;
}
}

function perGpNormalized(total, row, scope, advStatsOn){
  const x = toNumMaybe(total);
  if (x == null) return null;

  if (advStatsOn){
    const toi =
      scope === "GOALIE"
        ? toNumMaybe(row.toi_g ?? row.toi)
        : toNumMaybe(row.toi_s ?? row.toi);

    if (toi && toi > 0){
      return x * 900 / toi; // per 15 min
    }
  }

  // fallback (per GP)
  const gp =
    scope === "GOALIE"
      ? toNumMaybe(row.gp_g)
      : toNumMaybe(row.gp_s);

  return gp && gp > 0 ? x / gp : 0;
}

function valueMaybePer15(total, rawRow, scope, advOn, rateMode){
  if (total == null) return null;
  if (rateMode !== "P15") return total;
  if (!advOn) return total;
  return perGpNormalized(total, rawRow, scope, true);
}

/* ------------------------- Roster ------------------------- */

function renderRoster(roster, advOn) {
  const rateMode = elRateMode?.value || "TOTAL";
  const isPer15 = (rateMode === "P15") && advOn;
  const dec = isPer15 ? 2 : null;

  /* ---------- SKATERS ---------- */
  let skaters = roster
    .filter(p => String(p.position ?? "").trim().toUpperCase() !== "G")
    .map(p => {
      const gp  = toIntMaybe(p.gp_s) ?? 0;
      const g0  = toIntMaybe(p.g) ?? 0;
      const a0  = toIntMaybe(p.a) ?? 0;
      const pts0= toIntMaybe(p.pts) ?? 0;

      const shotsRaw = (p.shots ?? "").toString().trim();
      const shotsVal = shotsRaw === "" ? 0 : Number(shotsRaw);
      const shots0   = Number.isFinite(shotsVal) ? shotsVal : 0;

      const g   = valueMaybePer15(g0,   p, "SKATER", advOn, rateMode);
      const a   = valueMaybePer15(a0,   p, "SKATER", advOn, rateMode);
      const pts = valueMaybePer15(pts0, p, "SKATER", advOn, rateMode);
      const shots = valueMaybePer15(shots0, p, "SKATER", advOn, rateMode);

      // SH% (ratio is identical either way, show 0.0% when shots=0)
      const shp = (shots0 > 0) ? (g0 / shots0) * 100 : 0;

      return {
        name: String(p.name ?? "").trim(),
        player_key: String(p.player_key ?? "").trim(),

        gp,
        g, a, pts,
        shots,
        shp,

        blk: valueMaybePer15(toIntMaybe(p.blocks) ?? 0, p, "SKATER", advOn, rateMode),
        passes: valueMaybePer15(toIntMaybe(p.passes) ?? 0, p, "SKATER", advOn, rateMode),
        ta: valueMaybePer15(toIntMaybe(p.takeaways) ?? 0, p, "SKATER", advOn, rateMode),
        to: valueMaybePer15(toIntMaybe(p.turnovers) ?? 0, p, "SKATER", advOn, rateMode),
      };
    });

  /* ---------- GOALIES ---------- */
  let goalies = roster
  .filter(p => String(p.position ?? "").trim().toUpperCase() !== "S")
  .map(p => {
    const gp0 = toIntMaybe(p.gp_g) ?? 0;
    const sa0 = toIntMaybe(p.sa) ?? 0;
    const ga0 = toIntMaybe(p.ga) ?? 0;
    const sv0 = sa0 - ga0;

    const sa = valueMaybePer15(sa0, p, "GOALIE", advOn, rateMode);
    const ga = valueMaybePer15(ga0, p, "GOALIE", advOn, rateMode);
    const sv = valueMaybePer15(sv0, p, "GOALIE", advOn, rateMode);

    const svp = (sa0 > 0) ? (sv0 / sa0) : 0;

    // GAA: prefer TOI-based if available, else per GP
    const toi_g = toNumMaybe(p.toi_g ?? 0) ?? 0;
    const gaa = (advOn && toi_g > 0) ? (ga0 * 900 / toi_g) : (gp0 > 0 ? (ga0 / gp0) : 0);

    return {
      name: String(p.name ?? "").trim(),
      player_key: String(p.player_key ?? "").trim(),
      gp: gp0,
      sa, ga, sv,
      svp,
      gaa,
      w: valueMaybePer15(toIntMaybe(p.wins) ?? 0, p, "GOALIE", advOn, rateMode),
      so: valueMaybePer15(toIntMaybe(p.so) ?? 0, p, "GOALIE", advOn, rateMode),
    };
  });

if (!rosterSortWired) {
  rosterSortWired = true;

  wireSortHeaders("#skatersTable", (key) => {
    if (skSortKey === key) skSortDir = (skSortDir === "desc" ? "asc" : "desc");
    else { skSortKey = key; skSortDir = "desc"; }
    renderRoster(roster, advOn);
  });

  wireSortHeaders("#goaliesTable", (key) => {
    if (gSortKey === key) gSortDir = (gSortDir === "desc" ? "asc" : "desc");
    else { gSortKey = key; gSortDir = "desc"; }
    renderRoster(roster, advOn);
  });
}

// Apply current sort state
skaters = sortRows(skaters, skSortKey, skSortDir);
goalies = sortRows(goalies, gSortKey, gSortDir);
setSortClasses("#skatersTable", skSortKey, skSortDir);
setSortClasses("#goaliesTable", gSortKey, gSortDir);


  /* ---------- RENDER SKATERS ---------- */
  skatersBody.innerHTML = "";
  for (const p of skaters) {
    const tr = document.createElement("tr");
    tr.appendChild(tdLinkPlayer(p.name, p.player_key));
    tr.appendChild(tdNumMaybe(p.gp));
    tr.appendChild(tdNumMaybe(p.g, dec));
	tr.appendChild(tdNumMaybe(p.a, dec));
	tr.appendChild(tdNumMaybe(p.pts, dec));
	tr.appendChild(tdNumMaybe(p.shots, dec));
    tr.appendChild(tdPctMaybe(p.shp, 1));

    tr.appendChild(tdNumMaybe(p.blk, dec, true));
	tr.appendChild(tdNumMaybe(p.passes, dec, true));
	tr.appendChild(tdNumMaybe(p.ta, dec, true));
	tr.appendChild(tdNumMaybe(p.to, dec, true));

    skatersBody.appendChild(tr);
  }

  /* ---------- RENDER GOALIES ---------- */
  goaliesBody.innerHTML = "";
  for (const g of goalies) {
    const tr = document.createElement("tr");
    tr.appendChild(tdLinkPlayer(g.name, g.player_key));
    tr.appendChild(tdNumMaybe(g.gp));
    tr.appendChild(tdNumMaybe(g.sa, dec));
	tr.appendChild(tdNumMaybe(g.ga, dec));
	tr.appendChild(tdNumMaybe(g.sv, dec));
    tr.appendChild(tdPctMaybe(g.svp !== null ? g.svp * 100 : null, 1));
    tr.appendChild(tdNumMaybe(g.gaa, 2));
    tr.appendChild(tdNumMaybe(g.w));
    tr.appendChild(tdNumMaybe(g.so));
    goaliesBody.appendChild(tr);
  }

}



/* ------------------------- Record math ------------------------- */

function computeRecord(teamId, games) {
  let GP = 0, W = 0, OTW = 0, L = 0, OTL = 0, PTS = 0, GF = 0, GA = 0;

  for (const g of games) {
    const home = String(g.home_team_id).trim();
    const away = String(g.away_team_id).trim();
    const hg = toIntMaybe(g.home_goals);
    const ag = toIntMaybe(g.away_goals);
    const ot = toIntMaybe(g.ot) ?? 0;
    if (hg === null || ag === null) continue;

    const isOT = ot > 0;
    const isHome = home === teamId;
    const teamGoals = isHome ? hg : ag;
    const oppGoals = isHome ? ag : hg;

    GP += 1;
    GF += teamGoals;
    GA += oppGoals;

    if (teamGoals > oppGoals) {
  // win
  if (isOT) {
    OTW += 1;
    PTS += 2;
  } else {
    W += 1;
    PTS += 3;
  }
} else {
  // loss
  if (isOT) {
    OTL += 1;
    PTS += 1;
  } else {
    L += 1;
  }
}
  }

  return { GP, W, OTW, L, OTL, PTS, GF, GA, DIFF: GF - GA };
}

function resultLabel(teamGoals, oppGoals, ot) {
  const isOT = (ot ?? 0) > 0;
  const win = teamGoals > oppGoals;
  if (win) return isOT ? "OTW" : "W";
  return isOT ? "OTL" : "L";
}

/* ------------------------- Helpers ------------------------- */

function formatImportedOn(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  // Keep it simple: show as-is (ISO). We can pretty-format later.
  return s.replace("T", " ");
}

function getUrlParam(key) {
  const url = new URL(window.location.href);
  return url.searchParams.get(key);
}

function setStatus(msg) {
  elStatus.hidden = false;
  elStatus.textContent = msg;
}

function clearStatus() {
  elStatus.hidden = true;
  elStatus.textContent = "";
}

function td(v) {
  const td = document.createElement("td");
  td.textContent = v ?? "";
  return td;
}

function tdNum(v) {
  const td = document.createElement("td");
  td.className = "num";
  td.textContent = String(v ?? "");
  return td;
}

function tdNumMaybe(v, decimals = null, isAdv = false) {
  const td = document.createElement("td");
  td.className = "num" + (isAdv ? " adv" : "");

  if (v === null || v === undefined || v === "") {
    td.textContent = "";
    return td;
  }
  if (typeof v === "number" && decimals !== null) {
    td.textContent = v.toFixed(decimals);
    return td;
  }
  td.textContent = String(v);
  return td;
}

function tdLinkPlayer(name, playerKey) {
  const td = document.createElement("td");
  const a = document.createElement("a");
  a.className = "team-link";
  a.textContent = name;

  const seasonId = getSeasonId();
  const key = String(playerKey ?? "").trim();

  // If key exists, link to player page; else fall back to players list
  a.href = key
    ? `player.html?season=${encodeURIComponent(seasonId)}&player_key=${encodeURIComponent(key)}`
    : `players.html?season=${encodeURIComponent(seasonId)}`;

  td.appendChild(a);
  return td;
}


function tdPctMaybe(v, decimals = 1) {
  const td = document.createElement("td");
  td.className = "num";

  if (v === null || v === undefined || Number.isNaN(v)) {
    td.textContent = "";
    return td;
  }

  td.textContent = v.toFixed(decimals) + "%";
  return td;
}
function renderTeamMissingInSeason(seasonId, teamId, seasons) {
  // Show hero as an informational state
  elName.textContent = teamId;
  elMeta.textContent = "";
  elLogo.style.visibility = "hidden";

  // Reset theme vars so it doesn't inherit the previous team
  document.documentElement.style.setProperty("--team-bg", "#0f1319");
  document.documentElement.style.setProperty("--team-fg", "#e7e7e7");
  elHero.classList.add("team-themed");

  // Clear tables
  skatersBody.innerHTML = "";
  goaliesBody.innerHTML = "";

  // Build quick season availability list (best effort)
  const seasonList = (seasons || [])
    .map(s => String(s.season_id ?? "").trim())
    .filter(Boolean);

  const msgLines = [];
  msgLines.push(`No team data for ${teamId} in Season ${seasonId}.`);
  msgLines.push(``);

  // Link back to teams for the selected season
  const back = `teams.html?season=${encodeURIComponent(seasonId)}`;

  // We’ll show a simple message with a link-like text (keeps it dead simple)
  elTeamEmpty.hidden = false;
  elTeamEmpty.innerHTML = `
    <div>${escapeHtml(msgLines[0])}</div>
    <div style="margin-top:6px;">
      <a class="team-link" href="${back}">Back to Teams (Season ${escapeHtml(seasonId)})</a>
    </div>
  `;

  elHero.classList.add("team-themed");
}

function renderTeamAnalyticsRadar(teamId, games, schedule, boxscores, stageMode) {
	// Pull current team colors from CSS variables
const rootStyles = getComputedStyle(document.documentElement);
let teamBg = rootStyles.getPropertyValue("--team-bg").trim() || "#ff9933";
const teamFg = rootStyles.getPropertyValue("--team-fg").trim() || "#ffffff";

// If bg is too close to white or black, use font color instead
if (isNearBlackOrWhite(teamBg)) {
  teamBg = teamFg;
}

const teamOutline = darkenHex(teamBg, 0.35);
  // Filter games by stage using schedule.csv
  const schedByMatch = new Map();
  for (const s of schedule) {
    if (!s.match_id) continue;
    schedByMatch.set(String(s.match_id).trim(), s);
  }

  const stageFilteredGames = games.filter(g => {
    const s = schedByMatch.get(String(g.match_id ?? "").trim());
    const st = String(s?.stage ?? "").trim().toLowerCase();
    if (stageMode === "PO") return isPlayoffStage(st);
    return st === "reg";
  });
  
  // Build match_id -> stage
const stageByMatch = new Map();
for (const s of schedule) {
  if (s.match_id && s.stage) stageByMatch.set(String(s.match_id).trim(), String(s.stage).trim().toLowerCase());
}

// TEAM_SEC per team from boxscores (same logic as teams.js)
const teamSecByTeam = new Map(); // team_id -> TEAM_SEC
const durByMatchTeam = new Map(); // `${matchId}|${teamId}` -> max toi_s

for (const r of (boxscores || [])) {
  const teamIdRow = String(r.team_id ?? "").trim();
  const matchId = String(r.match_id ?? "").trim();
  if (!teamIdRow || !matchId) continue;

  const st = String(stageByMatch.get(matchId) ?? "").trim().toLowerCase();
  if (stageMode === "PO") {
    if (!isPlayoffStage(st)) continue;
  } else {
    if (st !== "reg") continue;
  }

  const toi = toNumMaybe(r.toi_s);
  if (!(toi > 0)) continue;

  const key = `${matchId}|${teamIdRow}`;
  const prev = durByMatchTeam.get(key) ?? 0;
  if (toi > prev) durByMatchTeam.set(key, toi);
}

for (const [key, dur] of durByMatchTeam.entries()) {
  const [, tid] = key.split("|");
  teamSecByTeam.set(tid, (teamSecByTeam.get(tid) ?? 0) + dur);
}

  const teamStats = computeTeamRates(teamId, stageFilteredGames, teamSecByTeam);
  const leagueStats = computeLeagueRates(stageFilteredGames, teamSecByTeam);

  // If no games, show a friendly message
const teamSec = teamSecByTeam.get(teamId) ?? 0;
if (!teamStats || !(teamSec > 0) || !leagueStats || !(leagueStats.teamSec > 0)) {
  elTeamAnalyticsStatus.hidden = false;
  elTeamAnalyticsStatus.textContent = "No games available for Analytics in this stage yet.";
  elTeamAnalytics.innerHTML = "";
  return;
}
  elTeamAnalyticsStatus.hidden = true;
  elTeamAnalyticsStatus.textContent = "";

  // Build radar values as % of league average (league becomes a clean 100 ring)
  // This avoids unit-mismatch (e.g., shots vs %). Hover will still show raw values.
const metrics = [
  { key: "g_15",   label: "G/15"   },
  { key: "xg_15",  label: "xG/15"  },
  { key: "sh_pct", label: "Sh%"    },
  { key: "sf_15",  label: "SF/15"  },

  { key: "sa_15",  label: "SA/15"  },
  { key: "sv_pct", label: "SV%"    },
  { key: "xga_15", label: "xGA/15" },
  { key: "ga_15",  label: "GA/15"  },
];

  const theta = metrics.map(m => m.label);

const teamRaw = metrics.map(m => teamStats[m.key]);
const lgRaw   = metrics.map(m => leagueStats[m.key]);

// NEW: compute per-metric max across ALL TEAMS (league leaders)
const maxByMetric = computeLeagueLeadersMax(stageFilteredGames, teamSecByTeam);
const minByMetric = computeLeagueLeadersMin(stageFilteredGames, teamSecByTeam);

// “Lower is better” metrics:
const inverseKeys = new Set(["ga_15", "xga_15", "sa_15"]);

// ---- Update OFFENSE/DEFENSE header/footer with avg % vs league ----
const capTop = document.querySelector(".analytics-cap-top");
const capBot = document.querySelector(".analytics-cap-bottom");

// helper: pct diff where + is always "better"
// (inverse stats use (league-team)/league)
const pctVsLeague = (key, teamVal, lgVal) => {
  if (!Number.isFinite(teamVal) || !Number.isFinite(lgVal) || lgVal === 0) return null;
  const inv = inverseKeys.has(key);
  const pct = inv
    ? ((lgVal - teamVal) / lgVal) * 100
    : ((teamVal - lgVal) / lgVal) * 100;
  return Number.isFinite(pct) ? pct : null;
};

const avg = (arr) => {
  const xs = arr.filter(v => Number.isFinite(v));
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
};

const fmtPct = (p) => {
  if (p == null) return "—";
  // kill negative zero / tiny jitter
  if (Math.abs(p) < 0.05) p = 0;        // threshold matches 1-decimal rounding
  const s = p >= 0 ? "+" : "";
  return `${s}${p.toFixed(1)}%`;
};
const pctColor = (p) => {
  if (p == null) return "rgba(255,255,255,0.65)";
  if (Math.abs(p) < 0.05) return "rgba(255,255,255,0.65)";
  return p > 0 ? "#4caf50" : "#ff5252";
};


// OFFENSE: G, xG, Sh%, SF
const offKeys = ["g_15", "xg_15", "sh_pct", "sf_15"];
const offPcts = offKeys.map(k => pctVsLeague(k, teamStats[k], leagueStats[k]));
const offAvg = avg(offPcts);

// DEFENSE: GA, xGA, Sv%, SA
const defKeys = ["ga_15", "xga_15", "sv_pct", "sa_15"];
const defPcts = defKeys.map(k => pctVsLeague(k, teamStats[k], leagueStats[k]));
const defAvg = avg(defPcts);

if (capTop) {
  capTop.textContent = `OFFENSE: ${fmtPct(offAvg)}`;
  capTop.style.color = pctColor(offAvg);
}
if (capBot) {
  capBot.textContent = `DEFENSE: ${fmtPct(defAvg)}`;
  capBot.style.color = pctColor(defAvg);
}

const FLOOR = 20;
const CEIL  = 100;

const scaleMetric = (key, v) => {
  const maxV = maxByMetric[key];
  const minV = minByMetric[key];

  if (!Number.isFinite(v)) return null;
  if (!Number.isFinite(maxV) || !Number.isFinite(minV)) return null;

  // If league has no spread, everyone is tied -> full ring
  if (maxV <= minV) return 100;

  const span = (CEIL - FLOOR);

  // Inverse metrics: lower is better (best=min -> 100, worst=max -> FLOOR)
  if (inverseKeys.has(key)) {
    const t = (maxV - v) / (maxV - minV);          // 1 best, 0 worst
    const s = FLOOR + (t * span);
    return Math.max(FLOOR, Math.min(CEIL, s));
  }

  // Normal metrics: higher is better (best=max -> 100, worst=min -> FLOOR)
  const t = (v - minV) / (maxV - minV);            // 0 worst, 1 best
  const s = FLOOR + (t * span);
  return Math.max(FLOOR, Math.min(CEIL, s));
};


const teamScaled = metrics.map((m, i) => scaleMetric(m.key, teamRaw[i]));
const leagueScaled = metrics.map((m, i) => scaleMetric(m.key, lgRaw[i]));

  // Close the loop
  const thetaClosed = [...theta, theta[0]];
  const teamScaledClosed = [...teamScaled, teamScaled[0]];
  const leagueScaledClosed = [...leagueScaled, leagueScaled[0]];

  const teamRawClosed = [...teamRaw, teamRaw[0]];
  const lgRawClosed   = [...lgRaw,   lgRaw[0]];

  const traceLeague = {
    type: "scatterpolar",
    name: "League Average",
    theta: thetaClosed,
    r: leagueScaledClosed,
    mode: "lines",
    line: { width: 2, color: "rgba(255,255,255,0.70)" },
    fill: "toself",
    fillcolor: "rgba(255,255,255,0.06)",
    hoverinfo: "skip",
  };

  const traceTeam = {
    type: "scatterpolar",
    name: "Team",
    theta: thetaClosed,
    r: teamScaledClosed,
    mode: "lines",
	line: { width: 3, color: teamOutline },
	fill: "toself",
	fillcolor: teamBg,
	opacity: 0.5,
    hoverinfo: "skip",
  };
  
  // Build pretty team name for hover header
const teamName = (document.getElementById("teamName")?.textContent ?? String(teamId)).trim() || String(teamId);

// We only want markers on the 8 real spokes (NOT the closed-loop duplicate)
const thetaTips = theta;          // 8 labels
const rTips = teamScaled;         // 8 scaled values

const longLabelMap = {
  "G/15":   "Goals per 15",
  "xG/15":  "Expected Goals per 15",
  "Sh%":    "Shooting Percentage",
  "SF/15":  "Shots For per 15",
  "SA/15":  "Shots Against per 15",
  "SV%":    "Save Percentage",
  "xGA/15": "Expected Goals Against per 15",
  "GA/15":  "Goals Against per 15",
};

const tipCustom = metrics.map((m, i) => {
  const rawTeam = teamRaw[i];
  const rawLg   = lgRaw[i];
  const longLabel = longLabelMap[m.label] ?? m.label;
  return [m.label, rawTeam, rawLg, longLabel];
});


const traceTeamTips = {
  type: "scatterpolar",
  theta: thetaTips,
  r: rTips,
  mode: "markers",
  marker: {
    size: 10,
    color: "rgba(0,0,0,0)",
    line: { width: 0 }
  },
  customdata: metrics.map((m, i) => {
  const rawTeam = teamRaw[i];
  const rawLg   = lgRaw[i];
  const longLabel = longLabelMap[m.label] ?? m.label;

  const isPercentStat = m.key === "sh_pct" || m.key === "sv_pct";

  // Compute % difference vs league
  const isInverse = inverseKeys.has(m.key);

const pctDiff = (Number.isFinite(rawTeam) && Number.isFinite(rawLg) && rawLg !== 0)
  ? (isInverse
      ? ((rawLg - rawTeam) / rawLg) * 100   // lower is better
      : ((rawTeam - rawLg) / rawLg) * 100)  // higher is better
  : null;

  const color = pctDiff == null
    ? "#ffffff"
    : pctDiff > 0
      ? "#4caf50"
      : pctDiff < 0
        ? "#ff5252"
        : "#ffffff";

  const teamFormatted = rawTeam == null
    ? ""
    : rawTeam.toFixed(2) + (isPercentStat ? "%" : "");

  const leagueFormatted = rawLg == null
    ? ""
    : rawLg.toFixed(2) + (isPercentStat ? "%" : "");

  const pctFormatted = pctDiff == null
    ? ""
    : (pctDiff > 0 ? "+" : "") + pctDiff.toFixed(1) + "%";

  return [
    longLabel,
    teamFormatted,
    leagueFormatted,
    pctFormatted,
    color
  ];
}),
  hovertemplate:
  `<b>%{customdata[0]}</b><br>` +
  `%{customdata[1]} (League: %{customdata[2]})<br>` +
  `<span style="color:%{customdata[4]};">%{customdata[3]}</span>` +
  `<extra></extra>`,
};

  const layout = {
    margin: { l: 10, r: 10, t: 0, b: 30 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: "rgba(255,255,255,0.85)" },
	showlegend: false,
    polar: {
      domain: { x: [0.08, 0.92], y: [0.04, 0.90] },
      bgcolor: "rgba(0,0,0,0)",
angularaxis: {
  rotation: 157.5,
  direction: "clockwise",
  tickfont: { size: 12 },
  tickpadding: 2,
  gridcolor: "rgba(255,255,255,0.07)",
  linecolor: "rgba(255,255,255,0.10)"
},
      radialaxis: {
        range: [0, 100],
        showticklabels: false,
        ticks: "",
        gridcolor: "rgba(255,255,255,0.07)",
        linecolor: "rgba(255,255,255,0.10)"
      }
    },

};

  const config = { displayModeBar: false, responsive: true };

  // Plotly is loaded globally via CDN
  Plotly.newPlot(elTeamAnalytics, [traceLeague, traceTeam, traceTeamTips], layout, config);
}

function darkenHex(hex, amount = 0.25) {
  if (!hex || !hex.startsWith("#") || hex.length !== 7) return hex;

  const num = parseInt(hex.slice(1), 16);
  let r = (num >> 16) & 0xff;
  let g = (num >> 8) & 0xff;
  let b = num & 0xff;

  r = Math.max(0, Math.floor(r * (1 - amount)));
  g = Math.max(0, Math.floor(g * (1 - amount)));
  b = Math.max(0, Math.floor(b * (1 - amount)));

  return `rgb(${r}, ${g}, ${b})`;
}

function isNearBlackOrWhite(hex) {
  if (!hex || !hex.startsWith("#") || hex.length !== 7) return false;

  const num = parseInt(hex.slice(1), 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;

  // Perceived brightness formula
  const brightness = (0.299 * r + 0.587 * g + 0.114 * b);

  return brightness > 230 || brightness < 25; // tweak threshold if needed
}

function computeTeamRates(teamId, games, teamSecByTeam) {
  let gf = 0, ga = 0, sf = 0, sa = 0, xg = 0, xga = 0;

  for (const g of games) {
    const home = String(g.home_team_id ?? "").trim();
    const away = String(g.away_team_id ?? "").trim();
    if (home !== teamId && away !== teamId) continue;

    const isHome = home === teamId;

    const tg = toIntMaybe(isHome ? g.home_goals : g.away_goals);
    const og = toIntMaybe(isHome ? g.away_goals : g.home_goals);
    if (tg == null || og == null) continue;

    gf += tg; ga += og;

    const ts = toIntMaybe(isHome ? g.home_shots : g.away_shots);
    const os = toIntMaybe(isHome ? g.away_shots : g.home_shots);
    if (ts != null) sf += ts;
    if (os != null) sa += os;

    const txg = toNumMaybe(isHome ? g.xg_home : g.xg_away);
    const oxg = toNumMaybe(isHome ? g.xg_away : g.xg_home);
    if (txg != null) xg += txg;
    if (oxg != null) xga += oxg;
  }

  const teamSec = teamSecByTeam.get(teamId) ?? 0;
  const per15 = (n) => (teamSec > 0 ? (n * 900 / teamSec) : null);

  const sh_pct = (sf > 0) ? (gf / sf) * 100 : null;
  const sv_pct = (sa > 0) ? ((sa - ga) / sa) * 100 : null;

  return {
    g_15: per15(gf),
    xg_15: per15(xg),
    sh_pct,
    sf_15: per15(sf),

    sa_15: per15(sa),
    sv_pct,
    xga_15: per15(xga),
    ga_15: per15(ga),
  };
}

function computeLeagueRates(games, teamSecByTeam) {
  // League totals across all team-games in the filtered set
  let gf = 0;
  let sf = 0;
  let xg = 0;

  for (const g of games) {
    const hg = toIntMaybe(g.home_goals);
    const ag = toIntMaybe(g.away_goals);
    if (hg == null || ag == null) continue;

    gf += (hg + ag);

    const hs = toIntMaybe(g.home_shots);
    const as = toIntMaybe(g.away_shots);
    if (hs != null) sf += hs;
    if (as != null) sf += as;

    const hxg = toNumMaybe(g.xg_home);
    const axg = toNumMaybe(g.xg_away);
    if (hxg != null) xg += hxg;
    if (axg != null) xg += axg;
  }

  // Total team-seconds across all teams participating in this filtered set
  let leagueTeamSec = 0;
  for (const sec of (teamSecByTeam?.values?.() ?? [])) {
    const s = Number(sec);
    if (Number.isFinite(s) && s > 0) leagueTeamSec += s;
  }
  if (!(leagueTeamSec > 0)) return null;

  const per15 = (n) => (n * 900 / leagueTeamSec);

  // Symmetry at league level: GA=GF, SA=SF, xGA=xG
  const sh_pct = (sf > 0) ? (gf / sf) * 100 : null;
  const sv_pct = (sf > 0) ? ((sf - gf) / sf) * 100 : null;

  return {
    teamSec: leagueTeamSec,

    g_15:   per15(gf),
    xg_15:  per15(xg),
    sh_pct,
    sf_15:  per15(sf),

    sa_15:  per15(sf),
    sv_pct,
    xga_15: per15(xg),
    ga_15:  per15(gf),
  };
}

function computeLeagueLeadersMax(games, teamSecByTeam) {
  // Aggregate totals per team from games.csv
  const byTeam = new Map(); // team_id -> { gf,ga,sf,sa,xg,xga }

  function ensure(teamId) {
    if (!byTeam.has(teamId)) {
      byTeam.set(teamId, { gf: 0, ga: 0, sf: 0, sa: 0, xg: 0, xga: 0 });
    }
    return byTeam.get(teamId);
  }

  for (const g of games) {
    const home = String(g.home_team_id ?? "").trim();
    const away = String(g.away_team_id ?? "").trim();
    if (!home || !away) continue;

    const hg = toIntMaybe(g.home_goals);
    const ag = toIntMaybe(g.away_goals);
    if (hg == null || ag == null) continue;

    const hs = toIntMaybe(g.home_shots) ?? 0;
    const as = toIntMaybe(g.away_shots) ?? 0;

    const hxg = toNumMaybe(g.xg_home) ?? 0;
    const axg = toNumMaybe(g.xg_away) ?? 0;

    // Home totals
    {
      const t = ensure(home);
      t.gf += hg; t.ga += ag;
      t.sf += hs; t.sa += as;
      t.xg += hxg; t.xga += axg;
    }
    // Away totals
    {
      const t = ensure(away);
      t.gf += ag; t.ga += hg;
      t.sf += as; t.sa += hs;
      t.xg += axg; t.xga += hxg;
    }
  }

  // Maxima of per-15 / % metrics across teams
  const max = {
    g_15: 0,
    xg_15: 0,
    sh_pct: 0,
    sf_15: 0,
    sa_15: 0,
    sv_pct: 0,
    xga_15: 0,
    ga_15: 0,
  };

  for (const [tid, t] of byTeam.entries()) {
    const teamSec = Number(teamSecByTeam?.get?.(tid) ?? 0);
    if (!(teamSec > 0)) continue;

    const per15 = (n) => (n * 900 / teamSec);

    const g_15   = per15(t.gf);
    const ga_15  = per15(t.ga);
    const sf_15  = per15(t.sf);
    const sa_15  = per15(t.sa);
    const xg_15  = per15(t.xg);
    const xga_15 = per15(t.xga);

    const sh_pct = (t.sf > 0) ? (t.gf / t.sf) * 100 : 0;
    const sv_pct = (t.sa > 0) ? ((t.sa - t.ga) / t.sa) * 100 : 0;

    max.g_15   = Math.max(max.g_15, g_15);
    max.xg_15  = Math.max(max.xg_15, xg_15);
    max.sh_pct = Math.max(max.sh_pct, sh_pct);
    max.sf_15  = Math.max(max.sf_15, sf_15);

    max.sa_15  = Math.max(max.sa_15, sa_15);
    max.sv_pct = Math.max(max.sv_pct, sv_pct);
    max.xga_15 = Math.max(max.xga_15, xga_15);
    max.ga_15  = Math.max(max.ga_15, ga_15);
  }

  return max;
}

function computeLeagueLeadersMin(games, teamSecByTeam) {
  // Aggregate totals per team from games.csv (same as computeLeagueLeadersMax)
  const byTeam = new Map(); // team_id -> { gf,ga,sf,sa,xg,xga }

  function ensure(teamId) {
    if (!byTeam.has(teamId)) {
      byTeam.set(teamId, { gf: 0, ga: 0, sf: 0, sa: 0, xg: 0, xga: 0 });
    }
    return byTeam.get(teamId);
  }

  for (const g of games) {
    const home = String(g.home_team_id ?? "").trim();
    const away = String(g.away_team_id ?? "").trim();
    if (!home || !away) continue;

    const hg = toIntMaybe(g.home_goals);
    const ag = toIntMaybe(g.away_goals);
    if (hg == null || ag == null) continue;

    const hs = toIntMaybe(g.home_shots) ?? 0;
    const as = toIntMaybe(g.away_shots) ?? 0;

    const hxg = toNumMaybe(g.xg_home) ?? 0;
    const axg = toNumMaybe(g.xg_away) ?? 0;

    // Home totals
    {
      const t = ensure(home);
      t.gf += hg; t.ga += ag;
      t.sf += hs; t.sa += as;
      t.xg += hxg; t.xga += axg;
    }
    // Away totals
    {
      const t = ensure(away);
      t.gf += ag; t.ga += hg;
      t.sf += as; t.sa += hs;
      t.xg += axg; t.xga += hxg;
    }
  }

  const min = {
    g_15: Infinity,
    xg_15: Infinity,
    sh_pct: Infinity,
    sf_15: Infinity,
    sa_15: Infinity,
    sv_pct: Infinity,
    xga_15: Infinity,
    ga_15: Infinity,
  };

  for (const [tid, t] of byTeam.entries()) {
    const teamSec = Number(teamSecByTeam?.get?.(tid) ?? 0);
    if (!(teamSec > 0)) continue;

    const per15 = (n) => (n * 900 / teamSec);

    const g_15   = per15(t.gf);
    const ga_15  = per15(t.ga);
    const sf_15  = per15(t.sf);
    const sa_15  = per15(t.sa);
    const xg_15  = per15(t.xg);
    const xga_15 = per15(t.xga);

    const sh_pct = (t.sf > 0) ? (t.gf / t.sf) * 100 : Infinity;
    const sv_pct = (t.sa > 0) ? ((t.sa - t.ga) / t.sa) * 100 : Infinity;

    min.g_15   = Math.min(min.g_15, g_15);
    min.xg_15  = Math.min(min.xg_15, xg_15);
    min.sh_pct = Math.min(min.sh_pct, sh_pct);
    min.sf_15  = Math.min(min.sf_15, sf_15);

    min.sa_15  = Math.min(min.sa_15, sa_15);
    min.sv_pct = Math.min(min.sv_pct, sv_pct);
    min.xga_15 = Math.min(min.xga_15, xga_15);
    min.ga_15  = Math.min(min.ga_15, ga_15);
  }

  // Normalize Infinity -> null (in case no teams)
  for (const k of Object.keys(min)) {
    if (!Number.isFinite(min[k])) min[k] = null;
  }

  return min;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function stageToLabel(stage, weekNum) {
  if (stage === "reg") return (weekNum != null ? String(weekNum) : "");
  if (stage === "qf") return "QF";
  if (stage === "sf") return "SF";
  if (stage === "f")  return "F";
  // fallback for unknown stages (keeps it robust)
  return stage ? stage.toUpperCase() : "";
}

function isPlayoffStage(stage) {
  const s = String(stage ?? "").trim().toLowerCase();
  return s === "qf" || s === "sf" || s === "f";
}

function seriesIdFromMatchId(matchId) {
  // "M35-G5" -> "M35"
  return String(matchId ?? "").split("-")[0];
}

function gameNumFromMatchId(matchId) {
  // "M35-G5" -> 5
  const m = String(matchId ?? "").match(/-G(\d+)$/i);
  return m ? parseInt(m[1], 10) : 0;
}

function winnerOfGame(teamId, g) {
  const home = String(g.home_team_id ?? "").trim();
  const away = String(g.away_team_id ?? "").trim();
  const hg = toIntMaybe(g.home_goals);
  const ag = toIntMaybe(g.away_goals);
  if (hg == null || ag == null) return null;

  const homeWon = hg > ag;
  const awayWon = ag > hg;
  if (!homeWon && !awayWon) return null; // shouldn't happen, but safe

  return homeWon ? home : away;
}

function computePlayoffResultLabel(teamId, teamGames) {
  // teamGames is your [{ g, s }] list (g from games.csv, s from schedule.csv)
  // We determine outcome from the LAST game of each playoff series.

  // Gather playoff games by series
  const seriesMap = new Map(); // seriesId -> { stage, games: [{g,s}] }

  for (const x of teamGames) {
    const st = String(x.s?.stage ?? "").trim().toLowerCase();
    if (!isPlayoffStage(st)) continue;

    const sid = seriesIdFromMatchId(x.g?.match_id);
    if (!sid) continue;

    if (!seriesMap.has(sid)) seriesMap.set(sid, { stage: st, games: [] });
    seriesMap.get(sid).games.push(x);
  }

  if (seriesMap.size === 0) return "No playoff games";

  // Determine series result for THIS team from last game in that series
  const seriesResults = []; // [{stage, sid, won}]
  for (const [sid, obj] of seriesMap.entries()) {
    const games = obj.games.slice().sort((a, b) =>
      gameNumFromMatchId(a.g?.match_id) - gameNumFromMatchId(b.g?.match_id)
    );
    const last = games[games.length - 1];
    const winTeam = winnerOfGame(teamId, last.g);
    const won = (winTeam === teamId);
    seriesResults.push({ stage: obj.stage, sid, won });
  }

  // Deepest stage played decides final label
  const stageOrder = { qf: 1, sf: 2, f: 3 };
  seriesResults.sort((a, b) => stageOrder[b.stage] - stageOrder[a.stage]);

  const deepest = seriesResults[0];

  // If they played in Finals and won that series: Champs
  if (deepest.stage === "f" && deepest.won) {
  const seasonId = getSeasonId();          // e.g. "S1"
  const seasonNum = String(seasonId).replace(/^S/i, ""); // "1"
  return `WCPL Season ${seasonNum} Champions`;
}
  if (deepest.stage === "f" && !deepest.won) return "Eliminated in Finals";

  if (deepest.stage === "sf" && !deepest.won) return "Eliminated in Semi Finals";
  if (deepest.stage === "qf" && !deepest.won) return "Eliminated in Quarter Finals";

  // If they won deepest-but-not-final, they advanced (in completed seasons they should also appear later,
  // but this makes the label correct even if data is partial).
  if (deepest.stage === "sf" && deepest.won) return "Advanced to Finals";
  if (deepest.stage === "qf" && deepest.won) return "Advanced to Semi Finals";

  return "Playoffs";
}
