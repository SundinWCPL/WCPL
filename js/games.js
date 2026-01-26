// js/games.js
import { loadCSV, toIntMaybe } from "./data.js";
import { initSeasonPicker, getSeasonId, onSeasonChange } from "./season.js";

const elSeason = document.getElementById("seasonSelect");
const elStatus = document.getElementById("status");
const elTable  = document.getElementById("gamesTable");
const elTbody  = elTable.querySelector("tbody");
const elThead  = elTable.querySelector("thead");
const elStage = document.getElementById("stageSelect");
const elGameStatus = document.getElementById("gameStatus");

let teams = [];
let scheduleRows = [];
let gamesRows = [];
let teamMap = new Map();

let sortKey = "DATE";     // "date" | "week"
let sortDir = "desc";     // "asc" | "desc"
let lastGameStatus = null;

boot();

async function boot() {
  await initSeasonPicker(elSeason);
  onSeasonChange(() => refresh());
  elStage.addEventListener("change", renderSeries);
  elGameStatus.addEventListener("change", renderSeries);
// Click-to-sort on headers (Players-style)
elThead.addEventListener("click", (e) => {
  const th = e.target.closest("th");
  if (!th) return;

  const key = th.dataset.key;
  if (!key) return; // not sortable

  if (sortKey === key) {
    sortDir = (sortDir === "desc") ? "asc" : "desc";
  } else {
    sortKey = key;
    // Default direction when clicking a new column:
    // WEEK feels natural ascending; DATE feels natural descending
    sortDir = (key === "WEEK") ? "asc" : "desc";
  }

  renderSeries();
});
  await refresh();
}

async function refresh() {
  const seasonId = getSeasonId();
  if (!seasonId) {
    setLoading(true, "No season found in seasons.csv.");
    return;
  }

  setLoading(true, `Loading ${seasonId}…`);

  try {
    teams = await loadCSV(`../data/${seasonId}/teams.csv`);
    scheduleRows = await loadCSV(`../data/${seasonId}/schedule.csv`);

    try {
      gamesRows = await loadCSV(`../data/${seasonId}/games.csv`);
    } catch {
      gamesRows = [];
    }

    setLoading(false);
    renderSeries();
  } catch (err) {
    console.error(err);
    setLoading(true, `No data exists for Season ${seasonId}.`);
    elTable.hidden = true;
  }
}

function renderSeries() {
  const seasonId = getSeasonId();
  const stageMode = (elStage?.value ?? "reg");
  const gameStatus = elGameStatus?.value ?? "played";
  const includeUnplayed = (gameStatus === "all");
  if (gameStatus !== lastGameStatus) {
  // Default behavior:
  // - Completed: latest first (desc)
  // - All: schedule view (asc)
  sortKey = "DATE";
  sortDir = (gameStatus === "all") ? "asc" : "desc";
  lastGameStatus = gameStatus;
}
  document.body.classList.toggle("games-wide", stageMode === "po");
  document.body.classList.toggle("games-regular", stageMode === "reg");
  elTable.classList.toggle("show-5", stageMode === "po");
	const thWeek = document.getElementById("thWeek");
	if (thWeek) thWeek.textContent = (stageMode === "po") ? "Stage" : "Week";
	updateSortIndicators();

  if (!seasonId) return;


  // team_id -> colors (names not needed here)
  const tmap = new Map();
  for (const t of teams) {
    const id = (t.team_id ?? "").trim();
    if (!id) continue;
    tmap.set(id, {
      team_id: id,
      bg_color: (t.bg_color ?? "").trim(),
      text_color: (t.text_color ?? "").trim(),
    });
  }
    teamMap = tmap;

  // match_id -> game row
  const gameById = new Map();
  for (const g of gamesRows) {
    const matchId = (g.match_id ?? "").trim();
    if (matchId) gameById.set(matchId, g);
  }

  // Collect schedule games (reg only, hide cancelled)
  const schedGames = [];
  for (const s of scheduleRows) {
    const matchId = (s.match_id ?? "").trim();
    if (!matchId) continue;

    const stage = (s.stage ?? "").trim().toLowerCase();
    const status = (s.status ?? "").trim().toLowerCase();

    if (stageMode === "reg") {
	if (stage !== "reg") continue;
	} else {
	// Playoffs mode: include qf/sf/f
	if (stage === "reg") continue;
	}

    if (status === "cancelled") continue;

    const g = gameById.get(matchId);

    const homeId = ((s.home_team_id ?? "") || (g?.home_team_id ?? "")).trim();
    const awayId = ((s.away_team_id ?? "") || (g?.away_team_id ?? "")).trim();

    const played = status === "played" || hasValidScore(g);
	if (!includeUnplayed && !played) continue;
    const hg = played ? toIntMaybe(g?.home_goals) : null;
    const ag = played ? toIntMaybe(g?.away_goals) : null;
    const ot = played ? (toIntMaybe(g?.ot) ?? 0) : 0;

    schedGames.push({
      match_id: matchId,
      week: toIntMaybe(s.week) ?? 0,
      imported_on: (s.imported_on ?? "").trim(),
      home_team_id: homeId,
      away_team_id: awayId,
      played,
      home_goals: hg,
      away_goals: ag,
      ot,
	  stage,
    });
  }

  if (schedGames.length === 0) {
    setLoading(true, `No data exists for Season ${seasonId}.`);
    elTable.hidden = true;
    return;
  }

  // Group series by (week, home, away)
  const seriesMap = new Map();
  for (const g of schedGames) {
    const st = (g.stage ?? "reg");
	const wk = (g.week ?? 0);
	const key = `${st}||${wk}||${g.home_team_id}||${g.away_team_id}`;
    if (!seriesMap.has(key)) {
seriesMap.set(key, {
  stage: g.stage,
  week: g.week,
  home_team_id: g.home_team_id,
  away_team_id: g.away_team_id,
  games: [],
});
    }
    seriesMap.get(key).games.push(g);
  }

  // Build rows (each series -> one row)
  const rows = [];
  for (const s of seriesMap.values()) {
    // stable order for G1/G2/G3
    s.games.sort((a, b) => a.match_id.localeCompare(b.match_id));

    // show latest imported_on as the series date
    const latest = s.games
      .map(x => x.imported_on)
      .sort((a, b) => {
  const da = dateKey(a), db = dateKey(b);
  if (!Number.isFinite(da) && !Number.isFinite(db)) return 0;
  if (!Number.isFinite(da)) return 1;
  if (!Number.isFinite(db)) return -1;
  return db - da;
})[0] || "";

// Count series wins (played games only)
let homeWins = 0, awayWins = 0;

for (const g of s.games) {
  if (!g.played || g.home_goals == null || g.away_goals == null) continue;
  if (g.home_goals > g.away_goals) homeWins++;
  else if (g.away_goals > g.home_goals) awayWins++;
}

const winner_id =
  homeWins > awayWins ? s.home_team_id :
  awayWins > homeWins ? s.away_team_id :
  null;

rows.push({
  stage: s.stage,
  week: s.week,
  home_team_id: s.home_team_id,
  away_team_id: s.away_team_id,
  winner_id,
  g1: s.games[0] ?? null,
  g2: s.games[1] ?? null,
  g3: s.games[2] ?? null,
  g4: s.games[3] ?? null,
  g5: s.games[4] ?? null,
  date: latest,
});
  }

const dir = (sortDir === "asc") ? 1 : -1;

rows.sort((a, b) => {
  let cmp = 0;

  if (sortKey === "WEEK") {
    // Stage tie-breaker (so playoffs stages group nicely), then teams
    cmp = (a.week - b.week);
    if (cmp === 0) cmp = String(a.stage ?? "").localeCompare(String(b.stage ?? ""));
  } else { // "DATE"
    const ta = dateKey(a.date);
    const tb = dateKey(b.date);
    cmp = (ta - tb);
    if (cmp === 0) cmp = (a.week - b.week);
  }

  if (cmp !== 0) return cmp * dir;
  return `${a.home_team_id}||${a.away_team_id}`.localeCompare(`${b.home_team_id}||${b.away_team_id}`);
});

  // Render
  elTbody.innerHTML = "";

  for (const r of rows) {
    const tr = document.createElement("tr");

    // Week number only
    const tdWeek = document.createElement("td");
    tdWeek.textContent = stageLabel(r.stage, r.week);
	tdWeek.style.textAlign = "center";
    tr.appendChild(tdWeek);
	
	const homeOutcome = r.winner_id
  ? (r.winner_id === r.home_team_id ? "win" : "lose")
  : null;

	const awayOutcome = r.winner_id
  ? (r.winner_id === r.away_team_id ? "win" : "lose")
  : null;


	const home = tmap.get(r.home_team_id) || fallbackTeam(r.home_team_id);
	tr.appendChild(tdTeamLogoOnly(home, seasonId, homeOutcome));

	const tdVs = document.createElement("td");
	tdVs.className = "vs-cell";
	tdVs.textContent = "VS";
	tr.appendChild(tdVs);

	const away = tmap.get(r.away_team_id) || fallbackTeam(r.away_team_id);
	tr.appendChild(tdTeamLogoOnly(away, seasonId, awayOutcome));

	// Spacer column
	const tdSpacer = document.createElement("td");
	tdSpacer.className = "spacer-col";
	tr.appendChild(tdSpacer);

	tr.appendChild(tdGameResult(r.g1, seasonId));
	tr.appendChild(tdGameResult(r.g2, seasonId));
	tr.appendChild(tdGameResult(r.g3, seasonId));
	tr.appendChild(tdGameResult(r.g4, seasonId));
	tr.appendChild(tdGameResult(r.g5, seasonId));

    const tdDate = document.createElement("td");
    tdDate.textContent = formatDate(r.date);
	tdDate.style.textAlign = "center";
    tr.appendChild(tdDate);

    elTbody.appendChild(tr);
  }

  elTable.hidden = false;
}

function updateSortIndicators() {
  const ths = elThead.querySelectorAll("th[data-key]");
  ths.forEach(th => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.key === sortKey) {
      th.classList.add(sortDir === "asc" ? "sort-asc" : "sort-desc");
    }
  });
}

function tdGameResult(game, seasonId) {
  const td = document.createElement("td");
  td.className = "result-cell";
  td.style.textAlign = "center";

  if (!game) {
    td.textContent = "";
    return td;
  }

  const matchId = (game.match_id ?? "").trim();
  const href = `boxscore.html?season=${encodeURIComponent(seasonId)}&match_id=${encodeURIComponent(matchId)}`;

  // Always link (played or scheduled) so scheduled games become "Preview"
  const a = document.createElement("a");
  a.href = href;
  a.style.textDecoration = "none";
  a.style.display = "inline-block";

  // Scheduled / missing score
  if (!game.played || game.home_goals === null || game.away_goals === null) {
    const pill = document.createElement("span");
    pill.className = "result-pill";
    pill.textContent = "TBD";
    a.appendChild(pill);
    td.appendChild(a);
    return td;
  }

  const hg = game.home_goals;
  const ag = game.away_goals;

  let winScore, loseScore, winTeamId;
  if (hg > ag) {
    winScore = hg; loseScore = ag; winTeamId = game.home_team_id;
  } else if (ag > hg) {
    winScore = ag; loseScore = hg; winTeamId = game.away_team_id;
  } else {
    // Tie shouldn't happen, but handle anyway
    const pill = document.createElement("span");
    pill.className = "result-pill";
    pill.textContent = `${hg} - ${ag}`;
    a.appendChild(pill);
    td.appendChild(a);
    return td;
  }

  const ot = toIntMaybe(game.ot) ?? 0;
  let otTag = "";
  if (ot === 1) otTag = " (OT)";
  else if (ot > 1) otTag = ` (OT${ot})`;

  const pill = document.createElement("span");
  pill.className = "result-pill";

  // theme by winning team colors
  const winTeam = getTeam(winTeamId);
  if (winTeam?.bg_color) pill.style.backgroundColor = winTeam.bg_color;
  if (winTeam?.text_color) pill.style.color = winTeam.text_color;

  pill.textContent = `${winScore} - ${loseScore} ${winTeamId}${otTag}`;

  a.appendChild(pill);
  td.appendChild(a);
  return td;
}


function tdTeamLogoOnly(team, seasonId, outcome /* "win" | "lose" | null */) {
  const td = document.createElement("td");
  td.className = "logo-cell";

  const a = document.createElement("a");
  a.href = `team.html?season=${encodeURIComponent(seasonId)}&team_id=${encodeURIComponent(team.team_id)}`;
  a.style.display = "inline-block";

  // If you added the games-page badge CSS earlier, this keeps it tidy.
  // If not, it still works (just a normal div).
  const badge = document.createElement("div");
  badge.className = "logo-badge";
  if (outcome === "win") badge.classList.add("series-winner");
else if (outcome === "lose") badge.classList.add("series-loser");
  if (team.bg_color) badge.style.backgroundColor = team.bg_color;

  const img = document.createElement("img");
  img.alt = `${team.team_id} logo`;
  img.loading = "lazy";
  img.src = `../logos/${seasonId}/${team.team_id}.png`;
  img.onerror = () => (img.style.visibility = "hidden");

  badge.appendChild(img);
  a.appendChild(badge);
  td.appendChild(a);
  return td;
}

function hasValidScore(g) {
  const hg = toIntMaybe(g?.home_goals);
  const ag = toIntMaybe(g?.away_goals);
  return hg !== null && ag !== null;
}

function fallbackTeam(team_id) {
  const id = (team_id ?? "").trim();
  return { team_id: id || "UNKNOWN", bg_color: "", text_color: "" };
}

function dateKey(s) {
  const d = new Date((s ?? "").trim());
  const t = d.getTime();
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

function formatDate(s) {
  const v = (s ?? "").trim();
  if (!v) return "";
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) return v;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function setLoading(isLoading, msg = "") {
  elStatus.hidden = !isLoading;
  elStatus.textContent = msg;
  elTable.hidden = isLoading;
}

function getTeam(teamId) {
  return teamMap.get(teamId) || null;
}

function stageLabel(stage, week) {
  if (stage === "reg") return week ? String(week) : "";
  if (stage === "qf") return "QF";
  if (stage === "sf") return "SF";
  if (stage === "f")  return "F";
  return stage ? stage.toUpperCase() : "";
}