// js/index.js
import { loadCSV, toIntMaybe, toNumMaybe } from "./data.js";
import { initSeasonPicker, getSeasonId, onSeasonChange } from "./season.js";

const elSeason = document.getElementById("seasonSelect");
const elStatus = document.getElementById("status");
const elStatusWrap = document.getElementById("statusWrap");
const elBody = document.getElementById("pageBody");

const elStrip = document.getElementById("scheduleStrip");
const btnPrev = document.getElementById("schedPrev");
const btnNext = document.getElementById("schedNext");

const elSkaters = document.getElementById("homeSkaters");
const elSkatersBody = elSkaters.querySelector("tbody");

const elGoalies = document.getElementById("homeGoalies");
const elGoaliesBody = elGoalies.querySelector("tbody");

const elStage = document.getElementById("stageSelect");
const elHomePlayoffsWrap = document.getElementById("homePlayoffsWrap");
const elHomeStandingsWrap = document.getElementById("homeStandingsWrap");
const elHomeStageSubtitle = document.getElementById("homeStageSubtitle");
const elLeadersStageSubtitle = document.getElementById("leadersStageSubtitle");

let teams = [];
let players = [];
let games = [];
let schedule = [];

boot();

async function boot() {
  await initSeasonPicker(elSeason);
  onSeasonChange(() => refresh());
  elStage?.addEventListener("change", () => refresh());
  wireScheduleButtons();
  await refresh();
}

async function urlExists(url){
  try{
    const r = await fetch(url, { method: "HEAD" });
    return r.ok;
  }catch{
    return false;
  }
}

function setPlayoffsOptionEnabled(ok){
  const opt = [...elStage.options].find(o => o.value === "PO");
  if (!opt) return;
  opt.disabled = !ok;
  if (!ok && elStage.value === "PO") elStage.value = "REG";
}

function wireScheduleButtons() {
  const step = () => Math.max(260, Math.floor(elStrip.clientWidth * 0.8));

  btnPrev.addEventListener("click", () => {
    elStrip.scrollBy({ left: -step(), behavior: "smooth" });
  });
  btnNext.addEventListener("click", () => {
    elStrip.scrollBy({ left: step(), behavior: "smooth" });
  });
}

// Computes correct base prefix for CSV loading depending on where the page lives
// - If you're on /index.html -> base = "data/..."
// - If you're on /pages/*.html -> base = "../data/..."
function dataBase() {
  const path = window.location.pathname || "";
  return path.includes("/pages/") ? "../data" : "data";
}

async function refresh() {
  const seasonId = getSeasonId();
  if (!seasonId) {
    setEmptyState(true, "No season found in seasons.csv.");
    return;
  }

  setEmptyState(true, `Loading ${seasonId}…`);

  try {
    const base = dataBase();

const teamsPath = `${base}/${seasonId}/teams.csv`;
const regularPlayersPath = `${base}/${seasonId}/players.csv`;
const playoffPlayersPath = `${base}/${seasonId}/players_playoffs.csv`;
const gamesPath = `${base}/${seasonId}/games.csv`;
const schedPath = `${base}/${seasonId}/schedule.csv`;
const seasonsPath = `${base}/seasons.csv`.replace(`${base}/`, "data/"); // OR just keep seasons as "data/seasons.csv"

// Enable/disable the playoffs mode based on playoffs players file existing
const hasPlayoffsPlayers = await urlExists(playoffPlayersPath);
setPlayoffsOptionEnabled(hasPlayoffsPlayers);

const stageMode = (elStage?.value === "PO" && hasPlayoffsPlayers) ? "PO" : "REG";

const playersPath = (stageMode === "PO") ? playoffPlayersPath : regularPlayersPath;

const [seasons, tRows, pRows, gRows, sRows] = await Promise.all([
  loadCSV(seasonsPath),
  loadCSV(teamsPath),
  loadCSV(playersPath),
  loadCSV(gamesPath),
  loadCSV(schedPath),
]);

teams = tRows;
players = pRows;
games = gRows;
schedule = sRows;


if (elHomeStageSubtitle) {
  elHomeStageSubtitle.textContent = stageMode === "PO" ? "(Playoffs)" : "(Regular Season)";
}
if (elLeadersStageSubtitle) {
  elLeadersStageSubtitle.textContent = stageMode === "PO" ? "(Playoffs)" : "(Regular Season)";
}

    setEmptyState(false);

    renderSchedule(seasonId);
    if (stageMode === "REG") {
  elHomePlayoffsWrap.hidden = true;
  // your existing standings render
  renderStandings(seasonId);
  elHomeStandingsWrap.hidden = false;
} else {
  elHomeStandingsWrap.hidden = true;
  renderPlayoffsBracket(seasonId, teams, games, schedule);
  elHomePlayoffsWrap.hidden = false;
}

// leaders should already be based on `players` you loaded
    renderLeaders(seasonId);
  } catch (err) {
    console.error(err);
    setEmptyState(true, `No data exists for Season ${seasonId}.`);
  }
}

/* ----------------------------- schedule ----------------------------- */

function renderSchedule(seasonId) {
  const teamById = new Map(teams.map(t => [String(t.team_id ?? "").trim(), t]));

  // match_id -> game row
  const gameByMatch = new Map();
  for (const g of games) {
    const mid = String(g.match_id ?? "").trim();
    if (mid) gameByMatch.set(mid, g);
  }

  // Precompute series max G# per matchup (M#) for playoff stages
  // seriesKey = `${stage}|M35`  -> maxG = 3
  const seriesMaxGame = new Map();
  for (const s of schedule) {
    const stage = String(s.stage ?? "").trim().toLowerCase();
    if (!["qf", "sf", "f"].includes(stage)) continue;

    const mid = String(s.match_id ?? "").trim();
    const m = matchPrefix(mid);         // "M35"
    const gnum = matchGameNumber(mid);  // 1..N
    if (!m || !gnum) continue;

    const key = `${stage}|${m}`;
    seriesMaxGame.set(key, Math.max(seriesMaxGame.get(key) ?? 0, gnum));
  }

  // Build schedule items (include playoffs too; hide only cancelled)
  const items = schedule
    .filter(s => String(s.status ?? "").toLowerCase() !== "cancelled")
    .map(s => {
      const match_id = String(s.match_id ?? "").trim();
      if (!match_id) return null;

      const stage = String(s.stage ?? "").trim().toLowerCase();
      const status = String(s.status ?? "").trim().toLowerCase();

      const home = String(s.home_team_id ?? "").trim();
      const away = String(s.away_team_id ?? "").trim();
      const week = toIntMaybe(s.week) ?? 0;

      const imported_on = String(s.imported_on ?? "").trim(); // YYYY-MM-DD for played

      const g = gameByMatch.get(match_id);
      const hg = g ? toIntMaybe(g.home_goals) : null;
      const ag = g ? toIntMaybe(g.away_goals) : null;
      const ot = g ? (toIntMaybe(g.ot) ?? 0) : 0;

      const played = status === "played" && hg !== null && ag !== null;

      // Sort: reg by week then match number; playoffs after reg, then stage order qf->sf->f
      const stageOrder = stage === "reg" ? 0 : (stage === "qf" ? 1 : (stage === "sf" ? 2 : 3));
      const gnum = matchGameNumber(match_id);
      const mprefix = matchPrefix(match_id);
      const matchNum = mprefix ? Number(mprefix.slice(1)) : 0;

      const sortKey = stageOrder * 1_000_000 + week * 10_000 + matchNum * 10 + gnum;

      // Series end detection (only playoffs)
      const isPlayoffs = ["qf", "sf", "f"].includes(stage);
      const seriesKey = isPlayoffs && mprefix ? `${stage}|${mprefix}` : null;
      const maxG = seriesKey ? (seriesMaxGame.get(seriesKey) ?? 0) : 0;
      const isLastInSeries = isPlayoffs && gnum === maxG;

      return {
        match_id,
        mprefix,
        gnum,
        week,
        stage,
        status,
        imported_on,
        home,
        away,
        played,
        hg,
        ag,
        ot,
        isLastInSeries,
        homeTeam: teamById.get(home),
        awayTeam: teamById.get(away),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.sortKey - b.sortKey);

  elStrip.innerHTML = "";

  if (!items.length) {
    elStrip.innerHTML = `<div class="schedule-empty">No games found for this season.</div>`;
    return;
  }

  for (const it of items) {
    elStrip.appendChild(buildScheduleCard(seasonId, it, gameByMatch, items));
  }

  scrollScheduleToMostRecent(items);
}

function scrollScheduleToMostRecent(items) {
  // Prefer: last played game. If none played, first unplayed.
  let idx = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].played) { idx = i; break; }
  }
  if (idx < 0) {
    idx = items.findIndex(x => !x.played);
    if (idx < 0) idx = 0;
  }

  const card = elStrip.children[idx];
  if (!card) return;

  // Wait for layout so widths/positions are correct
  requestAnimationFrame(() => {
    const stripRect = elStrip.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const currentLeft = elStrip.scrollLeft;

    const cardCenter = (cardRect.left - stripRect.left) + (cardRect.width / 2);
    const target = currentLeft + (cardCenter - (stripRect.width / 2));

    elStrip.scrollTo({ left: Math.max(0, target), behavior: "auto" });
  });
}

function buildScheduleCard(seasonId, it, gameByMatch, allItems) {
  const card = document.createElement("div");
  card.className = "sched-card";

  // ----- Top label -----
  const top = document.createElement("div");
  top.className = "sched-top";

  const phaseName = stageLabel(it.stage);
  const dateOrWeek = (it.imported_on && it.played)
    ? it.imported_on
    : `Week ${it.week}`;

  top.textContent = `${dateOrWeek} - ${phaseName}`;
  card.appendChild(top);

  // Two team rows (away then home)
  card.appendChild(buildSchedTeamRow(seasonId, it.away, it.awayTeam, it.played ? it.ag : null));
  card.appendChild(buildSchedTeamRow(seasonId, it.home, it.homeTeam, it.played ? it.hg : null));

  // ----- Footer status -----
  const foot = document.createElement("div");
  foot.className = "sched-foot";

  if (!it.played) {
    foot.textContent = "Scheduled";
  } else {
    const base = (it.ot > 0) ? "Final (OT)" : "Final";

    // Series winner annotation (only when last game of the matchup is completed)
    const seriesNote = seriesWinNote(seasonId, it, gameByMatch, allItems);

    foot.textContent = seriesNote ? `${base} - ${seriesNote}` : base;
  }

  card.appendChild(foot);
  return card;
}

/* ---------------- series + label helpers ---------------- */

function stageLabel(stage) {
  switch (String(stage ?? "").toLowerCase()) {
    case "reg": return "Regular Season";
    case "qf":  return "Quarter Finals";
    case "sf":  return "Semi Finals";
    case "f":   return "WCPL Championship";
    default:    return String(stage ?? "").toUpperCase();
  }
}

function matchPrefix(matchId) {
  // "M35-G3" -> "M35"
  const m = String(matchId ?? "").match(/^(M\d+)\s*-\s*G\d+\s*$/i);
  return m ? m[1].toUpperCase() : null;
}

function matchGameNumber(matchId) {
  // "M35-G3" -> 3
  const m = String(matchId ?? "").match(/-G(\d+)\s*$/i);
  return m ? Number(m[1]) : 0;
}

function seriesWinNote(seasonId, it, gameByMatch, allItems) {
  const stage = String(it.stage ?? "").toLowerCase();
  if (!["qf", "sf", "f"].includes(stage)) return "";      // only playoffs
  if (!it.isLastInSeries) return "";                      // only last game in matchup
  if (!it.mprefix) return "";

  // Collect all games in this playoff matchup (same stage + same M#)
  const seriesGames = allItems.filter(x =>
    x.played &&
    x.stage === stage &&
    x.mprefix === it.mprefix
  );

  if (!seriesGames.length) return "";

  // Count wins across the series
  const wins = new Map(); // team_id -> wins
  for (const g of seriesGames) {
    if (g.hg === null || g.ag === null) continue;
    const homeWin = g.hg > g.ag;
    const winner = homeWin ? g.home : g.away;
    wins.set(winner, (wins.get(winner) ?? 0) + 1);
  }

  if (wins.size === 0) return "";

  // Find top winner
  let bestTeam = null;
  let bestWins = -1;
  for (const [tid, w] of wins.entries()) {
    if (w > bestWins) { bestWins = w; bestTeam = tid; }
  }
  if (!bestTeam) return "";

  // If finals, special wording
  if (stage === "f") {
    const n = seasonNumberFromId(seasonId);
    return `${bestTeam} wins WCPL Season ${n ?? seasonId}`;
  }

  const otherTeam = (bestTeam === it.home) ? it.away : it.home;
const otherWins = wins.get(otherTeam) ?? 0;
return `${bestTeam} wins series ${bestWins}-${otherWins}`;
}

function seasonNumberFromId(seasonId) {
  // "S1" -> 1, "S12" -> 12
  const m = String(seasonId ?? "").match(/^S(\d+)$/i);
  return m ? Number(m[1]) : null;
}


function parseMatchGameNumber(matchId) {
  // match_id looks like "M1-G1", "M12-G3", etc.
  const m = String(matchId).match(/-G(\d+)\s*$/i);
  return m ? Number(m[1]) : 0;
}

function buildSchedTeamRow(seasonId, teamId, teamRow, score) {
  const row = document.createElement("div");
  row.className = "sched-row";

  const left = document.createElement("div");
  left.className = "sched-left";

  const logoWrap = document.createElement("div");
  logoWrap.className = "sched-logo";
  if (teamRow?.bg_color) logoWrap.style.backgroundColor = teamRow.bg_color;

  const img = document.createElement("img");
  img.loading = "lazy";
  img.alt = `${teamId} logo`;
  img.src = `logos/${seasonId}/${teamId}.png`;
  img.onerror = () => (img.style.visibility = "hidden");
  logoWrap.appendChild(img);

  const name = document.createElement("div");
  name.className = "sched-team";
  name.textContent = teamId || "";

  left.appendChild(logoWrap);
  left.appendChild(name);

  const right = document.createElement("div");
  right.className = "sched-score";
  right.textContent = (score === null || score === undefined) ? "" : String(score);

  row.appendChild(left);
  row.appendChild(right);

  return row;
}

/* ---------------------------- standings ---------------------------- */

function renderStandings(seasonId) {
  const elWrap = document.getElementById("homeStandingsWrap");
  if (!elWrap) return;

  // Map match_id → stage (reg-only standings)
  const stageByMatch = new Map();
  for (const s of schedule) {
    const mid = String(s.match_id ?? "").trim();
    const st = String(s.stage ?? "").trim().toLowerCase();
    if (mid && st) stageByMatch.set(mid, st);
  }

  // Build team map
  const tmap = new Map();
  for (const t of teams) {
    const team_id = String(t.team_id ?? "").trim();
    if (!team_id) continue;

    tmap.set(team_id, {
      team_id,
      team_name: String(t.team_name ?? "").trim(),
      conference: String(t.conference ?? "").trim() || "Conference",
      bg_color: String(t.bg_color ?? "").trim(),
      text_color: String(t.text_color ?? "").trim(),
      GP: 0, W: 0, OTW: 0, OTL: 0, L: 0, PTS: 0,
      GF: 0, GA: 0,
    });
  }

  // Compute standings (regular season only)
  for (const g of games) {
    const home = String(g.home_team_id ?? "").trim();
    const away = String(g.away_team_id ?? "").trim();
    if (!home || !away) continue;

    const matchId = String(g.match_id ?? "").trim();
    const stage = stageByMatch.get(matchId);
    if (stage !== "reg") continue;

    const hg = toIntMaybe(g.home_goals);
    const ag = toIntMaybe(g.away_goals);
    if (hg === null || ag === null) continue;

    const ot = toIntMaybe(g.ot) ?? 0;
    const homeRow = tmap.get(home);
    const awayRow = tmap.get(away);
    if (!homeRow || !awayRow) continue;

    homeRow.GP++; awayRow.GP++;
    homeRow.GF += hg; homeRow.GA += ag;
    awayRow.GF += ag; awayRow.GA += hg;

    const isOT = ot > 0;
    const homeWin = hg > ag;

    if (!isOT) {
      // Reg W=3, Reg L=0
      if (homeWin) { homeRow.W++; homeRow.PTS += 3; awayRow.L++; }
      else { awayRow.W++; awayRow.PTS += 3; homeRow.L++; }
    } else {
      // OTW=2, OTL=1
      if (homeWin) {
        homeRow.OTW++; homeRow.PTS += 2;
        awayRow.OTL++; awayRow.PTS += 1;
      } else {
        awayRow.OTW++; awayRow.PTS += 2;
        homeRow.OTL++; homeRow.PTS += 1;
      }
    }
  }

  // Group by conference
  const confMap = new Map();
  for (const r of tmap.values()) {
    const c = r.conference || "Conference";
    if (!confMap.has(c)) confMap.set(c, []);
    confMap.get(c).push({ ...r, DIFF: r.GF - r.GA });
  }

  const confs = [...confMap.keys()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
  
  // If we have 2 conferences, force the home layout to stay 2-column (Standings + Leaders)
const page = document.getElementById("pageBody"); // <main ... id="pageBody">
if (page) page.classList.toggle("home-wide", confs.length === 2);

  const isTwoConf = (confs.length === 2);

// existing toggle for the mini grid
elWrap.classList.toggle("two-col", isTwoConf);

// NEW: toggle the layout mode on the parent row
document.querySelector(".home-two")?.classList.toggle("two-conf", isTwoConf);


  // Toggle 2-col layout if exactly two conferences
  elWrap.classList.toggle("two-col", confs.length === 2);

  // Render
  elWrap.innerHTML = "";

  for (const confName of confs) {
    const rows = confMap.get(confName) ?? [];

    // Sort within conference
    rows.sort((a, b) =>
      (b.PTS - a.PTS) ||
      (b.DIFF - a.DIFF) ||
      (b.GF - a.GF) ||
      String(a.team_name ?? "").localeCompare(String(b.team_name ?? ""), undefined, { sensitivity: "base" })
    );

    const block = document.createElement("div");

    const title = document.createElement("div");
    title.className = "standings-mini-title";
    title.textContent = confName;
    block.appendChild(title);

    const tw = document.createElement("div");
    tw.className = "table-wrap";

    const table = document.createElement("table");
    table.className = "data-table";
    table.innerHTML = `
      <thead>
        <tr>
		  <th></th>
          <th class="left">Team</th>
          <th class="num">GP</th>
          <th class="num">W</th>
          <th class="num">OTW</th>
          <th class="num">OTL</th>
          <th class="num">L</th>
          <th class="num">PTS</th>
          <th class="num">GDiff</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector("tbody");

    for (const r of rows) {
      const tr = document.createElement("tr");

      // Logo
      const tdLogo = document.createElement("td");
      tdLogo.className = "logo-cell";
      if (r.bg_color) tdLogo.style.backgroundColor = r.bg_color;

      const img = document.createElement("img");
      img.className = "logo";
      img.loading = "lazy";
      img.alt = `${r.team_id} logo`;
      img.src = `logos/${seasonId}/${r.team_id}.png`;
      img.onerror = () => (img.style.visibility = "hidden");
      tdLogo.appendChild(img);
      tr.appendChild(tdLogo);

      // Team link
      const tdTeam = document.createElement("td");
      const a = document.createElement("a");
      a.className = "team-link";
      a.href = `pages/team.html?season=${encodeURIComponent(seasonId)}&team_id=${encodeURIComponent(r.team_id)}`;
      a.textContent = r.team_name || r.team_id;
      tdTeam.appendChild(a);
      tr.appendChild(tdTeam);
      tr.appendChild(tdNum(r.GP));
      tr.appendChild(tdNum(r.W));
      tr.appendChild(tdNum(r.OTW));
      tr.appendChild(tdNum(r.OTL));
      tr.appendChild(tdNum(r.L));
      tr.appendChild(tdNum(r.PTS));

      // GDiff with + for positive
      const tdDiff = document.createElement("td");
      tdDiff.className = "num";
      tdDiff.textContent = (r.DIFF > 0) ? `+${r.DIFF}` : String(r.DIFF);
      tr.appendChild(tdDiff);

      tbody.appendChild(tr);
    }

    tw.appendChild(table);
    block.appendChild(tw);
    elWrap.appendChild(block);
  }

  elWrap.hidden = false;
}

/* ----------------------------- leaders ----------------------------- */

function renderLeaders(seasonId) {
  const teamById = new Map(teams.map(t => [String(t.team_id ?? "").trim(), t]));

  /* ---------------- helpers (goalies only) ---------------- */
  function clamp(min, v, max) {
    return Math.max(min, Math.min(max, v));
  }

  function computeMinGP(maxGP, frac, floorMin, capMax) {
    if (!Number.isFinite(maxGP) || maxGP <= floorMin) return floorMin;
    return clamp(floorMin, Math.round(maxGP * frac), capMax);
  }

  function poolWithAdaptiveMin(rows, getGP, neededCount, frac, floorMin, capMax) {
    const maxGP = rows.reduce((m, r) => Math.max(m, getGP(r) ?? 0), 0);
    let minGP = computeMinGP(maxGP, frac, floorMin, capMax);

    for (let i = 0; i < 4; i++) {
      const pool = rows.filter(r => getGP(r) >= minGP);
      if (pool.length >= neededCount) return { pool, minGP };
      minGP = Math.max(floorMin, Math.floor(minGP / 2));
    }

    return { pool: rows.filter(r => getGP(r) > 0), minGP: floorMin };
  }

  /* ---------------- SKATERS ---------------- */
  const skaters = players
    .map(p => {
      const g = toIntMaybe(p.g) ?? 0;

      // Match players.js: shots column is `shots`
      const shotsRaw = (p.shots ?? "").toString().trim();
      const shotsVal = shotsRaw === "" ? null : Number(shotsRaw);
      const shots = Number.isFinite(shotsVal) ? shotsVal : null;

      const a = toIntMaybe(p.a) ?? 0;
      const pts = toIntMaybe(p.pts) ?? 0;
      const gp = toIntMaybe(p.gp_s) ?? 0;

      const sh_pct = (shots !== null && shots > 0) ? (g / shots) * 100 : null;

      return {
        player_key: String(p.player_key ?? "").trim(),
        name: String(p.name ?? "").trim(),
        team_id: String(p.team_id ?? "").trim(),
        gp,
        pts,
        g,
        a,
        sh_pct,
        team: teamById.get(String(p.team_id ?? "").trim()),
      };
    })
    .filter(r => r.gp > 0)
    .sort((a, b) => (b.pts - a.pts) || (b.g - a.g) || a.name.localeCompare(b.name))
    .slice(0, 5);

  elSkatersBody.innerHTML = "";
  for (const r of skaters) {
    const tr = document.createElement("tr");
    tr.appendChild(tdLogoCellHome(seasonId, r.team_id, r.team));
    tr.appendChild(tdPlayerLink(seasonId, r.player_key, r.name));
    tr.appendChild(tdNum(r.gp));
    tr.appendChild(tdNum(r.pts));
    tr.appendChild(tdNum(r.g));
    tr.appendChild(tdNum(r.a));
    tr.appendChild(tdPctText(r.sh_pct, 1));
    tr.appendChild(tdTeamLink(seasonId, r.team_id));
    elSkatersBody.appendChild(tr);
  }
  elSkaters.hidden = false;

  /* ---------------- GOALIES ---------------- */
  const goalieRows = players
    .map(p => {
      const gp = toIntMaybe(p.gp_g) ?? 0;
      const ga = toIntMaybe(p.ga) ?? 0;

      return {
        player_key: String(p.player_key ?? "").trim(),
        name: String(p.name ?? "").trim(),
        team_id: String(p.team_id ?? "").trim(),
        gp,
        svp: toNumMaybe(p.sv_pct), // 0–1
        gaa: gp > 0 ? (ga / gp) : null,
        sa: toIntMaybe(p.sa),
        so: toIntMaybe(p.so),
        team: teamById.get(String(p.team_id ?? "").trim()),
      };
    })
    .filter(r => r.gp > 0 && r.svp !== null);

  const { pool: gPool, minGP: gMinGP } = poolWithAdaptiveMin(
    goalieRows,
    r => r.gp,
    3,
    0.30,
    1,
    5 // cap at 5
  );

  const goalies = gPool
    .sort((a, b) => (b.svp - a.svp) || (b.gp - a.gp) || a.name.localeCompare(b.name))
    .slice(0, 3);

  // Update goalie subtitle only: "Top Goalies (Min GP = X)"
  const gTitle = elGoalies.closest(".leaders-block")?.querySelector(".leaders-subtitle");
  if (gTitle) gTitle.textContent = `Top Goalies (Min GP = ${gMinGP})`;

  elGoaliesBody.innerHTML = "";
  for (const r of goalies) {
    const tr = document.createElement("tr");
    tr.appendChild(tdLogoCellHome(seasonId, r.team_id, r.team));
    tr.appendChild(tdPlayerLink(seasonId, r.player_key, r.name));
    tr.appendChild(tdNum(r.gp));
    tr.appendChild(tdPctText(r.svp * 100, 1));
    tr.appendChild(tdNum(r.gaa !== null ? r.gaa.toFixed(2) : ""));
    tr.appendChild(tdNumMaybe(r.sa));
    tr.appendChild(tdNumMaybe(r.so));
    elGoaliesBody.appendChild(tr);
    tr.appendChild(tdTeamLink(seasonId, r.team_id));
  }
  elGoalies.hidden = false;
}

/* ------------------------------ helpers ------------------------------ */

function setEmptyState(isEmpty, msg = "") {
  elStatus.textContent = msg;
  elStatusWrap.hidden = !isEmpty;
  elBody.hidden = isEmpty;
}

function tdText(v) {
  const td = document.createElement("td");
  td.textContent = v ?? "";
  return td;
}

function tdNum(v) {
  const td = document.createElement("td");
  td.className = "num";
  td.textContent = String(v ?? 0);
  return td;
}

function tdNumMaybe(v) {
  const td = document.createElement("td");
  td.className = "num";
  td.textContent = (v === null || v === undefined || v === "") ? "" : String(v);
  return td;
}

function tdPctText(v, decimals = 1) {
  const td = document.createElement("td");
  td.className = "num";
  if (v === null || v === undefined || !Number.isFinite(Number(v))) {
    td.textContent = "";
    return td;
  }
  td.textContent = `${Number(v).toFixed(decimals)}%`;
  return td;
}

function tdLogoCellHome(seasonId, teamId, teamRow) {
  const tdLogo = document.createElement("td");
  tdLogo.className = "logo-cell";
  if (teamRow?.bg_color) tdLogo.style.backgroundColor = teamRow.bg_color;

  const img = document.createElement("img");
  img.className = "logo";
  img.loading = "lazy";
  img.alt = `${teamId} logo`;
  img.src = `logos/${seasonId}/${teamId}.png`;
  img.onerror = () => (img.style.visibility = "hidden");
  tdLogo.appendChild(img);

  return tdLogo;
}

function tdTeamLink(seasonId, teamId) {
  const td = document.createElement("td");
  const a = document.createElement("a");
  a.className = "team-link";
  a.href = `pages/team.html?season=${encodeURIComponent(seasonId)}&team_id=${encodeURIComponent(teamId)}`;
  a.textContent = teamId;
  td.appendChild(a);
  return td;
}

function tdPlayerLink(seasonId, playerKey, name) {
  const td = document.createElement("td");
  const a = document.createElement("a");
  a.className = "team-link";
  a.href = `pages/player.html?season=${encodeURIComponent(seasonId)}&player_key=${encodeURIComponent(playerKey)}`;
  a.textContent = name;
  td.appendChild(a);
  return td;
}

function isPlayoffStage(st){
  const x = String(st ?? "").trim().toLowerCase();
  return x === "qf" || x === "sf" || x === "f";
}

// Group games into a "series" by (stage + the two teams).
// Winner is determined by the LAST completed game in that series.
function renderPlayoffsBracket(seasonId, teams, games, schedule){
  const teamById = new Map(teams.map(t => [String(t.team_id).trim(), t]));

  // match_id -> schedule row
  const schedByMatch = new Map();
  for (const s of schedule){
    if (!s.match_id) continue;
    schedByMatch.set(String(s.match_id).trim(), s);
  }

// Series scheduling: Mxx -> max G# scheduled (based on schedule.csv)
const maxGamesBySeries = new Map();
for (const s of schedule) {
  if (!s.match_id) continue;
  if (!isPlayoffStage(s.stage)) continue;

  const mid = String(s.match_id).trim();
  const sid = seriesIdFromMatchId(mid);
  const gno = gameNumFromMatchId(mid);

  if (!sid || !gno) continue;
  maxGamesBySeries.set(sid, Math.max(maxGamesBySeries.get(sid) ?? 0, gno));
}

const pg = games
  .map(g => {
    const mid = String(g.match_id ?? "").trim();
    const s = schedByMatch.get(mid);
    return { g, s };
  })
  .filter(x => x.s && isPlayoffStage(x.s.stage));

  // seriesKey -> series object
  const series = new Map();

  for (const { g, s } of pg){
    const home = String(g.home_team_id ?? "").trim();
    const away = String(g.away_team_id ?? "").trim();
    const st   = String(s.stage ?? "").trim().toLowerCase();

    if (!home || !away) continue;

    // stable key regardless of home/away
    const a = home < away ? home : away;
    const b = home < away ? away : home;
    const key = `${st}|${a}|${b}`;

if (!series.has(key)){
  series.set(key, {
    stage: st,
    sid: seriesIdFromMatchId(s.match_id),
    a, b,
    games: [],
  });
}

    series.get(key).games.push({ g, s });
  }

  // build columns QF/SF/F
  const rounds = [
    { st: "qf", title: "Quarter Finals (Bo3)" },
    { st: "sf", title: "Semi FInals (Bo5)" },
    { st: "f",  title: "Finals (Bo5)" },
  ];

  elHomePlayoffsWrap.innerHTML = "";

  for (const r of rounds){
    const col = document.createElement("div");
    const title = document.createElement("div");
    title.className = "playoffs-col-title";
    title.textContent = r.title;
    col.appendChild(title);

    const list = [...series.values()]
      .filter(x => x.stage === r.st);

    if (!list.length){
      const empty = document.createElement("div");
      empty.className = "status";
      empty.textContent = "No matchups.";
      col.appendChild(empty);
      elHomePlayoffsWrap.appendChild(col);
      continue;
    }

    // Sort by whatever schedule order you already use: date/when/imported_on if present
    list.sort((x, y) => (x.a + x.b).localeCompare(y.a + y.b));

    for (const srs of list) {
  // completed games = has both scores
  const completed = srs.games.filter(x =>
    toIntMaybe(x.g.home_goals) !== null && toIntMaybe(x.g.away_goals) !== null
  );

  // wins in series based on completed games
  let aw = 0, bw = 0;
  
    const scheduledN = maxGamesBySeries.get(srs.sid) ?? 0;
  const completedN = completed.length;

  // series is complete only if we've got all scheduled games completed
  const seriesFinal = (scheduledN > 0 && completedN >= scheduledN);

  // status label
  const statusText = seriesFinal
    ? "Final"
    : (completedN ? "In progress" : "Scheduled");

  for (const x of completed) {
    const home = String(x.g.home_team_id ?? "").trim();
    const away = String(x.g.away_team_id ?? "").trim();
    const hs = toIntMaybe(x.g.home_goals);
    const as = toIntMaybe(x.g.away_goals);
    if (hs === null || as === null) continue;

    const winId = (hs > as) ? home : away;
    if (winId === srs.a) aw++;
    else if (winId === srs.b) bw++;
  }

  // determine "last completed game" winner
  const last = completed.length ? completed[completed.length - 1] : null;
  const winner = last ? (() => {
    const home = String(last.g.home_team_id ?? "").trim();
    const away = String(last.g.away_team_id ?? "").trim();
    const hs = toIntMaybe(last.g.home_goals);
    const as = toIntMaybe(last.g.away_goals);
    if (hs === null || as === null) return null;
    return (hs > as) ? home : away;
  })() : null;

  const aTeam = teamById.get(srs.a);
  const bTeam = teamById.get(srs.b);

  const aName = String(aTeam?.team_name ?? srs.a);
  const bName = String(bTeam?.team_name ?? srs.b);

  const card = document.createElement("div");
  card.className = "series-card";

  const top = document.createElement("div");
  top.className = "series-top";
  top.innerHTML = `<span>${stageLabel(r.st)}</span><span>${statusText}</span>`;
  card.appendChild(top);

  const teamsBox = document.createElement("div");
  teamsBox.className = "series-teams";
  
  const rowA = document.createElement("div");
rowA.className = "series-row";

const rowB = document.createElement("div");
rowB.className = "series-row";

const aLogo = teamLogoUrl(seasonId, srs.a); // uses same helper as schedule
const bLogo = teamLogoUrl(seasonId, srs.b);


rowA.innerHTML = `
  <span class="series-left">
    <img class="pill-logo" src="${aLogo}" alt="">
    <span class="name">${aName}</span>
  </span>
  <span class="wins">${aw}</span>
`;

rowB.innerHTML = `
  <span class="series-left">
    <img class="pill-logo" src="${bLogo}" alt="">
    <span class="name">${bName}</span>
  </span>
  <span class="wins">${bw}</span>
`;

// Accent colors via CSS variables (prettier than full-fill)
if (aTeam?.bg_color) rowA.style.setProperty("--team-bg", String(aTeam.bg_color).trim());
if (aTeam?.text_color) rowA.style.setProperty("--team-fg", String(aTeam.text_color).trim());

if (bTeam?.bg_color) rowB.style.setProperty("--team-bg", String(bTeam.bg_color).trim());
if (bTeam?.text_color) rowB.style.setProperty("--team-fg", String(bTeam.text_color).trim());

// Winner/loser styling (only when series is Final)
rowA.classList.remove("is-winner","is-loser");
rowB.classList.remove("is-winner","is-loser");

if (seriesFinal && winner) {
  if (winner === srs.a) {
    rowA.classList.add("is-winner");
    rowB.classList.add("is-loser");
  } else if (winner === srs.b) {
    rowB.classList.add("is-winner");
    rowA.classList.add("is-loser");
  }
}

  teamsBox.appendChild(rowA);
  teamsBox.appendChild(rowB);
  card.appendChild(teamsBox);

  col.appendChild(card);
}

    elHomePlayoffsWrap.appendChild(col);
  }
}
function seriesIdFromMatchId(matchId) {
  return String(matchId ?? "").split("-")[0]; // "M35-G5" -> "M35"
}
function gameNumFromMatchId(matchId) {
  const m = String(matchId ?? "").match(/-G(\d+)$/i);
  return m ? parseInt(m[1], 10) : 0;
}

function teamLogoUrl(seasonId, teamId) {
  if (!teamId) return "";
  return `logos/${seasonId}/${teamId}.png`;
}
