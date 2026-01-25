import { loadCSV, toIntMaybe, toNumMaybe } from "./data.js";
import { initSeasonPicker, getSeasonId, onSeasonChange } from "./season.js";

const elSeason = document.getElementById("seasonSelect");
const elStatus = document.getElementById("status");
const elStage = document.getElementById("stageSelect");

const elHero = document.getElementById("playerHero");
const elBody = document.getElementById("playerBody");


const elLogo = document.getElementById("playerTeamLogo");
const elName = document.getElementById("playerName");
const elMeta = document.getElementById("playerMeta");
const elEmpty = document.getElementById("playerEmpty");

const skaterBody = document.querySelector("#skaterStatsTable tbody");
const goalieBody = document.querySelector("#goalieStatsTable tbody");

const elGameLogStatus = document.getElementById("gameLogStatus");
const elGameLogTable = document.getElementById("gameLogTable");
const gameLogBody = document.querySelector("#gameLogTable tbody");
const elLogoLink = document.getElementById("playerTeamLogoLink");


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
  const playerKey = getUrlParam("player_key");

  if (!playerKey) {
    setStatus("Missing player_key in URL. Example: player.html?season=S1&player_key=ABC123");
    elHero.hidden = true;
    elBody.hidden = true;
    return;
  }

  setStatus(`Loading ${seasonId} / ${playerKey}…`);

  try {
    const seasonsPath = `../data/seasons.csv`;
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


    const [seasons, teams, players] = await Promise.all([
      loadCSV(seasonsPath),
      loadCSV(teamsPath),
      loadCSV(playersPath),
    ]);

    // adv_stats toggle (same pattern as team/players)
    const seasonRow = seasons.find(s => String(s.season_id ?? "").trim() === seasonId);
    const advOn = (toIntMaybe(seasonRow?.adv_stats) ?? 0) === 1;
	renderGameLogStub(seasonId, advOn);
    document.body.classList.toggle("hide-adv", !advOn);

    const p = players.find(x => String(x.player_key ?? "").trim() === String(playerKey).trim());
    if (!p) {
      renderMissingPlayer(seasonId, playerKey);
      elHero.hidden = false;
      elBody.hidden = true;
      clearStatus();
      return;
    }

    const teamId = String(p.team_id ?? "").trim();
    const team = teams.find(t => String(t.team_id ?? "").trim() === teamId);

    renderHero(seasonId, p, team);
    renderStats(p, advOn);

    elHero.hidden = false;
    elBody.hidden = false;
    clearStatus();
  } catch (err) {
    console.error(err);
    setStatus(`No data exists for Season ${seasonId}.`);
    elHero.hidden = true;
    elBody.hidden = true;
  }
}

/* ------------------------- hero ------------------------- */

function renderHero(seasonId, p, team) {
  const name = (p.name ?? "").trim() || "(Unknown)";
  const posRaw = (p.position ?? "").trim();
  const roleRaw = (p.role ?? "").trim();
  const teamId = String(p.team_id ?? "").trim();

  elName.textContent = name;

  // Normalize position display
  const posLabel = normalizePosition(posRaw);

  // Normalize role display
  let roleLabel = roleRaw ? roleRaw : "";
  if (roleLabel.trim().toLowerCase() === "assistant") roleLabel = "Assistant Captain";

  // Resolve team display name (full name if possible, else teamId, else Free Agent)
  const teamName =
    (team?.team_name ?? "").trim() ||
    (teamId ? teamId : "Free Agent");

  // Build "Position - Role - TeamName" (role optional)
  const leftParts = [];
  if (posLabel) leftParts.push(posLabel);
  if (roleLabel) leftParts.push(roleLabel);

  const leftText = leftParts.join(" - ");
  const teamText = teamName;

  // Team page href (only if we actually have a teamId)
  const teamHref = teamId
    ? `team.html?season=${encodeURIComponent(seasonId)}&team_id=${encodeURIComponent(teamId)}`
    : "";

  // Make team name in meta clickable when possible
  if (teamHref) {
    elMeta.innerHTML =
	`${escapeHtml(leftText)} - ` +
	`<a class="team-link team-link-inherit" href="${teamHref}">${escapeHtml(teamText)}</a>`;
  } else {
    // Free Agent (or missing team): plain text
    elMeta.textContent = leftText ? `${leftText} - ${teamText}` : teamText;
  }

  // Team logo in hero (and make it a link if possible)
  // NOTE: requires HTML:
  // <a id="playerTeamLogoLink" href="#"><img id="playerTeamLogo" ...></a>
  if (teamId) {
    elLogo.src = `../logos/${seasonId}/${teamId}.png`;
    elLogo.alt = `${teamId} logo`;
    elLogo.style.visibility = "visible";
    elLogo.onerror = () => (elLogo.style.visibility = "hidden");

    if (typeof elLogoLink !== "undefined" && elLogoLink) {
      elLogoLink.href = teamHref;
      elLogoLink.style.pointerEvents = "";
    }
  } else {
    elLogo.style.visibility = "hidden";
    if (typeof elLogoLink !== "undefined" && elLogoLink) {
      elLogoLink.href = "#";
      elLogoLink.style.pointerEvents = "none";
    }
  }

  // Theme by team colors when possible
  const bg = (team?.bg_color ?? "").trim() || "#0f1319";
  const fg = (team?.text_color ?? "").trim() || "#e7e7e7";
  document.documentElement.style.setProperty("--team-bg", bg);
  document.documentElement.style.setProperty("--team-fg", fg);

  elHero.classList.add("team-themed");

  // clear empty state
  elEmpty.hidden = true;
  elEmpty.textContent = "";
}

/* ------------------------- stats ------------------------- */

function renderStats(p, advOn) {
  skaterBody.innerHTML = "";
  goalieBody.innerHTML = "";

  // Skater
  const gpS = toIntMaybe(p.gp_s) ?? 0;
  const g = toIntMaybe(p.g) ?? 0;
  const a = toIntMaybe(p.a) ?? 0;
  const pts = toIntMaybe(p.pts) ?? 0;
  const ppg = toNumMaybe(p.p_per_gp);

  const shotsRaw = (p.shots ?? "").toString().trim();
  const shotsVal = shotsRaw === "" ? null : Number(shotsRaw);
  const shots = Number.isFinite(shotsVal) ? Math.trunc(shotsVal) : null;
  const shp = (shots !== null && shots > 0) ? (g / shots) * 100 : null;

  if (gpS > 0) {
    addRow(skaterBody, "GP", gpS);
    addRow(skaterBody, "G", g);
    addRow(skaterBody, "A", a);
    addRow(skaterBody, "PTS", pts);
    addRow(skaterBody, "P/GP", ppg !== null ? ppg.toFixed(2) : "");
    addRow(skaterBody, "Shots", shots ?? "");
    addRow(skaterBody, "SH%", shp !== null ? `${shp.toFixed(1)}%` : "");

    // Advanced (only meaningful if your season has them)
    if (advOn) {
      addRow(skaterBody, "HIT", toIntMaybe(p.hits) ?? "");
      addRow(skaterBody, "TA", toIntMaybe(p.takeaways) ?? "");
      addRow(skaterBody, "TO", toIntMaybe(p.turnovers) ?? "");
    }
  } else {
    addRow(skaterBody, "—", "No skater stats this season");
  }

  // Goalie
  const gpG = toIntMaybe(p.gp_g) ?? 0;
  const sa = toIntMaybe(p.sa);
  const ga = toIntMaybe(p.ga);
  const svp = toNumMaybe(p.sv_pct); // 0-1
  const gaa = toNumMaybe(p.gaa);
  const w = toIntMaybe(p.wins);
  const so = toIntMaybe(p.so);

  if (gpG > 0) {
    addRow(goalieBody, "GP", gpG);
    addRow(goalieBody, "SA", sa ?? "");
    addRow(goalieBody, "GA", ga ?? "");
    addRow(goalieBody, "SV%", svp !== null ? `${(svp * 100).toFixed(1)}%` : "");
    addRow(goalieBody, "GAA", gaa !== null ? gaa.toFixed(2) : "");
    addRow(goalieBody, "W", w ?? "");
    addRow(goalieBody, "SO", so ?? "");
  } else {
    addRow(goalieBody, "—", "No goalie stats this season");
  }
}

function addRow(tbody, label, value) {
  const tr = document.createElement("tr");
  const td1 = document.createElement("td");
  td1.textContent = label;
  const td2 = document.createElement("td");
  td2.className = "num";
  td2.textContent = String(value ?? "");
  tr.appendChild(td1);
  tr.appendChild(td2);
  tbody.appendChild(tr);
}

/* ------------------------- missing player state ------------------------- */

function renderMissingPlayer(seasonId, playerKey) {
  elName.textContent = playerKey;
  elMeta.textContent = "";

  elLogo.style.visibility = "hidden";

  // reset theme
  document.documentElement.style.setProperty("--team-bg", "#0f1319");
  document.documentElement.style.setProperty("--team-fg", "#e7e7e7");
  elHero.classList.add("team-themed");

  skaterBody.innerHTML = "";
  goalieBody.innerHTML = "";

  elEmpty.hidden = false;
  elEmpty.innerHTML = `
    <div>No player data for ${escapeHtml(playerKey)} in Season ${escapeHtml(seasonId)}.</div>
    <div style="margin-top:6px;">
      <a class="team-link" href="players.html?season=${encodeURIComponent(seasonId)}">Back to Players (Season ${escapeHtml(seasonId)})</a>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ------------------------- status + url helpers ------------------------- */

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

function normalizePosition(posRaw) {
  const s = String(posRaw ?? "").trim().toUpperCase();

  // Your rule set:
  // S = Skater
  // G = Goalie
  // S/G = Skater/Goalie
  if (s === "S") return "Skater";
  if (s === "G") return "Goalie";
  if (s === "S/G" || s === "G/S") return "Skater/Goalie";

  // If future seasons store full words already, pass them through cleanly
  if (s === "SKATER") return "Skater";
  if (s === "GOALIE") return "Goalie";

  return s ? s : "";
}

function renderGameLogStub(seasonId, advOn) {
  // clear table
  gameLogBody.innerHTML = "";

  if (!advOn) {
    // Season does not track advanced stats / game log data
    elGameLogTable.hidden = true;
    elGameLogStatus.hidden = false;
    elGameLogStatus.textContent = `No stats for Season ${seasonId}.`;
    return;
  }

  // Adv is on, but we haven't wired actual per-game player stats yet
  elGameLogTable.hidden = true;
  elGameLogStatus.hidden = false;
  elGameLogStatus.textContent = `Game log not available yet for Season ${seasonId}.`;
}

