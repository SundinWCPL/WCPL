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

const elBarsToggle = document.getElementById("playerBarsRoleToggle");
const elBarsStatus = document.getElementById("playerBarsStatus");
const elBarsChart = document.getElementById("playerBarsChart");

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

function computeRoleSplitFromBoxscores(boxRows, pSeason) {
  const playerSteam =
    String(pSeason.steam_id ?? pSeason.steamid ?? pSeason.steamID ?? pSeason.steam ?? pSeason.steam64 ?? "").trim();
  const playerNameNorm = normalizeName(pSeason.name);

  function isMe(r) {
    const rSteam = String(r.steam_id ?? "").trim();
    if (playerSteam && rSteam && rSteam === playerSteam) return true;
    return normalizeName(r.player_name) === playerNameNorm;
  }

  const out = {
    skater: { g: 0, a: 0, pts: 0, passes: 0 },
    goalie: { g: 0, a: 0, pts: 0, passes: 0 },
  };

  for (const r of (boxRows || [])) {
    if (!isMe(r)) continue;

    const isG = String(r.position ?? "").trim().toUpperCase() === "G";
    const bucket = isG ? out.goalie : out.skater;

    const g = toIntMaybe(r.g) ?? 0;
    const a = toIntMaybe(r.a) ?? 0;
    const passes = toIntMaybe(r.passes) ?? 0;

    bucket.g += g;
    bucket.a += a;
    bucket.pts += (g + a);   // boxscores has g/a, so pts = g+a
    bucket.passes += passes;
  }

  return out;
}

function mergeRoleSplitTotals(a, b) {
  return {
    skater: {
      g: (a?.skater?.g ?? 0) + (b?.skater?.g ?? 0),
      a: (a?.skater?.a ?? 0) + (b?.skater?.a ?? 0),
      pts: (a?.skater?.pts ?? 0) + (b?.skater?.pts ?? 0),
      passes: (a?.skater?.passes ?? 0) + (b?.skater?.passes ?? 0),
    },
    goalie: {
      g: (a?.goalie?.g ?? 0) + (b?.goalie?.g ?? 0),
      a: (a?.goalie?.a ?? 0) + (b?.goalie?.a ?? 0),
      pts: (a?.goalie?.pts ?? 0) + (b?.goalie?.pts ?? 0),
      passes: (a?.goalie?.passes ?? 0) + (b?.goalie?.passes ?? 0),
    },
  };
}

async function computeCareerRoleSplitFromAllSeasons(seasonsMeta, stage, pSeason) {
  // seasonsMeta should be your seasons.csv rows (each with season_id like "S1", "S2", etc.)
  let total = {
    skater: { g: 0, a: 0, pts: 0, passes: 0 },
    goalie: { g: 0, a: 0, pts: 0, passes: 0 },
  };

  for (const s of (seasonsMeta || [])) {
    const sid = s.season_id || s.id || s.season || s.Season;
    if (!sid) continue;

    const boxPath = (stage === "PO")
      ? `../data/${sid}/boxscores_playoffs.csv`
      : `../data/${sid}/boxscores.csv`;

    const boxRows = await loadCSV(boxPath).catch(() => null);
    if (!boxRows || !boxRows.length) continue;

    const split = computeRoleSplitFromBoxscores(boxRows, pSeason);
    total = mergeRoleSplitTotals(total, split);
  }

  return total;
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

// Flex-player fix: split G/A/PTS/PASSES by role using boxscores.csv (current season)
let roleSplitSeason = null;
const s_gp = toIntMaybe(pSeason.gp_s) ?? 0;
const g_gp = toIntMaybe(pSeason.gp_g) ?? 0;

if (s_gp > 0 && g_gp > 0) {
  const boxPath = (stage === "PO")
    ? `../data/${seasonId}/boxscores_playoffs.csv`
    : `../data/${seasonId}/boxscores.csv`;

  const boxRows = await loadCSV(boxPath).catch(() => []);
  roleSplitSeason = computeRoleSplitFromBoxscores(boxRows, pSeason);
}

// Career split (always compute; cheap + prevents flex contamination across seasons)
const roleSplitCareer = await computeCareerRoleSplitFromAllSeasons(seasons, stage, pSeason);

    renderStats(pSeason, careerAgg, advOn, roleSplitSeason, roleSplitCareer);
	
	// render charts (perf + bars)
await renderGameLog(seasonId, advOn, stage, teams, schedule, pSeason, players, roleSplitSeason);

// show page + clear status
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
	
	const advOnBySeason = new Map(
  seasons.map(s => [
    String(s.season_id ?? "").trim(),
    (toIntMaybe(s.adv_stats) ?? 0) === 1
  ])
);


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
    hits: 0, blocks: 0, takeaways: 0, turnovers: 0,
    sp: 0,
	toi_s: 0, // skater TOI (seconds)
	toi_s_adv: 0, // skater TOI for adv-only per/15 (exclude seasons with adv_stats=0)
	passes: 0, exits: 0, entries: 0,
	xG: 0, xGA: 0,
	g_adv: 0,

    // Goalie totals
    gp_g: 0, sa: 0, ga: 0,
    wins: 0, so: 0,
	toi_g: 0, // goalie TOI (seconds)
	toi_g_adv: 0, // goalie TOI for adv-only per/15 (exclude seasons with adv_stats=0)
	ga_adv: 0,
    // (svp, gaa derived from totals)
  };

  if (validPaths.length === 0) return agg;

  const allRows = await Promise.all(validPaths.map(async p => ({ path: p, rows: await loadCSV(p) })));
for (const { path, rows } of allRows) {
  const sid = path.split("/").slice(-2, -1)[0]; // "../data/S2/players.csv" -> "S2"
  const advThisSeason = advOnBySeason.get(String(sid).trim()) === true;
    const r = rows.find(x => String(x.player_key ?? "").trim() === String(playerKey).trim());
    if (!r) continue;

    // Skater sums
    agg.gp_s += (toIntMaybe(r.gp_s) ?? 0);
    agg.g    += (toIntMaybe(r.g) ?? 0);
	if (advThisSeason) agg.g_adv += (toIntMaybe(r.g) ?? 0);
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

if (advThisSeason) {
  if (gpS > 0) agg.toi_s_adv += (toiS > 0 ? toiS : (toiLegacy > 0 ? toiLegacy : assumedS));
  if (gpG > 0) agg.toi_g_adv += (toiG > 0 ? toiG : (toiLegacy > 0 ? toiLegacy : assumedG));
}

    const shotsRaw = (r.shots ?? "").toString().trim();
    const shotsVal = shotsRaw === "" ? null : Number(shotsRaw);
    const shots = Number.isFinite(shotsVal) ? Math.trunc(shotsVal) : null;
    agg.shots += (shots ?? 0);

    agg.hits      += (toIntMaybe(r.hits) ?? 0);
	agg.blocks    += (toIntMaybe(r.blocks) ?? 0);
    agg.takeaways += (toIntMaybe(r.takeaways) ?? 0);
    agg.turnovers += (toIntMaybe(r.turnovers) ?? 0);

    agg.sp += (toNumMaybe(r.sp) ?? 0);

    // Goalie sums
    agg.gp_g += (toIntMaybe(r.gp_g) ?? 0);
    agg.sa   += (toIntMaybe(r.sa) ?? 0);
    agg.ga   += (toIntMaybe(r.ga) ?? 0);
	if (advThisSeason) agg.ga_adv += (toIntMaybe(r.ga) ?? 0);
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

function renderStats(pSeason, career, advOn, roleSplitSeason, roleSplitCareer) {
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
  
  function per15FromCareerAdv(total, toiSecondsAdv) {
  return per15FromCareer(total, toiSecondsAdv);
}

const c_toi_s_adv = career.toi_s_adv ?? 0;
const c_toi_g_adv = career.toi_g_adv ?? 0;

  /* ---------------- Skater (Season) ---------------- */
  const s_gp  = toIntMaybe(pSeason.gp_s) ?? 0;
const s_g   = (roleSplitSeason ? roleSplitSeason.skater.g : (toIntMaybe(pSeason.g) ?? 0));
const s_a   = (roleSplitSeason ? roleSplitSeason.skater.a : (toIntMaybe(pSeason.a) ?? 0));
const s_pts = (roleSplitSeason ? roleSplitSeason.skater.pts : (toIntMaybe(pSeason.pts) ?? 0));

  const s_shots = parseShots(pSeason.shots);
  const s_shp = (s_shots != null && s_shots > 0) ? (s_g / s_shots) * 100 : null;

  const s_passes = (roleSplitSeason ? roleSplitSeason.skater.passes : toIntMaybe(pSeason.passes));
  const s_entries = toIntMaybe(pSeason.entries);
  const s_exits   = toIntMaybe(pSeason.exits);

  const s_ta   = toIntMaybe(pSeason.takeaways);
  const s_to   = toIntMaybe(pSeason.turnovers);
  const s_hits = toIntMaybe(pSeason.hits);
  const s_blocks = toIntMaybe(pSeason.blocks);

  const s_xg = toNumMaybe(pSeason.xG);
  const s_gfax = (s_xg != null) ? (s_g - s_xg) : null;

  const s_sp = toNumMaybe(pSeason.sp);

  /* ---------------- Skater (Career) ---------------- */
  const c_gp   = career.gp_s ?? 0;
  const cs_g = roleSplitCareer?.skater?.g ?? (toIntMaybe(career.g) ?? 0);
  const cs_a = roleSplitCareer?.skater?.a ?? (toIntMaybe(career.a) ?? 0);
  const cs_pts = roleSplitCareer?.skater?.pts ?? (toIntMaybe(career.pts) ?? 0);
  const c_g = cs_g;
  const c_a = cs_a;
  const c_pts = cs_pts;
  const c_sp   = career.sp ?? 0;

  const c_shots = (career.shots ?? 0);
  const c_shp = (c_shots > 0) ? (c_g / c_shots) * 100 : null;

  const cs_passes = roleSplitCareer?.skater?.passes ?? toIntMaybe(career.passes);
  const c_passes = cs_passes;
  const c_entries = career.entries ?? 0;
  const c_exits   = career.exits ?? 0;

  const c_ta   = career.takeaways ?? 0;
  const c_to   = career.turnovers ?? 0;
  const c_hits = career.hits ?? 0;
  const c_blocks = career.blocks ?? 0;

  const c_xg = (career.xG ?? null);
  const c_g_adv = career.g_adv ?? 0;
  const c_gfax = (c_xg != null) ? (c_g_adv - c_xg) : null;

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
  const sBlk    = isPer15 ? perGpNormalized(s_blocks, pSeason, "SKATER", advOn) : s_blocks;
  const sXG     = isPer15 ? perGpNormalized(s_xg,     pSeason, "SKATER", advOn) : s_xg;
  const sGFAx   = isPer15 ? perGpNormalized(s_gfax,   pSeason, "SKATER", advOn) : s_gfax;
  const sSP     = isPer15 ? perGpNormalized(s_sp,     pSeason, "SKATER", advOn) : s_sp;

  const cG      = per15FromCareer(c_g,      c_toi_s);
  const cA      = per15FromCareer(c_a,      c_toi_s);
  const cPTS    = per15FromCareer(c_pts,    c_toi_s);
  const cShotsD = per15FromCareer(c_shots,  c_toi_s);
  const cPassD  = per15FromCareerAdv(c_passes, c_toi_s_adv);
  const cTAD    = per15FromCareerAdv(c_ta,     c_toi_s_adv);
  const cTOD    = per15FromCareerAdv(c_to,     c_toi_s_adv);
  const cEntD   = per15FromCareerAdv(c_entries,c_toi_s_adv);
  const cExD    = per15FromCareerAdv(c_exits,  c_toi_s_adv);
  const cHitD   = per15FromCareerAdv(c_hits,   c_toi_s_adv);
  const cBlkD   = per15FromCareerAdv(c_blocks,   c_toi_s_adv);
  const cXGD    = per15FromCareerAdv(c_xg,     c_toi_s_adv);
  const cGFAxD  = per15FromCareerAdv(c_gfax,   c_toi_s_adv);
  const cSPD    = per15FromCareerAdv(c_sp,     c_toi_s_adv);


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
	addRow3(skaterBody, "BLK", fmtNum(sBlk, isPer15 ? 2 : 0), fmtNum(cBlkD, isPer15 ? 2 : 0));
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

  const g_pts = (roleSplitSeason ? roleSplitSeason.goalie.pts : toIntMaybe(pSeason.pts));
const g_passes = (roleSplitSeason ? roleSplitSeason.goalie.passes : toIntMaybe(pSeason.passes));

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

  const cg_pts = roleSplitCareer?.goalie?.pts ?? toIntMaybe(career.pts);
  const cg_passes = roleSplitCareer?.goalie?.passes ?? toIntMaybe(career.passes);

  const cg_xga = (career.xGA ?? null);
  const cg_ga_adv = career.ga_adv ?? 0;
  const cg_gsax = (cg_xga != null) ? (cg_xga - cg_ga_adv) : null;

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
  const cgPass  = per15FromCareerAdv(cg_passes,  c_toi_g_adv);

  const cgXGA  = per15FromCareerAdv(cg_xga,  c_toi_g_adv);
  const cgGSAX = per15FromCareerAdv(cg_gsax, c_toi_g_adv);

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

function pickFirstExisting(obj, keys) {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) return k;
  }
  return null;
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pctColor(p) {
  if (p == null || !Number.isFinite(p)) return "rgba(255,255,255,0.75)";
  if (Math.abs(p) < 0.05) return "rgba(255,255,255,0.75)";
  return p > 0 ? "#4caf50" : "#ff5252";
}

function fmtSignedPct(p, dec = 1) {
  if (p == null || !Number.isFinite(p)) return "—";
  const v = (Math.abs(p) < 0.05) ? 0 : p; // kill -0.0%
  return `${v >= 0 ? "+" : ""}${v.toFixed(dec)}%`;
}

// NOTE: user specifically said *Takeaways* is inverted (lower is better)
const INVERT_KEYS_PLAYERBARS = new Set(["turnovers_15", "ga_15"]);

const OFFENSE_KEYS_PLAYERBARS = [
  "g_15",
  "a_15",
  "xg_15",
  "shots_15",
  "shp",
  "passes_15",
  "entries_15",
  "possession_15", // will auto-skip if missing
];

const DEFENSE_KEYS_PLAYERBARS = [
  "takeaways_15",
  "turnovers_15",
  "blocks_15",
  "exits_15",
];

const GOALIE_KEYS_PLAYERBARS = [
  "sv_15",
  "ga_15",
  "svp",
  "gsax_15",
  "passes_15",
];

function pctVsLeague(key, playerVal, lgVal) {
  if (!Number.isFinite(playerVal) || !Number.isFinite(lgVal) || lgVal === 0) return null;
  const inv = INVERT_KEYS_PLAYERBARS.has(key);
  return inv
    ? ((lgVal - playerVal) / lgVal) * 100
    : ((playerVal - lgVal) / lgVal) * 100;
}

function avgPctDiffVsLeague(keys, playerVals, leagueVals) {
  let sum = 0;
  let count = 0;

  for (const k of keys) {
    const p = safeNum(playerVals?.[k]);
    const lg = safeNum(leagueVals?.[k]);

let pct = pctVsLeague(k, p, lg); // already handles invert keys
if (pct == null) continue;

// Cap only negative contribution (prevents e.g. 0 vs 0.33 => -100% from dominating)
const NEG_CAP = -50;   // <- tune this (e.g. -40, -50, -60)
if (pct < NEG_CAP) pct = NEG_CAP;

sum += pct;
count++;
  }

  return count > 0 ? (sum / count) : null;
}

function per15FromTotals(total, toiSeconds) {
  const t = safeNum(total);
  const toi = safeNum(toiSeconds);
  if (t == null || toi == null || toi <= 0) return null;
  return t * 900 / toi;
}

function resolveTeamColorForBars() {
  const rootStyles = getComputedStyle(document.documentElement);
  const bg = rootStyles.getPropertyValue("--team-bg").trim() || "rgba(255,255,255,0.85)";
  // If it's a hex, just use it; otherwise it's already rgb/rgba.
  return bg;
}

/**
 * Build league averages from boxscores rows (stage-filtered by the file you already loaded).
 * Returns:
 *  - skater: { toi, g_15, a_15, xg_15, shots_15, passes_15, entries_15, exits_15, takeaways_15, turnovers_15, hits_15, blocks_15, possession_15? }
 *  - goalie: { sa, ga, xga, toi, svp, gsax_15, passes_15 }
 */
function computeLeagueAveragesFromBoxscores(rows) {
  // detect columns that may not exist in older seasons/exports
  const possKey = pickFirstExisting(rows?.[0] ?? {}, ["possession", "poss", "possessions", "pos_time", "possession_s", "poss_s"]);

  // totals
  let s_toi = 0;
const s = {
  g: 0, a: 0, shots: 0, passes: 0, entries: 0, exits: 0,
  takeaways: 0, turnovers: 0, blocks: 0, xg: 0,
  possession: 0
};

  let g_toi = 0;
  const g = { sa: 0, ga: 0, xga: 0, passes: 0 };

  function isGoalieRow(r) {
    return String(r.position ?? "").trim().toUpperCase() === "G";
  }

  for (const r of (rows || [])) {
    const isG = isGoalieRow(r);

    if (isG) {
      const toi = safeNum(r.toi_g ?? r.toi_s ?? r.toi) ?? 0;
      if (toi > 0) g_toi += toi;

      g.sa += safeNum(r.sa) ?? 0;
      g.ga += safeNum(r.ga) ?? 0;
      g.xga += safeNum(r.xGA ?? r.xga) ?? 0;
      g.passes += safeNum(r.passes) ?? 0;
    } else {
      const toi = safeNum(r.toi_s ?? r.toi) ?? 0;
      if (toi > 0) s_toi += toi;

      s.g += safeNum(r.g) ?? 0;
      s.a += safeNum(r.a) ?? 0;
      s.shots += safeNum(r.shots) ?? 0;
      s.passes += safeNum(r.passes) ?? 0;
      s.entries += safeNum(r.entries) ?? 0;
      s.exits += safeNum(r.exits) ?? 0;
      s.takeaways += safeNum(r.takeaways) ?? 0;
      s.turnovers += safeNum(r.turnovers) ?? 0;
      s.blocks += safeNum(r.blocks) ?? 0;
      s.xg += safeNum(r.xG ?? r.xg) ?? 0;

      if (possKey) s.possession += safeNum(r[possKey]) ?? 0;
    }
  }

  // goalie sv% is not per15
  const sv = (g.sa > 0) ? (g.sa - g.ga) : null;
  const svp = (g.sa > 0 && sv != null) ? (sv / g.sa) * 100 : null;

  // goalie GSAx per15 (xGA - GA)
  const gsaxTot = (Number.isFinite(g.xga) && Number.isFinite(g.ga)) ? (g.xga - g.ga) : null;

const lgG15 = per15FromTotals(s.g, s_toi);
const lgShots15 = per15FromTotals(s.shots, s_toi);
const lgShp = (lgG15 != null && lgShots15 != null && lgShots15 > 0) ? (lgG15 / lgShots15) * 100 : null;

const skater = {
  toi: s_toi,
  g_15: lgG15,
  a_15: per15FromTotals(s.a, s_toi),
  xg_15: per15FromTotals(s.xg, s_toi),
  shots_15: lgShots15,

  shp: lgShp, // <-- ADD THIS

  passes_15: per15FromTotals(s.passes, s_toi),
    entries_15: per15FromTotals(s.entries, s_toi),
    possession_15: possKey
  ? (() => {
      const per15Seconds = per15FromTotals(s.possession, s_toi);
      return per15Seconds != null ? per15Seconds / 60 : null; // convert to minutes
    })()
  : null,

    takeaways_15: per15FromTotals(s.takeaways, s_toi),
    turnovers_15: per15FromTotals(s.turnovers, s_toi),
    blocks_15: per15FromTotals(s.blocks, s_toi),
    exits_15: per15FromTotals(s.exits, s_toi),
  };

const svTotLeague = (g.sa > 0) ? (g.sa - g.ga) : null;

const goalie = {
  toi: g_toi,

  sv_15:  per15FromTotals(svTotLeague, g_toi),
  ga_15:  per15FromTotals(g.ga, g_toi),

  svp,
  gsax_15: per15FromTotals(gsaxTot, g_toi),
  passes_15: per15FromTotals(g.passes, g_toi),
};

  return { skater, goalie, possKey };
}

function buildPlayerBarsMetrics({ role, hasPossession }) {
if (role === "GOALIE") {
  return [
    { key: "__hdr_goalie", label: "Goaltending", long: "", show: "hdr" },

    { key: "sv_15",  label: "SV/15",  long: "Saves per 15", kind: "num" },
    { key: "ga_15",  label: "GA/15",  long: "Goals Against per 15", kind: "num" },

    { key: "svp",      label: "SV%",   long: "Save Percentage", kind: "pct" },
    { key: "gsax_15",  label: "GSAx/15", long: "Goals Saved Above Expected per 15", kind: "num" },
    { key: "passes_15",label: "PASS/15", long: "Passes per 15", kind: "num" },
  ];
}

  // Skater
  const off = [
    { key: "__hdr_off", label: "Offense", long: "", show: "hdr" },
    { key: "g_15",      label: "G/15",    long: "Goals per 15", kind: "num" },
    { key: "a_15",      label: "A/15",    long: "Assists per 15", kind: "num" },
    { key: "xg_15",     label: "xG/15",   long: "Expected Goals per 15", kind: "num" },
    { key: "shots_15",  label: "S/15",    long: "Shots per 15", kind: "num" },
	{ key: "shp",       label: "SH%",     long: "Shooting Percentage", kind: "pct" },
    { key: "passes_15", label: "PASS/15", long: "Passes per 15", kind: "num" },
    { key: "entries_15",label: "ENT/15",  long: "Entries per 15", kind: "num" },
  ];

  if (hasPossession) {
    off.push({ key: "possession_15", label: "POSS/15", long: "Possession per 15", kind: "num" });
  }

  const def = [
    { key: "__hdr_def", label: "Defense", long: "", show: "hdr" },
    // Takeaways inverted per your spec
    { key: "takeaways_15", label: "TA/15", long: "Takeaways per 15", kind: "num" },
    { key: "turnovers_15", label: "TO/15",  long: "Turnovers per 15", kind: "num" },
    { key: "blocks_15",    label: "BLK/15", long: "Blocks per 15", kind: "num" },
    { key: "exits_15",     label: "EXT/15", long: "Exits per 15", kind: "num" },
  ];

  return [...off, ...def];
}

	function computeLeagueMinsFromPlayers(playersRows, role, advOn) {
  const mins = {};

  for (const p of (playersRows || [])) {
    if (!advOn) continue;

    const gpG = Number(p.gp_g ?? 0);
    if (role === "GOALIE" && gpG > 0) {
      const vals = readPlayerPer15FromSeasonRow(p, advOn, null)?.goalie;
      if (!vals) continue;

      for (const [k, v] of Object.entries(vals)) {
        if (!Number.isFinite(v)) continue;
        mins[k] = (mins[k] == null) ? v : Math.min(mins[k], v);
      }
    }
  }

  return mins;
}

function computeLeagueMaxesFromPlayers(playersRows, role, advOn) {
  const maxes = {};

  for (const p of (playersRows || [])) {
    if (!advOn) continue;

    const gpS = Number(p.gp_s ?? 0);
    const gpG = Number(p.gp_g ?? 0);

    if (role === "SKATER" && gpS > 0) {
      const vals = readPlayerPer15FromSeasonRow(p, advOn)?.skater;
      if (!vals) continue;

      for (const [k, v] of Object.entries(vals)) {
        if (!Number.isFinite(v)) continue;
        maxes[k] = Math.max(maxes[k] ?? 0, v);
      }
    }

    if (role === "GOALIE" && gpG > 0) {
      const vals = readPlayerPer15FromSeasonRow(p, advOn)?.goalie;
      if (!vals) continue;

      for (const [k, v] of Object.entries(vals)) {
        if (!Number.isFinite(v)) continue;
        maxes[k] = Math.max(maxes[k] ?? 0, v);
      }
    }
  }

  return maxes;
}

function readPlayerPer15FromSeasonRow(pSeason, advOn, roleSplitSeason) {
  // If adv is off, perGpNormalized falls back to per GP (we do NOT want that),
  // so we’ll just return nulls and hide the chart.
  if (!advOn) return null;

  // Skater
const skG = roleSplitSeason ? roleSplitSeason.skater.g : toNumMaybe(pSeason.g);
const skA = roleSplitSeason ? roleSplitSeason.skater.a : toNumMaybe(pSeason.a);
const skPass = roleSplitSeason ? roleSplitSeason.skater.passes : toNumMaybe(pSeason.passes);

// compute once so SH% uses the same per/15 values as the bars
const gPer15 = perGpNormalized(skG, pSeason, "SKATER", true);
const shotsPer15 = perGpNormalized(toNumMaybe(pSeason.shots), pSeason, "SKATER", true);

const s = {
  g_15: gPer15,
  a_15: perGpNormalized(skA, pSeason, "SKATER", true),
  xg_15: perGpNormalized(toNumMaybe(pSeason.xG), pSeason, "SKATER", true),

  shots_15: shotsPer15,

  // SH% = goals/shots * 100 (using per/15 values to match the chart mode)
  shp: (gPer15 != null && shotsPer15 != null && shotsPer15 > 0) ? (gPer15 / shotsPer15) * 100 : null,

  passes_15: perGpNormalized(skPass, pSeason, "SKATER", true),
  entries_15: perGpNormalized(toNumMaybe(pSeason.entries), pSeason, "SKATER", true),
  exits_15: perGpNormalized(toNumMaybe(pSeason.exits), pSeason, "SKATER", true),

  takeaways_15: perGpNormalized(toNumMaybe(pSeason.takeaways), pSeason, "SKATER", true),
  turnovers_15: perGpNormalized(toNumMaybe(pSeason.turnovers), pSeason, "SKATER", true),
  blocks_15: perGpNormalized(toNumMaybe(pSeason.blocks), pSeason, "SKATER", true),
};


  // Possession might not exist
  const possKey = pickFirstExisting(pSeason ?? {}, ["possession", "poss", "possessions", "pos_time", "possession_s", "poss_s"]);
  if (possKey) {
    const possPer15Seconds = perGpNormalized(
  toNumMaybe(pSeason[possKey]),
  pSeason,
  "SKATER",
  true
);

s.possession_15 = possPer15Seconds != null
  ? possPer15Seconds / 60   // convert seconds → minutes
  : null;
  }

  // Goalie
  const ga = toNumMaybe(pSeason.ga);
  const xga = toNumMaybe(pSeason.xGA);
  const gsaxTot = (xga != null && ga != null) ? (xga - ga) : null;

  // SV% (not per15)
  const sa = toNumMaybe(pSeason.sa);
  const svpCsv = toNumMaybe(pSeason.sv_pct);
  const svp = (svpCsv != null && Number.isFinite(svpCsv)) ? (svpCsv * 100)
    : (sa != null && sa > 0 && ga != null ? ((sa - ga) / sa) * 100 : null);
const gPass = roleSplitSeason ? roleSplitSeason.goalie.passes : toNumMaybe(pSeason.passes);
const svTot = (sa != null && ga != null) ? (sa - ga) : null;

const g = {
  sv_15:  perGpNormalized(svTot, pSeason, "GOALIE", true),
  ga_15:  perGpNormalized(ga,    pSeason, "GOALIE", true),

  svp,
  gsax_15: perGpNormalized(gsaxTot, pSeason, "GOALIE", true),
  passes_15: perGpNormalized(gPass, pSeason, "GOALIE", true),
};

  return { skater: s, goalie: g, possKey };
}

function lerp(a, b, t) { return a + (b - a) * t; }

function diffToTriColor(diff, maxVal) {
  // white at 0, green for positive, red for negative
  if (diff == null || !Number.isFinite(diff)) return "rgba(255,255,255,0.70)";

  // scale intensity by how big the diff is relative to the stat ceiling
  const rawDenom = (Number.isFinite(maxVal) && maxVal > 0) ? maxVal : 1;

// make color hit full intensity at ~85% of league max
const denom = rawDenom * 0.3;

  const t = Math.max(0, Math.min(1, Math.abs(diff) / denom)); // 0..1

  const white = { r: 255, g: 255, b: 255 };
  const green = { r: 46,  g: 204, b: 113 };
  const red   = { r: 231, g: 76,  b: 60  };

  const target = diff >= 0 ? green : red;

  const r = Math.round(lerp(white.r, target.r, t));
  const g = Math.round(lerp(white.g, target.g, t));
  const b = Math.round(lerp(white.b, target.b, t));

  return `rgb(${r}, ${g}, ${b})`;
}

function renderPlayerBarsChart({ role, playerVals, leagueVals, maxes, mins, teamColor }) {
  if (!elBarsChart || !window.Plotly) return;

  const metrics = buildPlayerBarsMetrics({
    role,
    hasPossession: role === "SKATER" && (playerVals?.possession_15 != null || leagueVals?.possession_15 != null),
  });
  
const offenseAvgPct =
  (role === "SKATER")
    ? avgPctDiffVsLeague(OFFENSE_KEYS_PLAYERBARS, playerVals, leagueVals)
    : null;
	
	const defenseAvgPct =
  (role === "SKATER")
    ? avgPctDiffVsLeague(DEFENSE_KEYS_PLAYERBARS, playerVals, leagueVals)
    : null;

const goalieAvgPct =
  (role === "GOALIE")
    ? avgPctDiffVsLeague(GOALIE_KEYS_PLAYERBARS, playerVals, leagueVals)
    : null;

  const y = [];
  const xLeague = [];
  const xPlayer = [];
  const hoverText = [];
  const custom = [];
  const playerColors = [];
  const tickText = [];
  const headerAnnots = [];

  for (const m of metrics) {
    // section header rows: no bars
if (m.show === "hdr") {
  // keep a real category row so spacing stays consistent
  y.push(m.label);

  // hide the tick label for this row (we'll draw an annotation instead)
  tickText.push("");

  // centered header text over the plot area
let headerText = m.label;
let headerPct = null;

if (m.key === "__hdr_off") {
  headerPct = offenseAvgPct;
  if (headerPct != null) {
    headerText = `OFFENSE : ${fmtSignedPct(headerPct, 1)}`;
  }
}

if (m.key === "__hdr_def") {
  headerPct = defenseAvgPct;
  if (headerPct != null) {
    headerText = `DEFENSE : ${fmtSignedPct(headerPct, 1)}`;
  }
}

if (m.key === "__hdr_goalie") {
  headerPct = goalieAvgPct;
  if (headerPct != null) {
    headerText = `GOALTENDING : ${fmtSignedPct(headerPct, 1)}`;
  }
}

headerAnnots.push({
  xref: "paper",
  x: 0.46,
  xanchor: "center",
  yref: "y",
  y: m.label,
  yanchor: "middle",
  text: `<b>${escapeHtml(headerText)}</b>`,
  showarrow: false,
  align: "center",
  font: { size: 18, color: pctColor(headerPct) }
});

  xLeague.push(null);
  xPlayer.push(null);
  hoverText.push("");
  playerColors.push("rgba(0,0,0,0)");
  custom.push(["", "", "", ""]);
  continue;
}


    const p = (m.key === "svp") ? safeNum(playerVals?.svp) : safeNum(playerVals?.[m.key]);
    const lg = (m.key === "svp") ? safeNum(leagueVals?.svp) : safeNum(leagueVals?.[m.key]);

    y.push(m.label);
	tickText.push(m.label);
    let maxVal = (maxes && Number.isFinite(maxes[m.key])) ? maxes[m.key] : 1;

// optional: make SV% ceiling always consistent
if (m.key === "svp") maxVal = 100;
if (m.key === "shp") maxVal = 50;

// keep it sane
maxVal = Math.max(1, maxVal);
const maxAbsDiff = Math.max(
  Math.abs((maxes?.[m.key] ?? 0) - (lg ?? 0)),
  Math.abs(0 - (lg ?? 0))
);


const invLen = INVERT_KEYS_PLAYERBARS.has(m.key);

let lgNormRaw = null;
let pNormRaw = null;

// Special-case: GSAx can be negative.
// Use min = (league min among goalies) - 1 so worst goalie still has a visible bar.
if (role === "GOALIE" && m.key === "gsax_15") {
  const maxG = (maxes && Number.isFinite(maxes[m.key])) ? maxes[m.key] : 1;
  const minG = (mins && Number.isFinite(mins[m.key])) ? (mins[m.key] - 0.5) : -0.5;

  const range = (maxG - minG) || 1;

  lgNormRaw = Number.isFinite(lg) ? ((lg - minG) / range) : null;
  pNormRaw  = Number.isFinite(p)  ? ((p  - minG) / range) : null;
} else {
  // Use dynamic min/max scaling instead of 0→max

let maxV = (maxes && Number.isFinite(maxes[m.key])) ? maxes[m.key] : 1;
let minV = (mins && Number.isFinite(mins[m.key])) ? mins[m.key] : 0;

if (Number.isFinite(p))  { maxV = Math.max(maxV, p);  minV = Math.min(minV, p); }
if (Number.isFinite(lg)) { maxV = Math.max(maxV, lg); minV = Math.min(minV, lg); }

// If inverted, pad the max a bit so the worst value doesn't become exactly 0-width
if (invLen) {
  const pad = Math.max(0.5, (maxV - minV) * 0.05); // tweak 0.5 / 0.05 to taste
  maxV += pad;
}

const range = (maxV - minV) || 1;

  if (Number.isFinite(lg)) {
    lgNormRaw = (lg - minV) / range;
  }

  if (Number.isFinite(p)) {
    pNormRaw = (p - minV) / range;
  }

  // If inverted stat, flip after normalization
  if (invLen) {
    if (lgNormRaw != null) lgNormRaw = 1 - lgNormRaw;
    if (pNormRaw  != null) pNormRaw  = 1 - pNormRaw;
  }
}



const lgNorm = (lgNormRaw == null) ? null : Math.max(0, Math.min(1, lgNormRaw));
const pNorm  = (pNormRaw  == null) ? null : Math.max(0, Math.min(1, pNormRaw));

xLeague.push(lgNorm);
xPlayer.push(pNorm);

    let diff = null;

if (Number.isFinite(p) && Number.isFinite(lg)) {
  const inv = INVERT_KEYS_PLAYERBARS.has(m.key);
  diff = inv ? (lg - p) : (p - lg);
}

playerColors.push(diffToTriColor(diff, maxAbsDiff));

    const pFmt = (p == null) ? "—" : (m.kind === "pct" ? `${p.toFixed(1)}%` : p.toFixed(2));
    const lgFmt = (lg == null) ? "—" : (m.kind === "pct" ? `${lg.toFixed(1)}%` : lg.toFixed(2));

    let diffFmt = "—";

if (diff != null) {
  const rounded = Math.abs(diff) < 0.005 ? 0 : diff;
  diffFmt = `${rounded >= 0 ? "+" : ""}${rounded.toFixed(m.kind === "pct" ? 1 : 2)}`;
}

    custom.push([m.long, pFmt, lgFmt, diffFmt]);
  }

y.reverse();
xLeague.reverse();
xPlayer.reverse();
custom.reverse();
playerColors.reverse();
tickText.reverse();

const traceLeague = {
  type: "bar",
  orientation: "h",
  y,
  x: xLeague,
  customdata: custom,
hovertemplate:
  `<b>%{customdata[0]}</b><br>` +
  `%{customdata[1]} (League Avg: %{customdata[2]})<br>` +
  `<span style="font-weight:700;">%{customdata[3]}</span>` +
  `<extra></extra>`,
hoverlabel: {
  bgcolor: playerColors,   // EXACT same as player bar colors
  font: { color: "#111" }
},
  marker: { color: "rgba(255,255,255,0.20)" },
};

  const tracePlayer = {
    type: "bar",
    orientation: "h",
    y,
    x: xPlayer,
    customdata: custom,
hovertemplate:
  `<b>%{customdata[0]}</b><br>` +
  `%{customdata[1]} (League Avg: %{customdata[2]})<br>` +
  `<span style="font-weight:700;">%{customdata[3]}</span>` +
  `<extra></extra>`,
hoverlabel: {
  bgcolor: playerColors,   // EXACT same as player bar colors
  font: { color: "#111" }
},
    marker: { color: playerColors },
	opacity: 0.5,
  };

  const layout = {
    barmode: "overlay",
    margin: { l: 60, r: 10, t: 10, b: 20 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
xaxis: {
  showgrid: true,
  gridcolor: "rgba(255,255,255,0.08)",
  zeroline: false,
  showticklabels: false,
  fixedrange: true,
  range: [0, 1] // we'll override per-stat below
},
yaxis: {
  showgrid: false,
  tickfont: { size: 12 },
  fixedrange: true,

  tickmode: "array",
  tickvals: y,
  ticktext: tickText
},
    showlegend: false,
	annotations: headerAnnots,
  };

  const config = {
    displayModeBar: false,
    responsive: true,
    scrollZoom: false,
    doubleClick: false
  };
window.Plotly.react(elBarsChart, [traceLeague, tracePlayer], layout, config);
}

function setSegActive(container, role) {
  if (!container) return;
  const btns = container.querySelectorAll(".seg-btn");
  for (const b of btns) b.classList.toggle("active", b.dataset.role === role);
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
async function renderGameLog(seasonId, advOn, stage, teams, schedule, pSeason, players, roleSplitSeason) {
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
  
  // -------- Player Bars chart (under performance chart) --------
try {

  // Only show if adv is on (since we want true /15, not per-GP fallback)
  if (!advOn) {
    if (elBarsStatus) elBarsStatus.textContent = `No stats for Season ${seasonId}.`;
    if (elBarsChart) elBarsChart.innerHTML = "";
  } else if (!window.Plotly) {
    if (elBarsStatus) elBarsStatus.textContent = `Plotly failed to load.`;
    if (elBarsChart) elBarsChart.innerHTML = "";
  } else {
    const league = computeLeagueAveragesFromBoxscores(rows);
    const player = readPlayerPer15FromSeasonRow(pSeason, advOn, roleSplitSeason);
	const seasonPlayers = players; // already loaded earlier in page
	const maxesSkater = computeLeagueMaxesFromPlayers(seasonPlayers, "SKATER", advOn);
	const maxesGoalie = computeLeagueMaxesFromPlayers(seasonPlayers, "GOALIE", advOn);
	const minsGoalie = computeLeagueMinsFromPlayers(seasonPlayers, "GOALIE", advOn);

    const gpS = toIntMaybe(pSeason.gp_s) ?? 0;
    const gpG = toIntMaybe(pSeason.gp_g) ?? 0;
    const isFlex = (gpS > 0 && gpG > 0);

    let role = "SKATER";
    if (!isFlex) {
      role = (gpG > 0 && gpS === 0) ? "GOALIE" : "SKATER";
    } else {
      // default to whichever they played more this season
      role = (gpG > gpS) ? "GOALIE" : "SKATER";
    }

    if (elBarsToggle) {
      elBarsToggle.hidden = !isFlex;
      if (isFlex) {
        // bind once
        if (!elBarsToggle.__wcplBound) {
          elBarsToggle.__wcplBound = true;
          elBarsToggle.addEventListener("click", (ev) => {
            const btn = ev.target?.closest?.(".seg-btn");
            const r = btn?.dataset?.role;
            if (!r) return;
            elBarsToggle.dataset.role = r;
            setSegActive(elBarsToggle, r);
            const teamColor = resolveTeamColorForBars();
            if (r === "GOALIE") {
              renderPlayerBarsChart({
  role: "GOALIE",
  playerVals: player.goalie,
  leagueVals: league.goalie,
  maxes: maxesGoalie,
  mins: minsGoalie,
  teamColor
});
            } else {
              renderPlayerBarsChart({ role: "SKATER", playerVals: player.skater, leagueVals: league.skater, maxes: maxesSkater, teamColor });
            }
          });
        }

        // initial active state
        elBarsToggle.dataset.role = role;
        setSegActive(elBarsToggle, role);
      }
    }

    const teamColor = resolveTeamColorForBars();

    if (elBarsStatus) elBarsStatus.textContent = "";
if (role === "GOALIE") {
  renderPlayerBarsChart({
    role: "GOALIE",
    playerVals: player.goalie,
    leagueVals: league.goalie,
    maxes: maxesGoalie,
    mins: minsGoalie,
    teamColor
  });
} else {
  renderPlayerBarsChart({ role: "SKATER", playerVals: player.skater, leagueVals: league.skater, maxes: maxesSkater, teamColor });
}
  }
} catch (e) {
  console.warn("Player bars chart failed:", e);
  if (elBarsStatus) elBarsStatus.textContent = "Analytics chart unavailable.";
  if (elBarsChart) elBarsChart.innerHTML = "";
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

// Average performance (last N games)
const avgPerf =
  yVals.length > 0
    ? (yVals.reduce((a, b) => a + b, 0) / yVals.length)
    : null;

let avgPerfText;

if (avgPerf == null) {
  avgPerfText = "Average Performance (Last 10 Games): —";
} else {
  const pctStr = `${avgPerf >= 0 ? "+" : ""}${avgPerf.toFixed(1)}%`;
  const color = perfToColor(avgPerf);

  avgPerfText =
    `Average Performance (Last 10 Games): ` +
    `<span style="font-weight:700; color:${color};">${pctStr}</span>`;
}

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
    margin: { l: 0, r: 0, t: 40, b: 0 },
	
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

annotations: [
  {
	align: "center",
    bgcolor: "rgba(0,0,0,0)",
    borderpad: 0,
    text: avgPerfText,
    xref: "paper",
    yref: "paper",
    x: 0.5,
    y: 1.08,
    showarrow: false,
    xanchor: "center",
    yanchor: "bottom",
	captureevents: false,
    font: {
      size: 13,
      color: "#e7e7e7"
    }
  }
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



