// js/games.js
import { loadCSV, toIntMaybe } from "./data.js";
import { initSeasonPicker, getSeasonId, onSeasonChange } from "./season.js";

const elSeason = document.getElementById("seasonSelect");
const elStatus = document.getElementById("status");
const elTable  = document.getElementById("gamesTable");
const elTbody  = elTable.querySelector("tbody");

let teams = [];
let scheduleRows = [];
let gamesRows = [];
let teamMap = new Map();


boot();

async function boot() {
  await initSeasonPicker(elSeason);
  onSeasonChange(() => refresh());
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
	teamMap = tmap;
  }

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

    if (stage !== "reg") continue;
    if (status === "cancelled") continue;

    const g = gameById.get(matchId);

    const homeId = ((s.home_team_id ?? "") || (g?.home_team_id ?? "")).trim();
    const awayId = ((s.away_team_id ?? "") || (g?.away_team_id ?? "")).trim();

    const played = status === "played" || hasValidScore(g);
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
    const key = `${g.week}||${g.home_team_id}||${g.away_team_id}`;
    if (!seriesMap.has(key)) {
      seriesMap.set(key, {
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
      .sort((a, b) => dateKey(b) - dateKey(a))[0] || "";

    rows.push({
      week: s.week,
      home_team_id: s.home_team_id,
      away_team_id: s.away_team_id,
      g1: s.games[0] ?? null,
      g2: s.games[1] ?? null,
      g3: s.games[2] ?? null,
      date: latest,
    });
  }

  // Sort oldest -> newest
  rows.sort((a, b) => {
    const ta = dateKey(a.date);
    const tb = dateKey(b.date);
    if (ta !== tb) return ta - tb;
    return (a.week - b.week) || `${a.home_team_id}||${a.away_team_id}`.localeCompare(`${b.home_team_id}||${b.away_team_id}`);
  });

  // Render
  elTbody.innerHTML = "";

  for (const r of rows) {
    const tr = document.createElement("tr");

    // Week number only
    const tdWeek = document.createElement("td");
    tdWeek.textContent = r.week ? String(r.week) : "";
	tdWeek.style.textAlign = "center";
    tr.appendChild(tdWeek);

    const home = tmap.get(r.home_team_id) || fallbackTeam(r.home_team_id);
    tr.appendChild(tdTeamLogoOnly(home, seasonId));

    const tdVs = document.createElement("td");
    tdVs.className = "vs-cell";
    tdVs.textContent = "VS";
    tr.appendChild(tdVs);

    const away = tmap.get(r.away_team_id) || fallbackTeam(r.away_team_id);
    tr.appendChild(tdTeamLogoOnly(away, seasonId));
	
	// Spacer column
	const tdSpacer = document.createElement("td");
	tdSpacer.className = "spacer-col";
	tr.appendChild(tdSpacer);

    tr.appendChild(tdGameResult(r.g1));
    tr.appendChild(tdGameResult(r.g2));
    tr.appendChild(tdGameResult(r.g3));

    const tdDate = document.createElement("td");
    tdDate.textContent = formatDate(r.date);
	tdDate.style.textAlign = "center";
    tr.appendChild(tdDate);

    elTbody.appendChild(tr);
  }

  elTable.hidden = false;
}

function tdGameResult(game) {
  const td = document.createElement("td");
  td.className = "result-cell";
  td.style.textAlign = "center";

  if (!game) {
    td.textContent = "";
    return td;
  }

  if (!game.played || game.home_goals === null || game.away_goals === null) {
    td.textContent = "TBD";
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
    td.textContent = `${hg} - ${ag}`;
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
td.appendChild(pill);
return td;

}

function tdTeamLogoOnly(team, seasonId) {
  const td = document.createElement("td");
  td.className = "logo-cell logo-cell--flex";

  const a = document.createElement("a");
  a.href = `team.html?season=${encodeURIComponent(seasonId)}&team_id=${encodeURIComponent(team.team_id)}`;
  a.style.display = "inline-block";

  // If you added the games-page badge CSS earlier, this keeps it tidy.
  // If not, it still works (just a normal div).
  const badge = document.createElement("div");
  badge.className = "logo-badge";
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
