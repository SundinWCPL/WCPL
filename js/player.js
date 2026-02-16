import { loadCSV, toIntMaybe, toNumMaybe } from "./data.js";
import { initSeasonPicker, getSeasonId, onSeasonChange, saveStage, playoffsHaveBegun, applyDefaultStage } from "./season.js";

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

const elRateMode = document.getElementById("rateMode");

const elPerfChart = document.getElementById("perfChart");

boot();

async function boot() {
await initSeasonPicker(elSeason);
onSeasonChange(() => refresh());

if (elStage) {
  elStage.addEventListener("change", () => {
    saveStage(elStage.value, getSeasonId());
    refresh();
  });
}

if (elRateMode) {
  elRateMode.addEventListener("change", () => refresh());
}

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
  if (!elStage) return;

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
const schedPath = `../data/${seasonId}/schedule.csv`;
const schedule = await loadCSV(schedPath).catch(() => []);

let playoffsBegun = false;
try { playoffsBegun = playoffsHaveBegun(schedule); } catch { playoffsBegun = false; }
let stage = "REG";

if (elStage) {
  applyDefaultStage(elStage, seasonId, {
    playoffsEnabled: hasPlayoffsThisSeason,
    playoffsBegun
  });
  stage = elStage.value; // "REG" | "PO"
}

const playersPath = (stage === "PO" && hasPlayoffsThisSeason)
  ? playoffPlayersPath
  : regularPlayersPath;

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
	
	    await renderGameLog(seasonId, advOn, stage, teams, schedule, pSeason);

    elHero.hidden = false;
    elBody.hidden = false;
    clearStatus();
} catch (err) {
  console.error(err);
  const msg = (err && err.message) ? err.message : String(err);
  setStatus(`Player page error: ${msg}`);
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
	toi_s: 0, // skater TOI (seconds)
	passes: 0, exits: 0, entries: 0,
	xG: 0, xGA: 0,

    // Goalie totals
    gp_g: 0, sa: 0, ga: 0,
    wins: 0, so: 0,
	toi_g: 0, // goalie TOI (seconds)
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
	agg.passes  += (toIntMaybe(r.passes) ?? 0);
	agg.exits   += (toIntMaybe(r.exits) ?? 0);
	agg.entries += (toIntMaybe(r.entries) ?? 0);

	agg.xG  += (toNumMaybe(r.xG) ?? 0);
	agg.xGA += (toNumMaybe(r.xGA) ?? 0);


// ---- TOI (role-aware, supports S/G in same season) ----
const gpS = (toIntMaybe(r.gp_s) ?? 0);
const gpG = (toIntMaybe(r.gp_g) ?? 0);

const toiS = (toIntMaybe(r.toi_s) ?? 0);
const toiG = (toIntMaybe(r.toi_g) ?? 0);

// Legacy fallback (older seasons)
const toiLegacy = (toIntMaybe(r.toi) ?? 0);

// If no TOI exists (Season 1), assume 900 seconds per GP
const assumedS = gpS * 900;
const assumedG = gpG * 900;

if (gpS > 0) agg.toi_s += (toiS > 0 ? toiS : (toiLegacy > 0 ? toiLegacy : assumedS));
if (gpG > 0) agg.toi_g += (toiG > 0 ? toiG : (toiLegacy > 0 ? toiLegacy : assumedG));

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

  // View toggle
  const rateMode = (typeof elRateMode !== "undefined" && elRateMode?.value) ? elRateMode.value : "TOTAL";
  const wantsPer15 = (rateMode === "P15");
  const isPer15 = wantsPer15 && advOn; // if adv is off, don't attempt per/15

  // Update table headers
  const sHdr = isPer15 ? "Season /15" : "Season Total";
  const cHdr = isPer15 ? "Career /15" : "Career Total";

  const skaterThead = document.querySelector("#skaterStatsTable thead");
  const goalieThead = document.querySelector("#goalieStatsTable thead");

  if (skaterThead) {
    skaterThead.innerHTML = `
      <tr>
        <th class="left">Stat</th>
        <th class="num">${sHdr}</th>
        <th class="num">${cHdr}</th>
      </tr>
    `;
  }
  if (goalieThead) {
    goalieThead.innerHTML = `
      <tr>
        <th class="left">Stat</th>
        <th class="num">${sHdr}</th>
        <th class="num">${cHdr}</th>
      </tr>
    `;
  }

  // Career per/15 helper (uses aggregated TOI seconds)
  function per15FromCareer(total, toiSeconds) {
    if (!isPer15) return total;
    const t = toNumMaybe(total);
    const toi = toNumMaybe(toiSeconds);
    if (t == null || toi == null || toi <= 0) return null;
    return t * 900 / toi;
  }

  /* ---------------- Skater (Season) ---------------- */
  const s_gp  = toIntMaybe(pSeason.gp_s) ?? 0;
  const s_g   = toIntMaybe(pSeason.g) ?? 0;
  const s_a   = toIntMaybe(pSeason.a) ?? 0;
  const s_pts = toIntMaybe(pSeason.pts) ?? 0;

  const s_shots = parseShots(pSeason.shots);
  const s_shp = (s_shots != null && s_shots > 0) ? (s_g / s_shots) * 100 : null;

  const s_passes  = toIntMaybe(pSeason.passes);
  const s_entries = toIntMaybe(pSeason.entries);
  const s_exits   = toIntMaybe(pSeason.exits);

  const s_ta   = toIntMaybe(pSeason.takeaways);
  const s_to   = toIntMaybe(pSeason.turnovers);
  const s_hits = toIntMaybe(pSeason.hits);

  const s_xg = toNumMaybe(pSeason.xG);
  const s_gfax = (s_xg != null) ? (s_g - s_xg) : null;

  const s_sp = toNumMaybe(pSeason.sp);

  /* ---------------- Skater (Career) ---------------- */
  const c_gp   = career.gp_s ?? 0;
  const c_g    = career.g ?? 0;
  const c_a    = career.a ?? 0;
  const c_pts  = career.pts ?? 0;
  const c_sp   = career.sp ?? 0;

  const c_shots = (career.shots ?? 0);
  const c_shp = (c_shots > 0) ? (c_g / c_shots) * 100 : null;

  const c_passes  = career.passes ?? 0;
  const c_entries = career.entries ?? 0;
  const c_exits   = career.exits ?? 0;

  const c_ta   = career.takeaways ?? 0;
  const c_to   = career.turnovers ?? 0;
  const c_hits = career.hits ?? 0;

  const c_xg = (career.xG ?? null);
  const c_gfax = (c_xg != null) ? (c_g - c_xg) : null;

  const c_toi_s = career.toi_s ?? 0;

  // Display values (season uses perGpNormalized; career uses TOI sums)
  const sG      = isPer15 ? perGpNormalized(s_g,      pSeason, "SKATER", advOn) : s_g;
  const sA      = isPer15 ? perGpNormalized(s_a,      pSeason, "SKATER", advOn) : s_a;
  const sPTS    = isPer15 ? perGpNormalized(s_pts,    pSeason, "SKATER", advOn) : s_pts;
  const sShots  = isPer15 ? perGpNormalized(s_shots,  pSeason, "SKATER", advOn) : s_shots;
  const sPasses = isPer15 ? perGpNormalized(s_passes, pSeason, "SKATER", advOn) : s_passes;
  const sTA     = isPer15 ? perGpNormalized(s_ta,     pSeason, "SKATER", advOn) : s_ta;
  const sTO     = isPer15 ? perGpNormalized(s_to,     pSeason, "SKATER", advOn) : s_to;
  const sEnt    = isPer15 ? perGpNormalized(s_entries,pSeason, "SKATER", advOn) : s_entries;
  const sEx     = isPer15 ? perGpNormalized(s_exits,  pSeason, "SKATER", advOn) : s_exits;
  const sHit    = isPer15 ? perGpNormalized(s_hits,   pSeason, "SKATER", advOn) : s_hits;
  const sXG     = isPer15 ? perGpNormalized(s_xg,     pSeason, "SKATER", advOn) : s_xg;
  const sGFAx   = isPer15 ? perGpNormalized(s_gfax,   pSeason, "SKATER", advOn) : s_gfax;
  const sSP     = isPer15 ? perGpNormalized(s_sp,     pSeason, "SKATER", advOn) : s_sp;

  const cG      = per15FromCareer(c_g,      c_toi_s);
  const cA      = per15FromCareer(c_a,      c_toi_s);
  const cPTS    = per15FromCareer(c_pts,    c_toi_s);
  const cShotsD = per15FromCareer(c_shots,  c_toi_s);
  const cPassD  = per15FromCareer(c_passes, c_toi_s);
  const cTAD    = per15FromCareer(c_ta,     c_toi_s);
  const cTOD    = per15FromCareer(c_to,     c_toi_s);
  const cEntD   = per15FromCareer(c_entries,c_toi_s);
  const cExD    = per15FromCareer(c_exits,  c_toi_s);
  const cHitD   = per15FromCareer(c_hits,   c_toi_s);
  const cXGD    = per15FromCareer(c_xg,     c_toi_s);
  const cGFAxD  = per15FromCareer(c_gfax,   c_toi_s);
  const cSPD    = per15FromCareer(c_sp,     c_toi_s);

  // Render Skater table (final order)
  if (s_gp > 0 || c_gp > 0) {
    addRow3(skaterBody, "GP", s_gp || "", c_gp || "");
    addRow3(skaterBody, "G",   fmtNum(sG,   isPer15 ? 2 : 0), fmtNum(cG,   isPer15 ? 2 : 0));
    addRow3(skaterBody, "A",   fmtNum(sA,   isPer15 ? 2 : 0), fmtNum(cA,   isPer15 ? 2 : 0));
    addRow3(skaterBody, "PTS", fmtNum(sPTS, isPer15 ? 2 : 0), fmtNum(cPTS, isPer15 ? 2 : 0));
    addRow3(skaterBody, "Shots", fmtNum(sShots, isPer15 ? 2 : 0), fmtNum(cShotsD, isPer15 ? 2 : 0));
    addRow3(skaterBody, "SH%", fmtPct(s_shp, 1), fmtPct(c_shp, 1));
    addRow3(skaterBody, "Passes", fmtNum(sPasses, isPer15 ? 2 : 0), fmtNum(cPassD, isPer15 ? 2 : 0));
    addRow3(skaterBody, "TA", fmtNum(sTA, isPer15 ? 2 : 0), fmtNum(cTAD, isPer15 ? 2 : 0));
    addRow3(skaterBody, "TO", fmtNum(sTO, isPer15 ? 2 : 0), fmtNum(cTOD, isPer15 ? 2 : 0));
    addRow3(skaterBody, "Entries", fmtNum(sEnt, isPer15 ? 2 : 0), fmtNum(cEntD, isPer15 ? 2 : 0));
    addRow3(skaterBody, "Exits", fmtNum(sEx, isPer15 ? 2 : 0), fmtNum(cExD, isPer15 ? 2 : 0));
    addRow3(skaterBody, "HIT", fmtNum(sHit, isPer15 ? 2 : 0), fmtNum(cHitD, isPer15 ? 2 : 0));
    addRow3(skaterBody, "xG", fmtNum(sXG, 2), fmtNum(cXGD, 2));
    addRow3(skaterBody, "GFAx", fmtNum(sGFAx, 2), fmtNum(cGFAxD, 2));
    addRow3(skaterBody, "SP", fmtNum(sSP, isPer15 ? 2 : 1), fmtNum(cSPD, isPer15 ? 2 : 1));
  } else {
    addRow3(skaterBody, "—", "No skater stats", "");
  }

  /* ---------------- Goalie (Season) ---------------- */
  const g_gp = toIntMaybe(pSeason.gp_g) ?? 0;
  const g_sa = toIntMaybe(pSeason.sa);
  const g_ga = toIntMaybe(pSeason.ga);

  // Totals-derived SV (for totals view)
  const g_sv_tot = (g_sa != null && g_ga != null) ? (g_sa - g_ga) : null;

  // Rates
  const g_svpCsv = toNumMaybe(pSeason.sv_pct); // 0-1 in CSV
  const g_svp = (g_svpCsv != null && Number.isFinite(g_svpCsv))
    ? (g_svpCsv * 100)
    : (g_sa != null && g_sa > 0 && g_sv_tot != null ? (g_sv_tot / g_sa) * 100 : null);

  const g_gaaCsv = toNumMaybe(pSeason.gaa);
  const g_gaa = (g_gaaCsv != null && Number.isFinite(g_gaaCsv))
    ? g_gaaCsv
    : perGpNormalized(g_ga, pSeason, "GOALIE", advOn); // fallback if missing

  const g_w  = toIntMaybe(pSeason.wins);
  const g_so = toIntMaybe(pSeason.so);

  const g_pts = toIntMaybe(pSeason.pts);
  const g_passes = toIntMaybe(pSeason.passes);

  const g_xga = toNumMaybe(pSeason.xGA);
  const g_gsax = (g_xga != null && g_ga != null) ? (g_xga - g_ga) : null;

  const g_sp = toNumMaybe(pSeason.sp);

  /* ---------------- Goalie (Career) ---------------- */
  const cg_gp = career.gp_g ?? 0;
  const cg_sa = career.sa ?? 0;
  const cg_ga = career.ga ?? 0;
  const cg_sv_tot = (cg_sa > 0) ? (cg_sa - cg_ga) : null;

  const cg_svp = (cg_sa > 0 && cg_sv_tot != null) ? (cg_sv_tot / cg_sa) * 100 : null;

  const c_toi_g = career.toi_g ?? 0;
  const cg_gaa = (c_toi_g > 0)
    ? (cg_ga * 900 / c_toi_g)
    : (cg_gp > 0 ? (cg_ga / cg_gp) : null);

  const cg_w  = career.wins ?? 0;
  const cg_so = career.so ?? 0;

  const cg_pts = career.pts ?? 0;       // NOTE: total points (skater+goalie combined in source)
  const cg_passes = career.passes ?? 0; // total passes

  const cg_xga = (career.xGA ?? null);
  const cg_gsax = (cg_xga != null) ? (cg_xga - cg_ga) : null;

  const cg_sp = career.sp ?? 0;

  // Display values (toggle-able counting stats)
  const gSA = isPer15 ? perGpNormalized(g_sa, pSeason, "GOALIE", advOn) : g_sa;
  const gGA = isPer15 ? perGpNormalized(g_ga, pSeason, "GOALIE", advOn) : g_ga;
  const gSV = (gSA != null && gGA != null) ? (gSA - gGA) : null;

  const gW  = isPer15 ? perGpNormalized(g_w,  pSeason, "GOALIE", advOn) : g_w;
  const gSO = isPer15 ? perGpNormalized(g_so, pSeason, "GOALIE", advOn) : g_so;

  const gPTS = isPer15 ? perGpNormalized(g_pts, pSeason, "GOALIE", advOn) : g_pts;
  const gPass = isPer15 ? perGpNormalized(g_passes, pSeason, "GOALIE", advOn) : g_passes;

  const gXGA  = isPer15 ? perGpNormalized(g_xga,  pSeason, "GOALIE", advOn) : g_xga;
  const gGSAX = isPer15 ? perGpNormalized(g_gsax, pSeason, "GOALIE", advOn) : g_gsax;

  const gSP  = isPer15 ? perGpNormalized(g_sp, pSeason, "GOALIE", advOn) : g_sp;

  const cgSA = per15FromCareer(cg_sa, c_toi_g);
  const cgGA = per15FromCareer(cg_ga, c_toi_g);
  const cgSV = (cgSA != null && cgGA != null) ? (cgSA - cgGA) : null;

  const cgW  = per15FromCareer(cg_w,  c_toi_g);
  const cgSO = per15FromCareer(cg_so, c_toi_g);

  const cgPTS = per15FromCareer(cg_pts, c_toi_g);
  const cgPass = per15FromCareer(cg_passes, c_toi_g);

  const cgXGA  = per15FromCareer(cg_xga,  c_toi_g);
  const cgGSAX = per15FromCareer(cg_gsax, c_toi_g);

  const cgSP = per15FromCareer(cg_sp, c_toi_g);

  // Render Goalie table (final order)
  if (g_gp > 0 || cg_gp > 0) {
    addRow3(goalieBody, "GP", g_gp || "", cg_gp || "");
    addRow3(goalieBody, "SA", fmtNum(gSA, isPer15 ? 2 : 0), fmtNum(cgSA, isPer15 ? 2 : 0));
    addRow3(goalieBody, "GA", fmtNum(gGA, isPer15 ? 2 : 0), fmtNum(cgGA, isPer15 ? 2 : 0));
    addRow3(goalieBody, "SV", fmtNum(gSV, isPer15 ? 2 : 0), fmtNum(cgSV, isPer15 ? 2 : 0));

    addRow3(goalieBody, "SV%", fmtPct(g_svp, 1), fmtPct(cg_svp, 1));
    addRow3(goalieBody, "GAA", fmtNum(g_gaa, 2), fmtNum(cg_gaa, 2));

    addRow3(goalieBody, "W",  fmtNum(gW,  isPer15 ? 2 : 0), fmtNum(cgW,  isPer15 ? 2 : 0));
    addRow3(goalieBody, "SO", fmtNum(gSO, isPer15 ? 2 : 0), fmtNum(cgSO, isPer15 ? 2 : 0));

    addRow3(goalieBody, "PTS", fmtNum(gPTS, isPer15 ? 2 : 0), fmtNum(cgPTS, isPer15 ? 2 : 0));
    addRow3(goalieBody, "Passes", fmtNum(gPass, isPer15 ? 2 : 0), fmtNum(cgPass, isPer15 ? 2 : 0));

    addRow3(goalieBody, "xGA", fmtNum(gXGA, 2), fmtNum(cgXGA, 2));
    addRow3(goalieBody, "GSAx", fmtNum(gGSAX, 2), fmtNum(cgGSAX, 2));

    addRow3(goalieBody, "SP", fmtNum(gSP, isPer15 ? 2 : 1), fmtNum(cgSP, isPer15 ? 2 : 1));
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
function normalizeName(s){
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function displayTeamName(t) {
  return (
    (t?.team_name ?? "").trim() ||
    (t?.full_name ?? "").trim() ||
    (t?.name ?? "").trim() ||
    (t?.team_id ?? "").trim() ||
    "UNKNOWN"
  );
}
function stageShortLabel(stage){
  const s = String(stage ?? "").trim().toLowerCase();
  if (s === "qf") return "QF";
  if (s === "sf") return "SF";
  if (s === "f")  return "F";
  if (s === "reg") return "";
  return s ? s.toUpperCase() : "";
}

function weekLabelForMatch(schedRow){
  if (!schedRow) return "";
  const st = String(schedRow.stage ?? "").trim().toLowerCase() || "reg";
  if (st === "reg") return String(toIntMaybe(schedRow.week) ?? "");
  return stageShortLabel(st);
}

function isGoalieBoxRow(r){
  const pos = String(r.position ?? "").trim().toUpperCase();
  if (pos === "G") return true;
  const sa = toIntMaybe(r.sa);
  const ga = toIntMaybe(r.ga);
  return (sa != null || ga != null);
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
async function renderGameLog(seasonId, advOn, stage, teams, schedule, pSeason) {
  // We are replacing the "Game Log" card content with a Plotly performance chart.
  // Dots = last 10 games. Y = SP for that game (SP/GP), X = 1..N.
  // Horizontal line = league average SP per player-game appearance.

  if (!elPerfChart) return;

  // Season 1 (adv off) => no chart
  if (!advOn) {
    elGameLogStatus.hidden = false;
    elGameLogStatus.textContent = `No stats for Season ${seasonId}.`;
    elPerfChart.innerHTML = "";
    return;
  }

  // Ensure Plotly is loaded
  if (!window.Plotly) {
    elGameLogStatus.hidden = false;
    elGameLogStatus.textContent = `Plotly failed to load.`;
    elPerfChart.innerHTML = "";
    return;
  }

  const boxPath = (stage === "PO")
    ? `../data/${seasonId}/boxscores_playoffs.csv`
    : `../data/${seasonId}/boxscores.csv`;

  const boxOk = await urlExists(boxPath);
  if (!boxOk) {
    elGameLogStatus.hidden = false;
    elGameLogStatus.textContent = `Game log not available yet for Season ${seasonId}.`;
    elPerfChart.innerHTML = "";
    return;
  }

  let rows = [];
  try { rows = await loadCSV(boxPath); }
  catch { rows = []; }

  const tmap = new Map(teams.map(t => [String(t.team_id ?? "").trim(), t]));
  const schedById = new Map((schedule || []).map(s => [String(s.match_id ?? "").trim(), s]));

  const playerSteam =
    String(pSeason.steam_id ?? pSeason.steamid ?? pSeason.steamID ?? pSeason.steam ?? pSeason.steam64 ?? "").trim();
  const playerNameNorm = normalizeName(pSeason.name);

  // League average SP per appearance, split by role (skater vs goalie)
function isGoaliePosRow(r) {
  return String(r.position ?? "").trim().toUpperCase() === "G";
}

const spSkaters = rows
  .filter(r => !isGoaliePosRow(r))
  .map(r => toNumMaybe(r.sp))
  .filter(v => v != null && Number.isFinite(v));

const spGoalies = rows
  .filter(r => isGoaliePosRow(r))
  .map(r => toNumMaybe(r.sp))
  .filter(v => v != null && Number.isFinite(v));

const leagueAvgSkater = spSkaters.length ? (spSkaters.reduce((a,b)=>a+b,0) / spSkaters.length) : 0;
const leagueAvgGoalie = spGoalies.length ? (spGoalies.reduce((a,b)=>a+b,0) / spGoalies.length) : 0;

// Fallback (in case early season has 0 goalie or 0 skater samples)
const spAll = [...spSkaters, ...spGoalies];
const leagueAvgAll = spAll.length ? (spAll.reduce((a,b)=>a+b,0) / spAll.length) : 0;
  
// --- Option B: percent above/below league average ---
// y% = (SP - leagueAvg) / leagueAvg * 100
// Dynamic scaling: use a robust league band (95th percentile of |y%|),
// but expand if this player has an even bigger outlier.

function percentile(sortedVals, p) {
  // expects unsorted array, returns pth percentile (0..100)
  const vals = sortedVals
    .filter(v => v != null && Number.isFinite(v))
    .slice()
    .sort((a, b) => a - b);
  if (!vals.length) return null;
  const idx = (p / 100) * (vals.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return vals[lo];
  const w = idx - lo;
  return vals[lo] * (1 - w) + vals[hi] * w;
}

const pctAll = rows
  .map(r => {
    const sp = toNumMaybe(r.sp);
    if (sp == null || !Number.isFinite(sp)) return null;

    const baseline = isGoaliePosRow(r)
      ? (leagueAvgGoalie > 0 ? leagueAvgGoalie : leagueAvgAll)
      : (leagueAvgSkater > 0 ? leagueAvgSkater : leagueAvgAll);

    if (!baseline || baseline === 0) return null;
    return ((sp - baseline) / baseline) * 100;
  })
  .filter(v => v != null && Number.isFinite(v));

const absAll = pctAll.map(v => Math.abs(v));
const maxAbsLeague = percentile(absAll, 95) ?? 50; // fallback if early season / weird data

  // Find player's game rows
  const mine = rows.filter(r => {
    const rSteam = String(r.steam_id ?? r.steamid ?? r.steamID ?? r.steam ?? r.steam64 ?? "").trim();
    if (playerSteam && rSteam && rSteam === playerSteam) return true;

    const rNameNorm = normalizeName(r.player_name);
    return rNameNorm && playerNameNorm && rNameNorm === playerNameNorm;
  });

  if (mine.length === 0) {
    elGameLogStatus.hidden = false;
    elGameLogStatus.textContent = `No games logged yet for Season ${seasonId}.`;
    elPerfChart.innerHTML = "";
    return;
  }

  // Sort by match_id (works with your M1-G1 scheme) and take last 10
  mine.sort((a, b) => String(a.match_id ?? "").localeCompare(String(b.match_id ?? "")));
  const last10 = mine.slice(-10);

  // Build plot arrays (oldest -> newest so x=1 is oldest among last10)
  const x = [];
  const y = [];
  const hover = [];
  const colors = [];
  const matchIds = [];

  for (let i = 0; i < last10.length; i++) {
    const r = last10[i];
	x.push(i + 1);
	const posRaw = String(r.position ?? "").trim();
	const posLabel = posRaw ? `POS: ${escapeHtml(posRaw)}<br>` : "";
    const matchId = String(r.match_id ?? "").trim();
	matchIds.push(matchId);
    const sched = schedById.get(matchId) || null;

    const myTeamId = String(r.team_id ?? "").trim();
    const oppTeamId = (() => {
      if (!sched) return "";
      const h = String(sched.home_team_id ?? "").trim();
      const a = String(sched.away_team_id ?? "").trim();
      if (myTeamId && h === myTeamId) return a;
      if (myTeamId && a === myTeamId) return h;
      return (h && h !== myTeamId) ? h : a;
    })();

const oppName = (oppTeamId || "UNKNOWN");

const sp = toNumMaybe(r.sp);
const spDisp = (sp != null && Number.isFinite(sp)) ? sp : null;

let baseline = isGoaliePosRow(r)
  ? (leagueAvgGoalie > 0 ? leagueAvgGoalie : leagueAvgAll)
  : (leagueAvgSkater > 0 ? leagueAvgSkater : leagueAvgAll);

if (!baseline || baseline === 0) baseline = leagueAvgAll;

const yPct = (spDisp == null || !baseline || baseline === 0)
  ? null
  : ((spDisp - baseline) / baseline) * 100;

const perfLabel =
  (yPct == null)
    ? ""
    : `Perf: ${yPct >= 0 ? "+" : ""}${yPct.toFixed(0)}%<br>`;
y.push(yPct);
colors.push(perfToColor(yPct));

const myName = myTeamId || "UNKNOWN";

const titleLine = `${escapeHtml(myName || myTeamId || "")} vs ${escapeHtml(oppName || oppTeamId || "")}`;

if (isGoalieBoxRow(r)) {
  const sa = toIntMaybe(r.sa);
  const ga = toIntMaybe(r.ga);
  const sv = (sa != null && ga != null) ? (sa - ga) : null;
  const svp = (sa != null && sa > 0 && sv != null) ? (sv / sa) * 100 : null;

  const xga = toNumMaybe(r.xGA ?? r.xga);
  const gsax = (xga != null && ga != null) ? (xga - ga) : null;

  hover.push(
    `${titleLine}<br>` +
	 posLabel +
	 perfLabel +
    `SA: ${sa ?? "—"}<br>` +
    `SV: ${sv ?? "—"}<br>` +
    `SV%: ${svp == null ? "—" : svp.toFixed(1) + "%"}<br>` +
    `xGA: ${xga == null ? "—" : xga.toFixed(2)}<br>` +
    `GSAx: ${gsax == null ? "—" : gsax.toFixed(2)}`
  );
} else {
  const g = toIntMaybe(r.g) ?? 0;
  const a = toIntMaybe(r.a) ?? 0;
  const pts = toIntMaybe(r.pts) ?? (g + a);

  const sh = toIntMaybe(r.shots);
  const shp = (sh != null && sh > 0) ? (g / sh) * 100 : null;

  const xg = toNumMaybe(r.xG ?? r.xg);

  hover.push(
    `${titleLine}<br>` +
	 posLabel +
	 perfLabel +
    `G: ${g}<br>` +
    `A: ${a}<br>` +
    `PTS: ${pts}<br>` +
    `Sh: ${sh ?? "—"}<br>` +
    `Sh%: ${shp == null ? "—" : shp.toFixed(1) + "%"}<br>` +
    `xG: ${xg == null ? "—" : xg.toFixed(2)}`
  );
}
  }
const nGames = x.length || 1;
const xPad = Math.max(0.1, Math.min(0.20, nGames * 0.04));
const verticalLines = x.map(xVal => ({
  type: "line",
  xref: "x",
  x0: xVal,
  x1: xVal,
  yref: "paper",
  y0: 0,
  y1: 1,
  line: {
    width: 1,
    color: "rgba(255,255,255,0.08)"
  }
}));
function perfToColor(pct) {
  if (pct == null || !Number.isFinite(pct)) {
    return "rgba(255,255,255,0.85)";
  }

  const lo = -100;   // worst case
  const hi = 100;    // strong ceiling
  const p = Math.max(lo, Math.min(hi, pct));

  // Base colors
  const red   = { r: 231, g: 76,  b: 60  };
  const blue  = { r: 255,  g: 255, b: 255 };
  const green = { r: 46,  g: 204, b: 113 };

  function lerp(a, b, t) {
    return Math.round(a + (b - a) * t);
  }

  let r, g, b;

  if (p < 0) {
    // Blend red -> blue
    const t = (p - lo) / (0 - lo); // lo..0 → 0..1
    r = lerp(red.r,  blue.r,  t);
    g = lerp(red.g,  blue.g,  t);
    b = lerp(red.b,  blue.b,  t);
  } else {
    // Blend blue -> green
    const t = (p - 0) / (hi - 0); // 0..hi → 0..1
    r = lerp(blue.r,  green.r, t);
    g = lerp(blue.g,  green.g, t);
    b = lerp(blue.b,  green.b, t);
  }

  return `rgb(${r}, ${g}, ${b})`;
}

function rgbStringToObj(s) {
  // expects "rgb(r, g, b)"
  const m = String(s).match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (!m) return { r: 255, g: 255, b: 255 };
  return { r: +m[1], g: +m[2], b: +m[3] };
}

function blendRgb(c1, c2, t = 0.5) {
  const a = rgbStringToObj(c1);
  const b = rgbStringToObj(c2);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const b2 = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r}, ${g}, ${b2})`;
}
  
  // Dynamic y-range: use robust league band, but expand if player has bigger outlier
const yVals = y.filter(v => v != null && Number.isFinite(v));
const maxAbsPlayer = yVals.length ? Math.max(...yVals.map(v => Math.abs(v))) : 0;

const maxAbs = Math.max(maxAbsLeague, maxAbsPlayer);
const pad = maxAbs > 0 ? maxAbs * 0.05 : 10;

const yRange = [-(maxAbs + pad), (maxAbs + pad)];

  // Plotly trace + layout
// Gradient-ish line segments between points by subdividing each segment
const segmentTraces = [];
const STEPS = 24; // higher = smoother gradient (10 games max, so this is safe)

for (let i = 1; i < x.length; i++) {
  const x0 = x[i - 1], x1 = x[i];
  const y0 = y[i - 1], y1 = y[i];
  if (y0 == null || y1 == null) continue;

  const c0 = colors[i - 1];
  const c1 = colors[i];

  // Build tiny sub-segments, each with its own color blended along the way
  for (let s = 0; s < STEPS; s++) {
    const t0 = s / STEPS;
    const t1 = (s + 1) / STEPS;

    const xs0 = x0 + (x1 - x0) * t0;
    const xs1 = x0 + (x1 - x0) * t1;

    const ys0 = y0 + (y1 - y0) * t0;
    const ys1 = y0 + (y1 - y0) * t1;

    // color at midpoint of this tiny segment
    const cm = blendRgb(c0, c1, (t0 + t1) / 2);

    segmentTraces.push({
      type: "scatter",
      mode: "lines",
      x: [xs0, xs1],
      y: [ys0, ys1],
      hoverinfo: "skip",
      line: { width: 3, color: cm },
      showlegend: false
    });
  }
}

const avgLineTrace = {
  type: "scatter",
  mode: "lines",
  x: [1 - xPad, nGames + xPad],
  y: [0, 0],
  line: { width: 8, color: "rgba(0,0,0,0)" }, // invisible but hoverable
  hoverinfo: "text",
  text: ["League Average Performance", "League Average Performance"],
  showlegend: false
};

// Markers on top
const markerTrace = {
  type: "scatter",
  mode: "markers",
  x,
  y,
  text: hover,
  hoverinfo: "text",
  customdata: matchIds,
  cliponaxis: false,
  marker: {
    size: 10,
    color: colors,
    line: { width: 1, color: "#ffffff" }
  },
  showlegend: false
};

  const layout = {
    margin: { l: 0, r: 0, t: 0, b: 0 },
	
	paper_bgcolor: "rgba(0,0,0,0)",
	plot_bgcolor: "rgba(0,0,0,0)",
	dragmode: false,

  xaxis: {
    showticklabels: false,
    showgrid: false,
    zeroline: false,
    range: [1 - xPad, nGames + xPad],
    fixedrange: true
  },

  yaxis: {
    showticklabels: false,
    showgrid: false,
    zeroline: false,
    range: yRange
  },

shapes: [
  {
    type: "line",
    xref: "paper",
    x0: 0,
    x1: 1,
    yref: "y",
    y0: 0,
    y1: 0,
    line: { width: 1, dash: "dot", color: "#cccccc" }
  },
  ...verticalLines
],

  };

  const config = {
  displayModeBar: false,
  responsive: true,
  scrollZoom: false,
  doubleClick: false
};

  // Render
  elGameLogStatus.hidden = true;
  window.Plotly.react(
  elPerfChart,
  [...segmentTraces, avgLineTrace, markerTrace],
  layout,
  config
).then(() => {
  // avoid stacking handlers if renderGameLog runs multiple times
  if (!elPerfChart.__wcplClickBound) {
    elPerfChart.__wcplClickBound = true;

    elPerfChart.on("plotly_click", (ev) => {
      const pt = ev?.points?.[0];
      const matchId = pt?.customdata;
      if (!matchId) return;

      const isPages = window.location.pathname.includes("/pages/");
      const boxPath = isPages ? "boxscore.html" : "pages/boxscore.html";

      const qs = new URLSearchParams();
      qs.set("season", seasonId);
      qs.set("match_id", matchId);
      if (stage) qs.set("stage", stage); // harmless even if boxscore ignores it

      window.location.href = `${boxPath}?${qs.toString()}`;
    });
  }
});

}



