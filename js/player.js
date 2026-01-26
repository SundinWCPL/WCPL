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
const elLogoLink = document.getElementById("playerTeamLogoLink");

const skaterBody = document.querySelector("#skaterStatsTable tbody");
const goalieBody = document.querySelector("#goalieStatsTable tbody");

const elGameLogStatus = document.getElementById("gameLogStatus");
const elGameLogTable = document.getElementById("gameLogTable");
const gameLogBody = document.querySelector("#gameLogTable tbody");

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
    return r.ok;
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

    // Enable/disable playoffs option (for current season)
    const hasPlayoffsThisSeason = await urlExists(playoffPlayersPath);
    setPlayoffsOptionEnabled(hasPlayoffsThisSeason);

    // Pick current-season file based on stage selection
    const stage = elStage.value; // "REG" | "PO"
    const playersPath = (stage === "PO" && hasPlayoffsThisSeason) ? playoffPlayersPath : regularPlayersPath;

    // Load current season core data
    const [seasons, teams, players] = await Promise.all([
      loadCSV(seasonsPath),
      loadCSV(teamsPath),
      loadCSV(playersPath),
    ]);

    // adv_stats toggle (controls game log + hides adv UI)
    const seasonRow = seasons.find(s => String(s.season_id ?? "").trim() === seasonId);
    const advOn = (toIntMaybe(seasonRow?.adv_stats) ?? 0) === 1;
    document.body.classList.toggle("hide-adv", !advOn);
    renderGameLogStub(seasonId, advOn);

    // Find player in current season
    const pSeason = players.find(x => String(x.player_key ?? "").trim() === String(playerKey).trim());
    if (!pSeason) {
      renderMissingPlayer(seasonId, playerKey);
      elHero.hidden = false;
      elBody.hidden = true;
      clearStatus();
      return;
    }

    const teamId = String(pSeason.team_id ?? "").trim();
    const team = teams.find(t => String(t.team_id ?? "").trim() === teamId);

    renderHero(seasonId, pSeason, team);

    // Build career aggregates across ALL seasons (same stage as selected)
    const careerAgg = await computeCareerAgg(seasons, playerKey, stage);

    renderStats(pSeason, careerAgg, advOn);

    elHero.hidden = false;
    elBody.hidden = false;
    clearStatus();
  } catch (err) {
    console.error(err);
    setStatus(`No data exists for Season ${getSeasonId()}.`);
    elHero.hidden = true;
    elBody.hidden = true;
  }
}

/* ------------------------- career aggregation ------------------------- */

async function computeCareerAgg(seasons, playerKey, stage) {
  // For stage: REG => players.csv, PO => players_playoffs.csv (when exists)
  const seasonIds = seasons
    .map(s => String(s.season_id ?? "").trim())
    .filter(Boolean);

  const paths = await Promise.all(seasonIds.map(async sid => {
    const path = stage === "PO"
      ? `../data/${sid}/players_playoffs.csv`
      : `../data/${sid}/players.csv`;

    const ok = await urlExists(path);
    return ok ? path : null;
  }));

  const validPaths = paths.filter(Boolean);

  // Sum totals across seasons for this player_key
  const agg = {
    // Skater totals
    gp_s: 0, g: 0, a: 0, pts: 0, shots: 0,
    hits: 0, takeaways: 0, turnovers: 0,
    sp: 0,

    // Goalie totals
    gp_g: 0, sa: 0, ga: 0,
    wins: 0, so: 0,
    // (svp, gaa derived from totals)
  };

  if (validPaths.length === 0) return agg;

  const allRows = await Promise.all(validPaths.map(p => loadCSV(p)));

  for (const rows of allRows) {
    const r = rows.find(x => String(x.player_key ?? "").trim() === String(playerKey).trim());
    if (!r) continue;

    // Skater sums
    agg.gp_s += (toIntMaybe(r.gp_s) ?? 0);
    agg.g    += (toIntMaybe(r.g) ?? 0);
    agg.a    += (toIntMaybe(r.a) ?? 0);
    agg.pts  += (toIntMaybe(r.pts) ?? 0);

    const shotsRaw = (r.shots ?? "").toString().trim();
    const shotsVal = shotsRaw === "" ? null : Number(shotsRaw);
    const shots = Number.isFinite(shotsVal) ? Math.trunc(shotsVal) : null;
    agg.shots += (shots ?? 0);

    agg.hits      += (toIntMaybe(r.hits) ?? 0);
    agg.takeaways += (toIntMaybe(r.takeaways) ?? 0);
    agg.turnovers += (toIntMaybe(r.turnovers) ?? 0);

    agg.sp += (toNumMaybe(r.sp) ?? 0);

    // Goalie sums
    agg.gp_g += (toIntMaybe(r.gp_g) ?? 0);
    agg.sa   += (toIntMaybe(r.sa) ?? 0);
    agg.ga   += (toIntMaybe(r.ga) ?? 0);
    agg.wins += (toIntMaybe(r.wins) ?? 0);
    agg.so   += (toIntMaybe(r.so) ?? 0);
  }

  return agg;
}

/* ------------------------- hero ------------------------- */

function renderHero(seasonId, p, team) {
  const name = (p.name ?? "").trim() || "(Unknown)";
  const posRaw = (p.position ?? "").trim();
  const roleRaw = (p.role ?? "").trim();
  const teamId = String(p.team_id ?? "").trim();

  elName.textContent = name;

  const posLabel = normalizePosition(posRaw);

  let roleLabel = roleRaw ? roleRaw : "";
  if (roleLabel.trim().toLowerCase() === "assistant") roleLabel = "Assistant Captain";

  const teamName =
    (team?.team_name ?? "").trim() ||
    (teamId ? teamId : "Free Agent");

  const leftParts = [];
  if (posLabel) leftParts.push(posLabel);
  if (roleLabel) leftParts.push(roleLabel);

  const leftText = leftParts.join(" - ");
  const teamText = teamName;

  const teamHref = teamId
    ? `team.html?season=${encodeURIComponent(seasonId)}&team_id=${encodeURIComponent(teamId)}`
    : "";

  if (teamHref) {
    elMeta.innerHTML =
      `${escapeHtml(leftText)} - ` +
      `<a class="team-link team-link-inherit" href="${teamHref}">${escapeHtml(teamText)}</a>`;
  } else {
    elMeta.textContent = leftText ? `${leftText} - ${teamText}` : teamText;
  }

  if (teamId) {
    elLogo.src = `../logos/${seasonId}/${teamId}.png`;
    elLogo.alt = `${teamId} logo`;
    elLogo.style.visibility = "visible";
    elLogo.onerror = () => (elLogo.style.visibility = "hidden");

    if (elLogoLink) {
      elLogoLink.href = teamHref;
      elLogoLink.style.pointerEvents = "";
    }
  } else {
    elLogo.style.visibility = "hidden";
    if (elLogoLink) {
      elLogoLink.href = "#";
      elLogoLink.style.pointerEvents = "none";
    }
  }

  const bg = (team?.bg_color ?? "").trim() || "#0f1319";
  const fg = (team?.text_color ?? "").trim() || "#e7e7e7";
  document.documentElement.style.setProperty("--team-bg", bg);
  document.documentElement.style.setProperty("--team-fg", fg);

  elHero.classList.add("team-themed");

  elEmpty.hidden = true;
  elEmpty.textContent = "";
}

/* ------------------------- stats ------------------------- */

function renderStats(pSeason, career, advOn) {
  skaterBody.innerHTML = "";
  goalieBody.innerHTML = "";

  // ---------------- Skater (Season) ----------------
  const s_gp = toIntMaybe(pSeason.gp_s) ?? 0;
  const s_g  = toIntMaybe(pSeason.g) ?? 0;
  const s_a  = toIntMaybe(pSeason.a) ?? 0;
  const s_pts= toIntMaybe(pSeason.pts) ?? 0;

  const s_ppgCsv = toNumMaybe(pSeason.p_per_gp);
  const s_ppg = (s_ppgCsv != null && Number.isFinite(s_ppgCsv))
    ? s_ppgCsv
    : (s_gp > 0 ? s_pts / s_gp : null);

  const s_sp = toNumMaybe(pSeason.sp);
  const s_spgCsv = toNumMaybe(pSeason.sp_per_gp);
  const s_spg = (s_spgCsv != null && Number.isFinite(s_spgCsv))
    ? s_spgCsv
    : (s_gp > 0 && s_sp != null ? s_sp / s_gp : null);

  const s_shots = parseShots(pSeason.shots);
  const s_shp = (s_shots != null && s_shots > 0) ? (s_g / s_shots) * 100 : null;

  // ---------------- Skater (Career) ----------------
  const c_gp = career.gp_s ?? 0;
  const c_g  = career.g ?? 0;
  const c_a  = career.a ?? 0;
  const c_pts= career.pts ?? 0;
  const c_sp = career.sp ?? 0;

  const c_ppg = (c_gp > 0) ? (c_pts / c_gp) : null;
  const c_spg = (c_gp > 0) ? (c_sp / c_gp) : null;

  const c_shots = (career.shots ?? 0);
  const c_shp = (c_shots > 0) ? (c_g / c_shots) * 100 : null;

  if (s_gp > 0 || c_gp > 0) {
    addRow3(skaterBody, "GP", s_gp || "", c_gp || "");
    addRow3(skaterBody, "G", s_g || "", c_g || "");
    addRow3(skaterBody, "A", s_a || "", c_a || "");
    addRow3(skaterBody, "PTS", s_pts || "", c_pts || "");
    addRow3(skaterBody, "P/GP", fmtNum(s_ppg, 2), fmtNum(c_ppg, 2));
    addRow3(skaterBody, "Shots", (s_shots ?? ""), (c_shots || ""));
    addRow3(skaterBody, "SH%", fmtPct(s_shp, 1), fmtPct(c_shp, 1));

    if (advOn) {
      // Season values from row; career values from aggregated sums (will be 0 if not tracked)
      addRow3(skaterBody, "HIT", valOrBlank(toIntMaybe(pSeason.hits)), (career.hits ?? 0) || "");
      addRow3(skaterBody, "TA", valOrBlank(toIntMaybe(pSeason.takeaways)), (career.takeaways ?? 0) || "");
      addRow3(skaterBody, "TO", valOrBlank(toIntMaybe(pSeason.turnovers)), (career.turnovers ?? 0) || "");
    }
    addRow3(skaterBody, "SP", fmtNum(s_sp, 1), fmtNum(c_sp, 1));
    addRow3(skaterBody, "SP/GP", fmtNum(s_spg, 2), fmtNum(c_spg, 2));
  } else {
    addRow3(skaterBody, "—", "No skater stats", "");
  }

  // ---------------- Goalie (Season) ----------------
  const g_gp = toIntMaybe(pSeason.gp_g) ?? 0;
  const g_sa = toIntMaybe(pSeason.sa);
  const g_ga = toIntMaybe(pSeason.ga);
  const g_sv = (g_sa != null && g_ga != null) ? (g_sa - g_ga) : null;

  const g_svpCsv = toNumMaybe(pSeason.sv_pct); // 0-1
  const g_svp = (g_svpCsv != null && Number.isFinite(g_svpCsv))
    ? (g_svpCsv * 100)
    : (g_sa != null && g_sa > 0 && g_sv != null ? (g_sv / g_sa) * 100 : null);

  const g_gaaCsv = toNumMaybe(pSeason.gaa);
  const g_gaa = (g_gaaCsv != null && Number.isFinite(g_gaaCsv))
    ? g_gaaCsv
    : (g_gp > 0 && g_ga != null ? (g_ga / g_gp) : null);

  const g_w = toIntMaybe(pSeason.wins);
  const g_so = toIntMaybe(pSeason.so);

  const g_sp = toNumMaybe(pSeason.sp);
  const g_spgCsv = toNumMaybe(pSeason.sp_per_gp);
  const g_spg = (g_spgCsv != null && Number.isFinite(g_spgCsv))
    ? g_spgCsv
    : (g_gp > 0 && g_sp != null ? g_sp / g_gp : null);

  // ---------------- Goalie (Career) ----------------
  const cg_gp = career.gp_g ?? 0;
  const cg_sa = career.sa ?? 0;
  const cg_ga = career.ga ?? 0;
  const cg_sv = (cg_sa > 0) ? (cg_sa - cg_ga) : null;

  const cg_svp = (cg_sa > 0 && cg_sv != null) ? (cg_sv / cg_sa) * 100 : null;
  const cg_gaa = (cg_gp > 0) ? (cg_ga / cg_gp) : null;

  const cg_w = career.wins ?? 0;
  const cg_so = career.so ?? 0;

  // SP career is shared; SP/GP for goalie uses goalie GP
  const cg_sp = career.sp ?? 0;
  const cg_spg = (cg_gp > 0) ? (cg_sp / cg_gp) : null;

  if (g_gp > 0 || cg_gp > 0) {
    addRow3(goalieBody, "GP", g_gp || "", cg_gp || "");
    addRow3(goalieBody, "SA", valOrBlank(g_sa), cg_sa || "");
    addRow3(goalieBody, "GA", valOrBlank(g_ga), cg_ga || "");
    addRow3(goalieBody, "Sv", valOrBlank(g_sv), valOrBlank(cg_sv));

    addRow3(goalieBody, "SV%", fmtPct(g_svp, 1), fmtPct(cg_svp, 1));
    addRow3(goalieBody, "GAA", fmtNum(g_gaa, 2), fmtNum(cg_gaa, 2));

    addRow3(goalieBody, "W", valOrBlank(g_w), cg_w || "");
    addRow3(goalieBody, "SO", valOrBlank(g_so), cg_so || "");

    addRow3(goalieBody, "SP", fmtNum(g_sp, 1), fmtNum(cg_sp, 1));
    addRow3(goalieBody, "SP/GP", fmtNum(g_spg, 2), fmtNum(cg_spg, 2));
  } else {
    addRow3(goalieBody, "—", "No goalie stats", "");
  }
}

function parseShots(v) {
  const raw = (v ?? "").toString().trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function addRow3(tbody, label, seasonVal, careerVal) {
  const tr = document.createElement("tr");

  const td1 = document.createElement("td");
  td1.textContent = label;

  const td2 = document.createElement("td");
  td2.className = "num";
  td2.textContent = String(seasonVal ?? "");

  const td3 = document.createElement("td");
  td3.className = "num";
  td3.textContent = String(careerVal ?? "");

  tr.appendChild(td1);
  tr.appendChild(td2);
  tr.appendChild(td3);
  tbody.appendChild(tr);
}

function valOrBlank(v) {
  return (v === null || v === undefined || v === "") ? "" : v;
}

function fmtNum(v, decimals) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return n.toFixed(decimals);
}

function fmtPct(v, decimals) {
  if (v === null || v === undefined || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return `${n.toFixed(decimals)}%`;
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
  if (s === "S") return "Skater";
  if (s === "G") return "Goalie";
  if (s === "S/G" || s === "G/S") return "Skater/Goalie";
  if (s === "SKATER") return "Skater";
  if (s === "GOALIE") return "Goalie";
  return s ? s : "";
}

function renderGameLogStub(seasonId, advOn) {
  gameLogBody.innerHTML = "";

  if (!advOn) {
    elGameLogTable.hidden = true;
    elGameLogStatus.hidden = false;
    elGameLogStatus.textContent = `No stats for Season ${seasonId}.`;
    return;
  }

  elGameLogTable.hidden = true;
  elGameLogStatus.hidden = false;
  elGameLogStatus.textContent = `Game log not available yet for Season ${seasonId}.`;
}
