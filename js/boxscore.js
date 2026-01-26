// js/boxscore.js
import { loadCSV, toIntMaybe, toNumMaybe } from "./data.js";
import { initSeasonPicker, getSeasonId, onSeasonChange } from "./season.js";

const elSeason = document.getElementById("seasonSelect");
const elStatus = document.getElementById("status");

const elScoreboard = document.getElementById("scoreboard");
const elBanner = document.getElementById("banner");

const elSummary = document.getElementById("summary");
const elHomeSummary = document.getElementById("homeSummary");
const elAwaySummary = document.getElementById("awaySummary");
const elHomeSummaryTitle = document.getElementById("homeSummaryTitle");
const elAwaySummaryTitle = document.getElementById("awaySummaryTitle");

const elPreviewRosters = document.getElementById("previewRosters");
const elPlayedBoxscore = document.getElementById("playedBoxscore");

const T = {
  homeSkaters: byId("homeSkaters"),
  homeGoalies: byId("homeGoalies"),
  awaySkaters: byId("awaySkaters"),
  awayGoalies: byId("awayGoalies"),

  homeGameSkaters: byId("homeGameSkaters"),
  homeGameGoalies: byId("homeGameGoalies"),
  awayGameSkaters: byId("awayGameSkaters"),
  awayGameGoalies: byId("awayGameGoalies"),
};

let seasons = [];
let teams = [];
let schedule = [];
let games = [];
let players = [];
let boxscores = [];

boot();

async function boot() {
  await initSeasonPicker(elSeason);
  onSeasonChange(() => refresh());
  await refresh();
}

async function refresh() {
  const seasonId = getSeasonId();
  const matchId = getParam("match_id");

  if (!seasonId) return setLoading(true, "No season found in seasons.csv.");
  if (!matchId) return setLoading(true, "Missing match_id in URL.");

  setLoading(true, `Loading ${seasonId} ${matchId}…`);

  try {
    [seasons, teams, schedule] = await Promise.all([
      loadCSV(`../data/seasons.csv`),
      loadCSV(`../data/${seasonId}/teams.csv`),
      loadCSV(`../data/${seasonId}/schedule.csv`),
    ]);

    try { games = await loadCSV(`../data/${seasonId}/games.csv`); }
    catch { games = []; }

    // Load preview players (reg vs playoffs) later once we know stage.

    // Boxscores (optional)
    try { boxscores = await loadCSV(`../data/${seasonId}/boxscores.csv`); }
    catch { boxscores = []; }

    const seasonRow = seasons.find(s => String(s.season_id ?? "").trim() === seasonId);
    const advOn = (toIntMaybe(seasonRow?.adv_stats) ?? 0) === 1;

    const schedRow = schedule.find(r => String(r.match_id ?? "").trim() === matchId);
    if (!schedRow) {
      setLoading(true, `Game ${matchId} not found in schedule.csv.`);
      return;
    }

    const stage = String(schedRow.stage ?? "").trim().toLowerCase() || "reg";
    const status = String(schedRow.status ?? "").trim().toLowerCase();

    const homeId = String(schedRow.home_team_id ?? "").trim();
    const awayId = String(schedRow.away_team_id ?? "").trim();

    const tmap = new Map(teams.map(t => [String(t.team_id ?? "").trim(), t]));
    const homeTeam = tmap.get(homeId) || fallbackTeam(homeId);
    const awayTeam = tmap.get(awayId) || fallbackTeam(awayId);

    const gameRow = games.find(g => String(g.match_id ?? "").trim() === matchId) || null;

    const played = (status === "played") || hasScore(gameRow);

    // Always show scoreboard header
    renderScoreboard({
      seasonId,
      matchId,
      stage,
      week: toIntMaybe(schedRow.week) ?? 0,
      status,
      homeTeam,
      awayTeam,
      played,
      gameRow,
    });

// Summary (record + season rates) is ONLY for previews when adv_stats=1
if (advOn && !played) {
  const teamStats = computeTeamStats(schedule, games);
  renderTeamSummary(homeTeam, awayTeam, teamStats);
} else {
  hide(elSummary);
}

    // Banner rules
    hide(elBanner);

    // Reset sections
    hide(elPreviewRosters);
    hide(elPlayedBoxscore);

    if (status === "cancelled") {
      showBanner("This game was cancelled.");
      setLoading(false);
      return;
    }

    // Scheduled preview (or played without full stats but still can show summary)
    if (!played) {
      // Preview rosters use players (reg/playoffs)
      const playersPath =
        (stage === "reg")
          ? `../data/${seasonId}/players.csv`
          : `../data/${seasonId}/players_playoffs.csv`;

      try { players = await loadCSV(playersPath); }
      catch { players = []; }

      renderPreviewRosters(seasonId, homeTeam, awayTeam, players);
      show(elPreviewRosters);

      setLoading(false);
      return;
    }

    // Played game:
    // Full nerd boxscore only if advOn and we have per-player rows for match_id.
    const rowsForMatch = boxscores.filter(r => String(r.match_id ?? "").trim() === matchId);

    if (advOn && rowsForMatch.length > 0) {
      renderPlayedBoxscore(seasonId, homeTeam, awayTeam, rowsForMatch);
      show(elPlayedBoxscore);
    } else {
      // Lite mode banner
      if (!advOn) {
        showBanner("Full boxscores unavailable for Season 1. Scores and OT status are shown; detailed stats are not tracked for this season.");
      } else {
        showBanner("Full boxscores not uploaded yet for this season. Showing a simplified view.");
      }
      // Nothing else to show for played lite (scoreboard + summary is already shown)
    }

    setLoading(false);
  } catch (err) {
    console.error(err);
    setLoading(true, "Error loading boxscore.");
  }
}

/* ------------------------- rendering ------------------------- */

function renderScoreboard({ seasonId, matchId, stage, week, status, homeTeam, awayTeam, played, gameRow }) {
  const el = document.getElementById("scorePill");

  const homeName = displayTeamName(homeTeam);
  const awayName = displayTeamName(awayTeam);

  const hg = toIntMaybe(gameRow?.home_goals);
  const ag = toIntMaybe(gameRow?.away_goals);
  const ot = toIntMaybe(gameRow?.ot) ?? 0;
  
    // ----- Page header: "Week 1 - Game 2 of 3" / "Semi Finals - Game 2 of 5" (+ series winner)
  const gNum = parseGameNum(matchId);
  const sKey = seriesKey(matchId);

  const maxG = seriesMaxGames(stage) || gNum; // fallback
  const leftLabel = (String(stage || "").toLowerCase() === "reg")
    ? `Week ${week || 0}`
    : stageLabel(stage, week);

  let title = `${leftLabel} - Game ${gNum} of ${maxG}`;

// Playoffs clincher/leader/tied line
const isPlayoffs = (String(stage || "").toLowerCase() !== "reg");

if (isPlayoffs && played) {
  const { winnerId, winnerWins, loserWins } =
    computeSeriesWins({ seriesId: sKey, gamesRows: games, upToGameNum: gNum });

  const winsNeeded = Math.ceil(maxG / 2);

  if (winnerWins === loserWins) {
    title += ` - Series tied ${winnerWins}-${loserWins}`;
  } else if (winnerId) {
    const leaderTeam =
      teams.find(t => String(t.team_id ?? "").trim() === winnerId) ||
      { team_id: winnerId };

    const leaderName = displayTeamName(leaderTeam);

    if (winnerWins >= winsNeeded) {
      title += ` - ${leaderName} wins series ${winnerWins}-${loserWins}`;
    } else {
      title += ` - ${leaderName} leads series ${winnerWins}-${loserWins}`;
    }
  }
}

setPageTitle(title);
  
  const resultEl = document.getElementById("resultLabel");

let resultText = "PREVIEW";

if (status === "cancelled") {
  resultText = "CANCELLED";
} else if (played && hg != null && ag != null) {
  resultText = "FINAL";
  if (ot === 1) resultText = "FINAL (OT)";
  else if (ot > 1) resultText = `FINAL (OT${ot})`;
}

resultEl.textContent = resultText;


  // Score text
let scoreText = "Preview";

if (status === "cancelled") {
  scoreText = "Cancelled";
} else if (played && hg != null && ag != null) {
  scoreText = `${hg} – ${ag}`;
}


  // Team colors
  const homeBg = homeTeam?.bg_color || "#1b2028";
  const homeFg = homeTeam?.text_color || "#ffffff";
  const awayBg = awayTeam?.bg_color || "#1b2028";
  const awayFg = awayTeam?.text_color || "#ffffff";

  el.innerHTML = `
    <div class="scorebar">
      <div class="team-pill left"
     style="
       background:${escapeHtml(homeBg)};
       color:${escapeHtml(homeFg)};
       --team-bg:${escapeHtml(homeBg)};
     ">
        <img src="${teamLogoUrl(seasonId, homeTeam.team_id)}"
             class="pill-logo"
             alt="${homeTeam.team_id}"
             onerror="this.style.visibility='hidden'">
        <span class="pill-name">${escapeHtml(homeName)}</span>
      </div>

      <div class="mid-pill">
        <span class="mid-score">${escapeHtml(scoreText)}</span>
      </div>

      <div class="team-pill right"
     style="
       background:${escapeHtml(awayBg)};
       color:${escapeHtml(awayFg)};
       --team-bg:${escapeHtml(awayBg)};
     ">

        <span class="pill-name">${escapeHtml(awayName)}</span>
        <img src="${teamLogoUrl(seasonId, awayTeam.team_id)}"
             class="pill-logo"
             alt="${awayTeam.team_id}"
             onerror="this.style.visibility='hidden'">
      </div>
    </div>
  `;

  show(document.getElementById("scoreboard"));
}

function renderTeamSummary(homeTeam, awayTeam, statsByTeam) {
  const h = statsByTeam.get(homeTeam.team_id) || blankTeamStats();
  const a = statsByTeam.get(awayTeam.team_id) || blankTeamStats();

  const homeTitle = `${displayTeamName(homeTeam)} - ${h.w} - ${h.otw} - ${h.otl} - ${h.l} — ${h.pts} PTS`;
  const awayTitle = `${displayTeamName(awayTeam)} - ${a.w} - ${a.otw} - ${a.otl} - ${a.l} — ${a.pts} PTS`;
  
    applyTeamCardTheme(elHomeSummaryTitle.closest(".card"), homeTeam);
  applyTeamCardTheme(elAwaySummaryTitle.closest(".card"), awayTeam);


  elHomeSummaryTitle.textContent = homeTitle;
  elAwaySummaryTitle.textContent = awayTitle;

  elHomeSummary.innerHTML = summaryHtml(h);
  elAwaySummary.innerHTML = summaryHtml(a);

  show(elSummary);
}

function summaryHtml(s) {
  const gp = s.gp || 0;

  const gfpg = gp > 0 ? (s.gf / gp) : null;
  const gapg = gp > 0 ? (s.ga / gp) : null;

  const sfpg = gp > 0 ? (s.sf / gp) : null;
  const sapg = gp > 0 ? (s.sa / gp) : null;

  const sh = (s.sf > 0) ? (s.gf / s.sf) : null;              // shooting %
  const sv = (s.sa > 0) ? ((s.sa - s.ga) / s.sa) : null;     // save %

  return `

    <div class="table-wrap" style="padding:10px 0 0;">
      <table class="data-table summary-table">
        <thead>
          <tr>
            <th>GF/GP</th>
            <th>GA/GP</th>
            <th>SF/GP</th>
            <th>SA/GP</th>
            <th>SH%</th>
            <th>SV%</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${fmtNum(gfpg, 2)}</td>
            <td>${fmtNum(gapg, 2)}</td>
            <td>${fmtNum(sfpg, 2)}</td>
            <td>${fmtNum(sapg, 2)}</td>
            <td>${fmtPct(sh, 1)}</td>
            <td>${fmtPct(sv, 1)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

function renderPreviewRosters(seasonId, homeTeam, awayTeam, playersRows) {
  setText("homeRosterTitle", `${displayTeamName(homeTeam)} — Roster`);
  setText("awayRosterTitle", `${displayTeamName(awayTeam)} — Roster`);
  
  applyTeamCardTheme(document.getElementById("homeRosterTitle")?.closest(".card"), homeTeam);
applyTeamCardTheme(document.getElementById("awayRosterTitle")?.closest(".card"), awayTeam);


  // Split by team
  const home = playersRows.filter(p => String(p.team_id ?? "").trim() === homeTeam.team_id);
  const away = playersRows.filter(p => String(p.team_id ?? "").trim() === awayTeam.team_id);

  renderPreviewTeamTables(seasonId, homeTeam, home, T.homeSkaters, T.homeGoalies);
  renderPreviewTeamTables(seasonId, awayTeam, away, T.awaySkaters, T.awayGoalies);
}

function renderPreviewTeamTables(seasonId, team, rows, elSk, elGo) {
  // Separate skaters/goalies
  const sk = rows.filter(p => String(p.position ?? "").trim().toUpperCase() !== "G");
  const go = rows.filter(p => String(p.position ?? "").trim().toUpperCase() === "G" || (toIntMaybe(p.gp_g) ?? 0) > 0);

  // Sort
  sk.sort((a, b) => (toIntMaybe(b.pts) ?? 0) - (toIntMaybe(a.pts) ?? 0) || String(a.name ?? "").localeCompare(String(b.name ?? "")));
  go.sort((a, b) => (toNumMaybe(b.sv_pct) ?? -1) - (toNumMaybe(a.sv_pct) ?? -1) || String(a.name ?? "").localeCompare(String(b.name ?? "")));

  // Headers
  setTableHeader(elSk, ["Player", "Pos", "GP", "P/GP", "PTS", "G", "A", "S"]);
  setTableHeader(elGo, ["Goalie", "GP", "SV%", "GAA", "W", "SO", "SA"]);

  // Bodies
  fillTable(elSk, sk.map(p => {
    const gp = toIntMaybe(p.gp_s) ?? 0;
    const pts = toIntMaybe(p.pts) ?? 0;
    const ppg = (toNumMaybe(p.p_per_gp) ?? (gp > 0 ? pts / gp : null));

    return [
      playerLinkHtml(seasonId, p),
      escapeHtml(String(p.position ?? "")),
      String(gp),
      fmtNum(ppg, 2),
      String(pts),
      String(toIntMaybe(p.g) ?? ""),
      String(toIntMaybe(p.a) ?? ""),
      valOrBlank(p.shots),
    ];
  }));

  fillTable(elGo, go.map(p => ([
    playerLinkHtml(seasonId, p),
    String(toIntMaybe(p.gp_g) ?? ""),
    fmtPct(toNumMaybe(p.sv_pct), 1),
    fmtNum(toNumMaybe(p.gaa), 2),
    valOrBlank(p.wins),
    valOrBlank(p.so),
    valOrBlank(p.sa),
  ])));

  elSk.hidden = false;
  elGo.hidden = false;
}

function renderPlayedBoxscore(seasonId, homeTeam, awayTeam, matchRows) {
  setText("homePlayedTitle", displayTeamName(homeTeam));
  setText("awayPlayedTitle", displayTeamName(awayTeam));

  const homeRows = matchRows.filter(r => String(r.team_id ?? "").trim() === homeTeam.team_id);
  const awayRows = matchRows.filter(r => String(r.team_id ?? "").trim() === awayTeam.team_id);

  renderGameTeamTables(seasonId, homeRows, T.homeGameSkaters, T.homeGameGoalies);
  renderGameTeamTables(seasonId, awayRows, T.awayGameSkaters, T.awayGameGoalies);

  T.homeGameSkaters.hidden = false;
  T.homeGameGoalies.hidden = false;
  T.awayGameSkaters.hidden = false;
  T.awayGameGoalies.hidden = false;
}

function renderGameTeamTables(seasonId, rows, elSk, elGo) {
  // Determine goalies by presence of SA/GA or position=G
  const isGoalieRow = (r) => {
    const pos = String(r.position ?? "").trim().toUpperCase();
    if (pos === "G") return true;
    const sa = toIntMaybe(r.sa);
    const ga = toIntMaybe(r.ga);
    return (sa != null || ga != null);
  };

  const sk = rows.filter(r => !isGoalieRow(r));
  const go = rows.filter(r => isGoalieRow(r));

  // Sort skaters by PTS, then G, then S
  sk.sort((a, b) => {
    const ap = (toIntMaybe(a.g) ?? 0) + (toIntMaybe(a.a) ?? 0);
    const bp = (toIntMaybe(b.g) ?? 0) + (toIntMaybe(b.a) ?? 0);
    if (bp !== ap) return bp - ap;
    const bg = (toIntMaybe(b.g) ?? 0) - (toIntMaybe(a.g) ?? 0);
    if (bg !== 0) return bg;
    return (toIntMaybe(b.shots) ?? 0) - (toIntMaybe(a.shots) ?? 0);
  });

  // Sort goalies by SV%
  go.sort((a, b) => {
    const as = toIntMaybe(a.sa) ?? 0, ag = toIntMaybe(a.ga) ?? 0;
    const bs = toIntMaybe(b.sa) ?? 0, bg = toIntMaybe(b.ga) ?? 0;
    const asv = as > 0 ? (as - ag) / as : -1;
    const bsv = bs > 0 ? (bs - bg) / bs : -1;
    return bsv - asv;
  });

  // Headers (your “full nerd minus touches/toi”)
  setTableHeader(elSk, ["Player", "Pos", "G", "A", "S", "Pass", "Ex", "En", "HIT", "TA", "TO", "FOW", "FOL", "Poss (s)"]);
  setTableHeader(elGo, ["Goalie", "SA", "GA", "SV%", "BodySv", "StickSv", "W", "SO"]);

  fillTable(elSk, sk.map(r => ([
    playerLinkHtmlFromBox(seasonId, r),
    escapeHtml(String(r.position ?? "")),
    valOrBlank(r.g),
    valOrBlank(r.a),
    valOrBlank(r.shots),
    valOrBlank(r.passes),
    valOrBlank(r.exits),
    valOrBlank(r.entries),
    valOrBlank(r.hits),
    valOrBlank(r.takeaways),
    valOrBlank(r.turnovers),
    valOrBlank(r.fow),
    valOrBlank(r.fol),
    valOrBlank(r.poss_s),
  ])));

  fillTable(elGo, go.map(r => {
    const sa = toIntMaybe(r.sa) ?? 0;
    const ga = toIntMaybe(r.ga) ?? 0;
    const svp = sa > 0 ? ((sa - ga) / sa) : null;

    return [
      playerLinkHtmlFromBox(seasonId, r),
      valOrBlank(r.sa),
      valOrBlank(r.ga),
      fmtPct(svp, 1),
      valOrBlank(r.body_sv),
      valOrBlank(r.stick_sv),
      valOrBlank(r.w),
      valOrBlank(r.so),
    ];
  }));

  elSk.hidden = false;
  elGo.hidden = false;
}

/* ------------------------- stats (records) ------------------------- */

function computeTeamStats(scheduleRows, gameRows) {
  const gameById = new Map(gameRows.map(g => [String(g.match_id ?? "").trim(), g]));

  const out = new Map();

  for (const s of scheduleRows) {
    const matchId = String(s.match_id ?? "").trim();
    if (!matchId) continue;

    const status = String(s.status ?? "").trim().toLowerCase();
    if (status === "cancelled") continue;

    const g = gameById.get(matchId) || null;
    const played = (status === "played") || hasScore(g);
    if (!played) continue;

    const homeId = String(s.home_team_id ?? g?.home_team_id ?? "").trim();
    const awayId = String(s.away_team_id ?? g?.away_team_id ?? "").trim();
    if (!homeId || !awayId) continue;

    const hg = toIntMaybe(g?.home_goals);
    const ag = toIntMaybe(g?.away_goals);
    if (hg == null || ag == null) continue;

    const ot = toIntMaybe(g?.ot) ?? 0;

// Shots (optional; only accumulates if present in games.csv)
const hs = toIntMaybe(g?.home_shots ?? g?.home_sog ?? g?.home_sf);
const as = toIntMaybe(g?.away_shots ?? g?.away_sog ?? g?.away_sf);

ensureTeam(out, homeId);
ensureTeam(out, awayId);

const home = out.get(homeId);
const away = out.get(awayId);

home.gp++; away.gp++;
home.gf += hg; home.ga += ag;
away.gf += ag; away.ga += hg;

if (hs != null && as != null) {
  home.sf += hs; home.sa += as;
  away.sf += as; away.sa += hs;
}


    if (hg > ag) {
      if (ot > 0) { home.otw++; away.otl++; }
      else { home.w++; away.l++; }
    } else if (ag > hg) {
      if (ot > 0) { away.otw++; home.otl++; }
      else { away.w++; home.l++; }
    }

    // PTS = 3*W + 2*OTW + OTL
    home.pts = 3*home.w + 2*home.otw + home.otl;
    away.pts = 3*away.w + 2*away.otw + away.otl;
  }

  // Ensure pts computed even for teams with 0 games (already handled in ensureTeam)
  for (const t of out.values()) {
    t.pts = 3*t.w + 2*t.otw + t.otl;
  }

  return out;
}

function ensureTeam(map, teamId) {
  if (!map.has(teamId)) map.set(teamId, blankTeamStats());
}

function blankTeamStats() {
  return { gp: 0, w: 0, otw: 0, otl: 0, l: 0, pts: 0, gf: 0, ga: 0, sf: 0, sa: 0 };
}

/* ------------------------- helpers ------------------------- */

function setLoading(isLoading, msg = "") {
  elStatus.hidden = !isLoading;
  elStatus.textContent = msg;
}

function showBanner(text) {
  elBanner.textContent = text;
  elBanner.hidden = false;
}

function show(el) { el.hidden = false; }
function hide(el) { el.hidden = true; }

function byId(id){ return document.getElementById(id); }
function setText(id, text){ const el = document.getElementById(id); if (el) el.textContent = text; }

function getParam(key) {
  return new URLSearchParams(location.search).get(key);
}

function hasScore(g) {
  const hg = toIntMaybe(g?.home_goals);
  const ag = toIntMaybe(g?.away_goals);
  return hg !== null && ag !== null;
}

function stageLabel(stage, week) {
  if (stage === "reg") return week ? `Week ${week}` : "Regular Season";
  if (stage === "qf") return "Quarter Finals";
  if (stage === "sf") return "Semi Finals";
  if (stage === "f")  return "Final";
  return (stage || "").toUpperCase();
}

function statusLabel(status, played) {
  if (status === "cancelled") return "Cancelled";
  if (played) return "Completed";
  return "Scheduled";
}

function fallbackTeam(team_id) {
  const id = (team_id ?? "").trim();
  return { team_id: id || "UNKNOWN", team_name: id || "UNKNOWN", bg_color: "", text_color: "" };
}

function displayTeamName(t) {
  return (t.team_name ?? t.full_name ?? t.name ?? t.team_id ?? "").toString().trim() || (t.team_id ?? "UNKNOWN");
}

function teamLogoUrl(seasonId, teamId) {
  return `../logos/${seasonId}/${encodeURIComponent(teamId)}.png`;
}

function setTableHeader(tableEl, labels) {
  const thead = tableEl.querySelector("thead");
  const tr = document.createElement("tr");
  for (const l of labels) {
    const th = document.createElement("th");
    th.textContent = l;
    tr.appendChild(th);
  }
  thead.innerHTML = "";
  thead.appendChild(tr);
}

function fillTable(tableEl, rows) {
  const tbody = tableEl.querySelector("tbody");
  tbody.innerHTML = "";
  for (const r of rows) {
    const tr = document.createElement("tr");
    for (const cellHtml of r) {
      const td = document.createElement("td");
      td.innerHTML = cellHtml ?? "";
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

function playerLinkHtml(seasonId, p) {
  const key = String(p.player_key ?? "").trim();
  const nm = escapeHtml(String(p.name ?? "").trim());
  if (!key) return nm;
  const href = `player.html?season=${encodeURIComponent(seasonId)}&player_key=${encodeURIComponent(key)}`;
  return `<a class="team-link" href="${href}">${nm}</a>`;
}

// For boxscores.csv rows (no player_key). We join by steam_id to players.csv later if needed.
// For now, we link by name only if we can find player_key in players.csv (future enhancement).
function playerLinkHtmlFromBox(seasonId, r) {
  const nm = escapeHtml(String(r.player_name ?? "").trim());
  return nm || "Unknown";
}

function valOrBlank(v) {
  const s = (v ?? "").toString().trim();
  return s === "" ? "" : escapeHtml(s);
}

function fmtNum(v, decimals = 2) {
  if (v == null) return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return n.toFixed(decimals);
}

function fmtPct(rate, decimals = 1) {
  if (rate == null) return "";
  const n = Number(rate);
  if (!Number.isFinite(n)) return "";
  return (n * 100).toFixed(decimals);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function applyTeamCardTheme(cardEl, team) {
  if (!cardEl || !team) return;
  cardEl.style.setProperty("--team-bg", team.bg_color || "#2a3340");
  cardEl.style.setProperty("--team-fg", team.text_color || "#ffffff");
}

function setPageTitle(text){
  const h1 = document.querySelector("main h1");
  if (h1) h1.textContent = text;
}

function parseGameNum(matchId){
  const m = String(matchId || "").match(/-G(\d+)$/i);
  return m ? (parseInt(m[1], 10) || 0) : 0;
}

function seriesKey(matchId){
  return String(matchId || "").split("-")[0]; // "M31" from "M31-G2"
}

function seriesMaxGames(stage){
  const s = String(stage || "").toLowerCase();
  if (s === "reg") return 3;
  if (s === "qf")  return 3;
  if (s === "sf")  return 5;
  if (s === "f")   return 5; // your data shows finals as Bo5
  return 0;
}

function computeSeriesWins({ seriesId, gamesRows, upToGameNum }){
  const winsByTeam = new Map();

  const rows = (gamesRows || []).filter(g => {
    const id = String(g.match_id ?? "").trim();
    if (!id.startsWith(seriesId + "-")) return false;

    // Only count games up to the current game number (prevents "wins series" showing early)
    const n = parseGameNum(id);
    if (upToGameNum && n && n > upToGameNum) return false;

    return true;
  });

  for (const g of rows) {
    const hg = toIntMaybe(g?.home_goals);
    const ag = toIntMaybe(g?.away_goals);
    if (hg == null || ag == null) continue;

    const homeId = String(g.home_team_id ?? "").trim();
    const awayId = String(g.away_team_id ?? "").trim();
    if (!homeId || !awayId) continue;

    const winnerId = (hg > ag) ? homeId : (ag > hg) ? awayId : null;
    if (!winnerId) continue;

    winsByTeam.set(winnerId, (winsByTeam.get(winnerId) || 0) + 1);
  }

  // Determine leader + runner-up (if any)
  const entries = [...winsByTeam.entries()].sort((a,b)=>b[1]-a[1]);
  const winnerId = entries[0]?.[0] || "";
  const winnerWins = entries[0]?.[1] || 0;
  const loserWins  = entries[1]?.[1] || 0;

  return { winsByTeam, winnerId, winnerWins, loserWins };
}

