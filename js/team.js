// js/team.js
import { loadCSV, toIntMaybe, toNumMaybe } from "./data.js";
import { initSeasonPicker, getSeasonId, onSeasonChange } from "./season.js";

const elSeason = document.getElementById("seasonSelect");
const elStatus = document.getElementById("status");
const elStage = document.getElementById("stageSelect");

const elHero = document.getElementById("teamHero");
const elLogo = document.getElementById("teamLogo");
const elName = document.getElementById("teamName");
const elMeta = document.getElementById("teamMeta");

const skatersBody = document.querySelector("#skatersTable tbody");
const goaliesBody = document.querySelector("#goaliesTable tbody");
const matchesBody = document.querySelector("#matchesTable tbody");

const elTeamEmpty = document.getElementById("teamEmpty");
const elTeamBody = document.getElementById("teamBody");


boot();

async function boot() {
  await initSeasonPicker(elSeason);
  onSeasonChange(() => refresh());
  elStage.addEventListener("change", () => refresh());
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

	// Decide which players file to load
	const stage = elStage.value; // "REG" | "PO"
	const playersPath = (stage === "PO" && hasPlayoffs)
	? playoffPlayersPath
	: regularPlayersPath;

    const gamesPath = `../data/${seasonId}/games.csv`;
    const schedPath = `../data/${seasonId}/schedule.csv`;

const seasonsPath = `../data/seasons.csv`;

const [seasons, teams, players, games, schedule] = await Promise.all([
  loadCSV(seasonsPath),
  loadCSV(teamsPath),
  loadCSV(playersPath),
  loadCSV(gamesPath),
  loadCSV(schedPath),
]);

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
    renderRoster(roster, advOn);

    // Render match history
    renderMatches(teamId, teams, teamGames);

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
}

/* ------------------------- Roster ------------------------- */

function renderRoster(roster, advOn) {
  // Skaters: gp_s > 0
  const skaters = roster
    .filter(p => (toIntMaybe(p.gp_s) ?? 0) > 0)
    .map(p => {
      const g = toIntMaybe(p.g) ?? 0;

      const shotsRaw = (p.shots ?? "").toString().trim();
      const shotsVal = shotsRaw === "" ? null : Number(shotsRaw);
      const shots = Number.isFinite(shotsVal) ? shotsVal : null;

      const shp = (shots !== null && shots > 0) ? (g / shots) * 100 : null;

      return {
        name: p.name ?? "",
        pos: p.position ?? "",
        gp: toIntMaybe(p.gp_s) ?? 0,
        g,
        a: toIntMaybe(p.a) ?? 0,
        pts: toIntMaybe(p.pts) ?? 0,
        ppg: toNumMaybe(p.p_per_gp),
        shots: (shots !== null ? Math.trunc(shots) : null),
        shp,
        hits: toIntMaybe(p.hits),
        ta: toIntMaybe(p.takeaways),
        to: toIntMaybe(p.turnovers),
		player_key: p.player_key ?? "",
      };
    })
    .sort((a, b) => (b.pts - a.pts) || (b.g - a.g) || a.name.localeCompare(b.name));

  // Goalies: gp_g > 0 (S/G can appear here too)
  const goalies = roster
    .filter(p => (toIntMaybe(p.gp_g) ?? 0) > 0)
    .map(p => ({
      name: p.name ?? "",
      pos: p.position ?? "",
      gp: toIntMaybe(p.gp_g) ?? 0,
      sa: toIntMaybe(p.sa),
      ga: toIntMaybe(p.ga),
      svp: toNumMaybe(p.sv_pct),
      gaa: toNumMaybe(p.gaa),
      w: toIntMaybe(p.wins),
      so: toIntMaybe(p.so),
	  player_key: p.player_key ?? "",
    }))
    .sort((a, b) => (b.w ?? 0) - (a.w ?? 0) || (b.gp - a.gp) || a.name.localeCompare(b.name));

  // Render skaters (ONCE)
  skatersBody.innerHTML = "";
  for (const p of skaters) {
    const tr = document.createElement("tr");
    tr.appendChild(tdLinkPlayer(p.name, p.player_key));
    tr.appendChild(td(p.pos));
    tr.appendChild(tdNum(p.gp));
    tr.appendChild(tdNum(p.g));
    tr.appendChild(tdNum(p.a));
    tr.appendChild(tdNum(p.pts));
    tr.appendChild(tdNumMaybe(p.ppg, 2));
    tr.appendChild(tdNumMaybe(p.shots));
    tr.appendChild(tdPctMaybe(p.shp, 1)); // 16.4%

    // Advanced columns (hidden when adv_stats=0)
    tr.appendChild(tdNumMaybe(p.hits, null, true));
    tr.appendChild(tdNumMaybe(p.ta, null, true));
    tr.appendChild(tdNumMaybe(p.to, null, true));

    skatersBody.appendChild(tr);
  }

  // Render goalies
  goaliesBody.innerHTML = "";
  for (const g of goalies) {
    const tr = document.createElement("tr");
    tr.appendChild(tdLinkPlayer(g.name, g.player_key));
    tr.appendChild(td(g.pos));
    tr.appendChild(tdNum(g.gp));
    tr.appendChild(tdNumMaybe(g.sa));
    tr.appendChild(tdNumMaybe(g.ga));
    tr.appendChild(tdPctMaybe(g.svp !== null ? g.svp * 100 : null, 1));
    tr.appendChild(tdNumMaybe(g.gaa, 2));
    tr.appendChild(tdNumMaybe(g.w));
    tr.appendChild(tdNumMaybe(g.so));
    goaliesBody.appendChild(tr);
  }
}

/* ------------------------- Matches ------------------------- */

function renderMatches(teamId, teams, teamGames) {
  const teamById = new Map(teams.map(t => [String(t.team_id).trim(), t]));

  // Sort by imported_on desc if present, else week desc, else match_id desc
  const rows = teamGames
    .map(({ g, s }) => ({ g, s }))
    .sort((a, b) => {
      const aImp = (a.s?.imported_on ?? "").trim();
      const bImp = (b.s?.imported_on ?? "").trim();
      if (aImp && bImp) return bImp.localeCompare(aImp);
      const aw = toIntMaybe(a.s?.week) ?? -1;
      const bw = toIntMaybe(b.s?.week) ?? -1;
      if (aw !== bw) return bw - aw;
      return String(b.g.match_id ?? "").localeCompare(String(a.g.match_id ?? ""));
    });

  matchesBody.innerHTML = "";

  for (const { g, s } of rows) {
    const homeId = String(g.home_team_id).trim();
    const awayId = String(g.away_team_id).trim();
    const isHome = homeId === teamId;

    const oppId = isHome ? awayId : homeId;
    const oppTeam = teamById.get(oppId);
    const oppName = (oppTeam?.team_name ?? oppId).trim() || oppId;

    const hg = toIntMaybe(g.home_goals);
    const ag = toIntMaybe(g.away_goals);
    const ot = toIntMaybe(g.ot) ?? 0;

    if (hg === null || ag === null) continue; // defensive

    const teamGoals = isHome ? hg : ag;
    const oppGoals = isHome ? ag : hg;

    const result = resultLabel(teamGoals, oppGoals, ot);
    const stage = String(s?.stage ?? "").trim().toLowerCase();
	const wk = toIntMaybe(s?.week);

	const stageLabel = stageToLabel(stage, wk);
    const when = formatImportedOn(s?.imported_on);

    const tr = document.createElement("tr");
    tr.appendChild(td(stageLabel));
    tr.appendChild(tdOpponent(oppId, oppName));
    tr.appendChild(td(when));
    tr.appendChild(tdNum(`${teamGoals}-${oppGoals}`));
    tr.appendChild(tdResult(result));
    matchesBody.appendChild(tr);
  }
}

function tdOpponent(oppId, oppName) {
  const td = document.createElement("td");
  td.className = "opponent-cell";

  const wrap = document.createElement("div");
  wrap.className = "opponent-wrap";

  const img = document.createElement("img");
  img.className = "opponent-logo";
  img.alt = `${oppName} logo`;
  img.loading = "lazy";
  img.src = `../logos/${getSeasonId()}/${oppId}.png`;
  img.onerror = () => (img.style.visibility = "hidden");

  const span = document.createElement("span");
  span.textContent = oppName;

  wrap.appendChild(img);
  wrap.appendChild(span);
  td.appendChild(wrap);
  return td;
}

function tdResult(label) {
  const td = document.createElement("td");
  const pill = document.createElement("span");
  pill.className = `pill pill-${label.toLowerCase()}`;
  pill.textContent = label;
  td.appendChild(pill);
  return td;
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
      W += 1;
      if (isOT) { OTW += 1; PTS += 2; }
      else { PTS += 3; }
    } else {
      // loss
      if (isOT) { OTL += 1; PTS += 1; }
      else { L += 1; }
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

  // Clear tables
  skatersBody.innerHTML = "";
  goaliesBody.innerHTML = "";
  matchesBody.innerHTML = "";

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
