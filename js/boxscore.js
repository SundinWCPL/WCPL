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

// Speed display multiplier
// 2.23694 = m/s → mph
// 3.6     = m/s → km/h
const SPEED_MULT = 2.23694;
const SPEED_UNIT = "mph";

let playerMaps = { bySteam: null, byName: null };

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

let starMap = new Map();

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
	  playerMaps = buildPlayerMaps(players);

      renderPreviewRosters(seasonId, homeTeam, awayTeam, players, advOn);
      show(elPreviewRosters);

      setLoading(false);
      return;
    }

    // Played game:
    // Full nerd boxscore only if advOn and we have per-player rows for match_id.
    const rowsForMatch = boxscores.filter(r => String(r.match_id ?? "").trim() === matchId);
	
// Load players for linking boxscore names
const playersPath =
  (stage === "reg")
    ? `../data/${seasonId}/players.csv`
    : `../data/${seasonId}/players_playoffs.csv`;

try { players = await loadCSV(playersPath); }
catch { players = []; }
playerMaps = buildPlayerMaps(players);

    if (advOn && rowsForMatch.length > 0) {
      renderPlayedBoxscore(seasonId, homeTeam, awayTeam, rowsForMatch, gameRow);
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
  
    const hs = toIntMaybe(gameRow?.home_shots ?? gameRow?.home_sog ?? gameRow?.home_sf);
  const as = toIntMaybe(gameRow?.away_shots ?? gameRow?.away_sog ?? gameRow?.away_sf);

  
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
  
  setupGameNavigation({
  seasonId,
  matchId,
  stage
});

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
        <div class="pill-text left">
  <span class="pill-name">${escapeHtml(homeName)}</span>
  ${
    (played && hs != null)
      ? `<span class="pill-sog">SOG: ${hs}</span>`
      : ``
  }
</div>

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

        <div class="pill-text right">
  <span class="pill-name">${escapeHtml(awayName)}</span>
  ${
    (played && as != null)
      ? `<span class="pill-sog">SOG: ${as}</span>`
      : ``
  }
</div>
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

function renderPreviewRosters(seasonId, homeTeam, awayTeam, playersRows, advOn) {
  setText("homeRosterTitle", `${displayTeamName(homeTeam)} — Roster`);
  setText("awayRosterTitle", `${displayTeamName(awayTeam)} — Roster`);
  
  applyTeamCardTheme(document.getElementById("homeRosterTitle")?.closest(".card"), homeTeam);
applyTeamCardTheme(document.getElementById("awayRosterTitle")?.closest(".card"), awayTeam);


  // Split by team
  const home = playersRows.filter(p => String(p.team_id ?? "").trim() === homeTeam.team_id);
  const away = playersRows.filter(p => String(p.team_id ?? "").trim() === awayTeam.team_id);

renderPreviewTeamTables(seasonId, homeTeam, home, T.homeSkaters, T.homeGoalies, advOn);
renderPreviewTeamTables(seasonId, awayTeam, away, T.awaySkaters, T.awayGoalies, advOn);
}

function renderPreviewTeamTables(seasonId, team, rows, elSk, elGo, advOn) {
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

const ppgCsv = toNumMaybe(p.p_per_gp);
const ppg = (ppgCsv != null && Number.isFinite(ppgCsv))
  ? ppgCsv
  : perGpNormalized(pts, p, "SKATER", advOn);

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

function renderPlayedBoxscore(seasonId, homeTeam, awayTeam, matchRows, gameRow) {
  setText("homePlayedTitle", displayTeamName(homeTeam));
  setText("awayPlayedTitle", displayTeamName(awayTeam));

  const homeRows = matchRows.filter(r => String(r.team_id ?? "").trim() === homeTeam.team_id);
  const awayRows = matchRows.filter(r => String(r.team_id ?? "").trim() === awayTeam.team_id);
const stars = computeThreeStars(matchRows);
starMap = new Map();
stars.forEach((s, i) => {
  starMap.set(`${s.team_id}|${normalizeName(s.player_name)}`, i + 1);
});

  renderGameTeamTables(seasonId, homeRows, T.homeGameSkaters, T.homeGameGoalies);
  renderGameTeamTables(seasonId, awayRows, T.awayGameSkaters, T.awayGameGoalies);
  
    // Shot maps (from games.csv shot_summary)
  const allShots = parseShotSummary(gameRow?.shot_summary);

  // Convention: importer writes Red=home, Blue=away
  const homeShots = allShots.filter(e => String(e.teamColor).trim().toLowerCase() === "red");
  const awayShots = allShots.filter(e => String(e.teamColor).trim().toLowerCase() === "blue");

  renderShotMapPlotly({
    divId: "homeShotMap",
    events: homeShots,
    seasonId,
    teamLabel: displayTeamName(homeTeam)
  });

  renderShotMapPlotly({
    divId: "awayShotMap",
    events: awayShots,
    seasonId,
    teamLabel: displayTeamName(awayTeam)
  });
  

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
  setTableHeader(elSk, ["Player", "Pos", "G", "A", "Sh", "Pass", "Ex", "En", "HIT", "TA", "TO", "FOW", "FOL", "Poss (s)", "SP"]);
  setTableHeader(elGo, ["Goalie", "SA", "GA", "SV%", "SV", "Body Sv", "Stick Sv", "Pass", "W", "SO", "SP"]);

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
	valOrBlank(r.sp),
  ])));

  fillTable(elGo, go.map(r => {
    const sa = toIntMaybe(r.sa) ?? 0;
    const ga = toIntMaybe(r.ga) ?? 0;
    const svp = sa > 0 ? ((sa - ga) / sa) : null;
	const sv = sa - ga;

    return [
      playerLinkHtmlFromBox(seasonId, r),
      valOrBlank(r.sa),
      valOrBlank(r.ga),
      fmtPct(svp, 1),
	  String(sv),
      valOrBlank(r.body_sv),
      valOrBlank(r.stick_sv),
	  valOrBlank(r.passes),
      valOrBlank(r.w),
      valOrBlank(r.so),
	  valOrBlank(r.sp),
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
  const rawName = String(r.player_name ?? "").trim();
  if (!rawName) return "Unknown";

  // star lookup (use rawName exactly like your starMap currently stores it)
  const starKey = `${String(r.team_id ?? "").trim()}|${normalizeName(rawName)}`;
  const star = starMap?.get(starKey);

  // Support common boxscores.csv steam id column names
const steam =
  normalizeId(r.steam_id ?? r.steamid ?? r.steamID ?? r.steam ?? r.steam64);

  const p =
    (steam && playerMaps?.bySteam?.get(steam)) ||
    playerMaps?.byName?.get(normalizeName(rawName)) ||
    null;

  if (p?.player_key) {
    const href =
      `player.html?season=${encodeURIComponent(seasonId)}` +
      `&player_key=${encodeURIComponent(p.player_key)}`;

    const label = star
      ? `${escapeHtml(p.name)} ${starGlyph(star)}`
      : escapeHtml(p.name);

    return `<a class="team-link" href="${href}">${label}</a>`;
  }

  return star
    ? `${escapeHtml(rawName)} ${starGlyph(star)}`
    : escapeHtml(rawName);
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
  const titleText = document.getElementById("boxscoreTitleText");
  if (titleText) {
    titleText.textContent = text;
    return;
  }

  // fallback (older HTML)
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
function perGpNormalized(total, row, scope, advStatsOn){
  const x = toNumMaybe(total);
  if (x == null) return null;

  if (advStatsOn){
    const toi =
      scope === "GOALIE"
        ? toNumMaybe(row.toi_g ?? row.toi)
        : toNumMaybe(row.toi_s ?? row.toi);

    if (toi && toi > 0){
      return x * 900 / toi;
    }
  }

  // legacy fallback (per appearance)
  const gp =
    scope === "GOALIE"
      ? toNumMaybe(row.gp_g)
      : toNumMaybe(row.gp_s);

  return gp && gp > 0 ? x / gp : null;
}
function normalizeName(name){
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "")      // remove spaces/underscores
    .replace(/[^a-z0-9]/g, "");  // strip punctuation
}

function normalizeId(v){
  let s = String(v ?? "").trim();
  // common "Excel-safe" prefixes
  s = s.replace(/^=+/, "");   // "=7656..." -> "7656..."
  s = s.replace(/^'+/, "");   // "'7656..." -> "7656..."
  // remove any accidental whitespace
  s = s.replace(/\s+/g, "");
  return s;
}

function buildPlayerNameMap(players){
  const map = new Map();

  for (const p of players){
    const key = normalizeName(p.name);
    if (!key) continue;

    // If duplicates ever exist, first one wins (acceptable for now)
    if (!map.has(key)){
      map.set(key, p);
    }
  }
  return map;
}

function buildPlayerMaps(players){
  const bySteam = new Map();
  const byName  = new Map();

  for (const p of players || []){
    const keyName = normalizeName(p.name);
    if (keyName && !byName.has(keyName)) byName.set(keyName, p);

    // Support a few common column names (adjust if your players.csv uses a specific one)
    const steam =
      normalizeId(p.steam_id ?? p.steamid ?? p.steamID ?? p.steam ?? p.steam64);

    if (steam && !bySteam.has(steam)) bySteam.set(steam, p);
  }

  return { bySteam, byName };
}

function parseShotSummary(summary) {
  const s = String(summary ?? "").trim();
  if (!s) return [];

  // New format per event:
  // t|Team|SteamID|shotKind|shotType|contactV|contactY|x|z|result
  return s.split(";").map(part => {
    const fields = part.split("|");
    return {
      t: fields[0] ?? "",                // e.g., "P1 - 3:24"
      teamColor: fields[1] ?? "",        // "Red" / "Blue"
      steamId: fields[2] ?? "",
      shotKind: fields[3] ?? "",         // "shot" / "bat"starGlyph
      shotType: fields[4] ?? "",         // "shot" / "one_timer" / etc
      contactV: toNumMaybe(fields[5]),   // PuckVelocity from save/goal row
      contactY: toNumMaybe(fields[6]),   // yCoord from save/goal row
      x: toNumMaybe(fields[7]),
      z: toNumMaybe(fields[8]),
      result: fields[9] ?? ""            // "G" or "S"
    };
  }).filter(e => Number.isFinite(e.x) && Number.isFinite(e.z));
}

function distToNet(x, z) {
  const NET_X = 0;
  const NET_Z = 39.8; // goal line
  const dx = x - NET_X;
  const dz = z - NET_Z;
  return Math.sqrt(dx*dx + dz*dz);
}

function renderShotMapPlotly({ divId, events, seasonId, teamLabel }) {
  const el = document.getElementById(divId);
  if (!el) return;
  const RINK_X = 22.3;
const END_Z  = 45.6;
const BLUE_Z = 13.25;
const GOAL_Z = 39.8;
const NET_BACK_Z = 41.3;
const POST_X_L = -1.5;
const POST_X_R =  1.5;
const NET_DEPTH_VIS = 2.2;   // how deep the net goes (visual)
const NET_CORNER_R  = 0.6;   // roundness of back corners (visual)
const BOARD_CORNER_R = 2.5; // meters, visual only
const CREASE_RADIUS = 3.2; // visual, meters
const CREASE_COLOR  = "#5dade2"; // soft crease blue
const CREASE_FILL = "rgba(70, 150, 255, 0.18)";   // soft fill
const CREASE_LINE = "rgba(70, 150, 255, 0.55)";   // slightly darker outline

  if (!events || events.length === 0 || typeof Plotly === "undefined") {
    el.innerHTML = "";
    el.style.display = "none";
    return;
  }
  el.style.display = "block";
function creaseClosedPath(cx, cz, r, steps = 48) {
  // Builds: left goal-line point -> true semicircle -> right goal-line point -> back along goal line -> close
  // Arc bulges toward center ice (down in z).
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = Math.PI - (Math.PI * i) / steps; // start left, end right
    const x = cx + r * Math.cos(t);
    const z = cz - r * Math.sin(t);
    pts.push([x, z]);
  }

  const [x0, z0] = pts[0];                 // left goal-line point (z ~ cz)
  let d = `M ${x0},${z0}`;
  for (let i = 1; i < pts.length; i++) {
    const [xi, zi] = pts[i];
    d += ` L ${xi},${zi}`;
  }
  const [xN, zN] = pts[pts.length - 1];    // right goal-line point (z ~ cz)
  d += ` L ${xN},${cz}`;                   // ensure exactly on goal line
  d += ` L ${x0},${cz} Z`;                 // back along goal line and close
  return d;
}

  // Split: goals vs on-net
  const goals = events.filter(e => (e.result || "").toUpperCase() === "G");
  const onNet = events.filter(e => (e.result || "").toUpperCase() !== "G");

const nameFromSteam = (steamId) => {
  const key = normalizeId(steamId);
  const p = key ? playerMaps?.bySteam?.get(key) : null;
  return p?.name || "";
};

  const makeTrace = (arr, name, marker) => ({
    type: "scatter",
    mode: "markers",
    name,
    x: arr.map(e => e.x),
    y: arr.map(e => e.z),
    customdata: arr.map(e => {
  const player = nameFromSteam(e.steamId) || `Unknown (${e.steamId || "?"})`;
  const dist = distToNet(e.x, e.z);

  let shotTypePretty = String(e.shotType || "");

if (shotTypePretty === "wrap_bank") {
  shotTypePretty = "Wrap/Bank";
} else {
  shotTypePretty = shotTypePretty
    .replace(/_/g, " ")
    .replace(/^./, c => c.toUpperCase());
}


  // Optional: prefix Bat shots
let typeLine = shotTypePretty;

if (String(e.shotKind || "").toLowerCase() === "bat") {
  typeLine = "Bat/Tip";
}

const contactSpeed = (e.contactV != null && Number.isFinite(e.contactV))
  ? (e.contactV * SPEED_MULT).toFixed(1)
  : "";
  const contactY = (e.contactY != null && Number.isFinite(e.contactY)) ? e.contactY.toFixed(2) : "";

  const atLabel = (String(e.result || "").toUpperCase() === "G")
    ? "At Goal Line"
    : "At Save";

  return [
  player,
  String(e.t || ""),
  Number.isFinite(dist) ? dist.toFixed(1) : "",
  typeLine,
  atLabel,
  contactSpeed,
  contactY
];
}),
hovertemplate:
  "<b>%{customdata[0]}</b><br>" +
  "%{customdata[1]}<br>" +
  "Distance: %{customdata[2]} m<br>" +
  "Type: %{customdata[3]}<br>" +
  "Speed (%{customdata[4]}): %{customdata[5]} " + SPEED_UNIT + "<br>" +
  "Puck Height (%{customdata[4]}): %{customdata[6]} m<br>" +
  "<extra></extra>",
    marker
  });

  const data = [
    makeTrace(onNet, "On Net", { size: 9, opacity: 0.85, line: { width: 1 } }),
    makeTrace(goals, "Goal",  { size: 13, opacity: 0.95, line: { width: 1 } }),
  ];
const PAD_X = 1; // meters – visual padding past boards
  const layout = {
    title: null,
    margin: { l: 4, r: 4, t: 4, b: 4 },
    showlegend: true,
    legend: { orientation: "h" },
    paper_bgcolor: "#ffffff",
	plot_bgcolor: "#ffffff",
	autosize: true,
xaxis: {
  range: [-(RINK_X + PAD_X), (RINK_X + PAD_X)],
  visible: false,
  fixedrange: true,
  domain: [0, 1]
},
yaxis: {
  range: [13.1, END_Z+.1],
  visible: false,
  fixedrange: true,
  domain: [0, 1]
},
shapes: [
// Boards outline (rounded top corners)
{
  type: "path",
  path: (() => {
    const r = Math.min(BOARD_CORNER_R, RINK_X, END_Z);
    return `
      M ${-RINK_X},0
      L ${-RINK_X},${END_Z - r}
      Q ${-RINK_X},${END_Z} ${-RINK_X + r},${END_Z}
      L ${RINK_X - r},${END_Z}
      Q ${RINK_X},${END_Z} ${RINK_X},${END_Z - r}
      L ${RINK_X},0
      Z
    `;
  })(),
  line: { width: 2, color: "#000" }
},

  // Blue line (blue!)
  { type: "line", x0: -RINK_X, x1: RINK_X, y0: BLUE_Z, y1: BLUE_Z, line: { width: 2, color: "#1e66ff" } },

  
// Crease (NHL style: filled)
{
  type: "path",
  path: creaseClosedPath(0, GOAL_Z, CREASE_RADIUS, 64),
  line: { width: 2, color: CREASE_LINE },
  fillcolor: CREASE_FILL
},

  // Goal line (red!)
  { type: "line", x0: -RINK_X, x1: RINK_X, y0: GOAL_Z, y1: GOAL_Z, line: { width: 2, color: "#d62728" } },

  // Net posts (small black dots)
  { type: "circle", x0: POST_X_L - 0.15, x1: POST_X_L + 0.15, y0: GOAL_Z - 0.15, y1: GOAL_Z + 0.15, line: { width: 2, color: "#000" } },
  { type: "circle", x0: POST_X_R - 0.15, x1: POST_X_R + 0.15, y0: GOAL_Z - 0.15, y1: GOAL_Z + 0.15, line: { width: 2, color: "#000" } },

// Net outline (rounded rectangle: straight sides + rounded back corners)
{
  type: "path",
  path: (() => {
    const backZ = GOAL_Z + NET_DEPTH_VIS;
    const r = Math.min(NET_CORNER_R, NET_DEPTH_VIS, (POST_X_R - POST_X_L) / 2);
    // Start at left post on goal line, go back, across, then forward to right post.
    return `M ${POST_X_L},${GOAL_Z}
            L ${POST_X_L},${backZ - r}
            Q ${POST_X_L},${backZ} ${POST_X_L + r},${backZ}
            L ${POST_X_R - r},${backZ}
            Q ${POST_X_R},${backZ} ${POST_X_R},${backZ - r}
            L ${POST_X_R},${GOAL_Z}`;
  })(),
  line: { width: 2.5, color: "#000" }
}
]
  };

  Plotly.newPlot(el, data, layout, {
  displayModeBar: false,
  responsive: true
});
}

function computeThreeStars(matchRows){
  const scored = [];

  for (const r of matchRows || []){
    const sp = toNumMaybe(r.sp);
    if (sp == null) continue; // if no SP, skip (or you can set 0)

    // Simple, predictable tiebreakers
    const g  = toIntMaybe(r.g) ?? 0;
    const a  = toIntMaybe(r.a) ?? 0;
    const pts = g + a;

    const sa = toIntMaybe(r.sa) ?? null;
    const ga = toIntMaybe(r.ga) ?? null;
    const saves = (sa != null && ga != null) ? (sa - ga) : null;

    scored.push({
      team_id: String(r.team_id ?? "").trim(),
      player_name: String(r.player_name ?? "").trim(),
      sp,
      pts,
      g,
      saves: saves ?? -1
    });
  }

  scored.sort((x, y) =>
    (y.sp - x.sp) ||
    (y.pts - x.pts) ||
    (y.g - x.g) ||
    (y.saves - x.saves) ||
    x.player_name.localeCompare(y.player_name)
  );

  return scored.slice(0, 3);
}

function starGlyph(n){
  if (n === 1) return `<span class="game-star star-gold">★</span>`;
  if (n === 2) return `<span class="game-star star-silver">★</span>`;
  if (n === 3) return `<span class="game-star star-bronze">★</span>`;
  return "";
}

function setupGameNavigation({ seasonId, matchId, stage }) {
  const prevBtn = document.getElementById("prevGameBtn");
  const nextBtn = document.getElementById("nextGameBtn");
  if (!prevBtn || !nextBtn) return;

  const currentNum = parseGameNum(matchId);
  const base = seriesKey(matchId);
  const maxGames = seriesMaxGames(stage);

  const makeUrl = (num) =>
    `boxscore.html?season=${encodeURIComponent(seasonId)}&match_id=${encodeURIComponent(`${base}-G${num}`)}`;

  prevBtn.classList.remove("disabled");
  nextBtn.classList.remove("disabled");

  if (currentNum > 1) {
    prevBtn.onclick = () => location.href = makeUrl(currentNum - 1);
  } else {
    prevBtn.classList.add("disabled");
    prevBtn.onclick = null;
  }

  if (currentNum < maxGames) {
    nextBtn.onclick = () => location.href = makeUrl(currentNum + 1);
  } else {
    nextBtn.classList.add("disabled");
    nextBtn.onclick = null;
  }
}


