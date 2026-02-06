import { loadCSV, toIntMaybe, toNumMaybe } from "./data.js";
import { initSeasonPicker, getSeasonId, onSeasonChange, saveStage, playoffsHaveBegun, applyDefaultStage } from "./season.js";

const elSeason = document.getElementById("seasonSelect");
const elStatus = document.getElementById("status");
const elStage = document.getElementById("stageSelect");

const elPos = document.getElementById("posFilter");
const elTeam = document.getElementById("teamFilter");
const elConf = document.getElementById("confFilter");
const elMinGP = document.getElementById("minGP");

const elTable = document.getElementById("playersTable");
const elTbody = elTable.querySelector("tbody");
const elThead = elTable.querySelector("thead");

let advOn = false;

let seasons = [];
let teams = [];
let players = [];

// Click-sort state (Teams-style)
let sortKey = null;
let sortDir = "desc"; // "desc" | "asc"

boot();

async function boot() {
  await initSeasonPicker(elSeason);

  wireFilters();
  onSeasonChange(() => refresh());

  await refresh();
}

function wireFilters() {
  elPos.addEventListener("change", () => {
    setDefaultSortForMode(elPos.value);
    render();
  });
elStage.addEventListener("change", () => {
  saveStage(elStage.value, getSeasonId());
  refresh();
});
  elTeam.addEventListener("change", render);
  elConf.addEventListener("change", render);
  elMinGP.addEventListener("input", render);

  // Click-to-sort on headers
  elThead.addEventListener("click", (e) => {
    const th = e.target.closest("th");
    if (!th) return;

    const key = th.dataset.key;
    if (!key) return; // non-sortable header

    if (sortKey === key) {
      sortDir = (sortDir === "desc") ? "asc" : "desc";
    } else {
      sortKey = key;
      sortDir = "desc";
    }

    render();
  });
}

async function urlExists(url) {
  // Try HEAD first (fast); fall back to GET if HEAD is blocked by the host.
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

  // If playoffs is selected but not available, force back to regular
  if (!enabled && elStage.value === "PO") elStage.value = "REG";
}

async function refresh() {
  const seasonId = getSeasonId();
  const schedPath = `../data/${seasonId}/schedule.csv`;
  if (!seasonId) {
    setLoading(true, "No season found in seasons.csv.");
    return;
  }

  setLoading(true, `Loading ${seasonId}…`);

  try {
    const seasonsPath = `../data/seasons.csv`;
    const teamsPath = `../data/${seasonId}/teams.csv`;

    const regularPlayersPath = `../data/${seasonId}/players.csv`;
    const playoffPlayersPath = `../data/${seasonId}/players_playoffs.csv`;

    // Load seasons + teams first (needed for filters + theming)
    [seasons, teams] = await Promise.all([
      loadCSV(seasonsPath),
      loadCSV(teamsPath),
    ]);

    buildTeamOptions(teams);
    buildConfOptions(teams);

    // adv_stats toggle like team.js
    const seasonRow = seasons.find(s => String(s.season_id ?? "").trim() === seasonId);
    advOn = (toIntMaybe(seasonRow?.adv_stats) ?? 0) === 1;
    document.body.classList.toggle("hide-adv", !advOn);

    // Detect if playoffs CSV exists for this season; disable option if not.
    const hasPlayoffs = await urlExists(playoffPlayersPath);
    setPlayoffsOptionEnabled(hasPlayoffs);
const schedule = await loadCSV(schedPath).catch(() => []);
const playoffsBegun = playoffsHaveBegun(schedule);
applyDefaultStage(elStage, seasonId, {
  playoffsEnabled: hasPlayoffs,
  playoffsBegun
});

    // Decide which players file to load
    const stage = elStage.value; // "REG" | "PO"
    const playersPath = (stage === "PO" && hasPlayoffs)
      ? playoffPlayersPath
      : regularPlayersPath;

    // Now load players
    players = await loadCSV(playersPath);

    // Default sort based on current mode
    setDefaultSortForMode(elPos.value);

    setLoading(false);
    render();
  } catch (err) {
    console.error(err);
    setLoading(true, `No data exists for Season ${getSeasonId()}.`);
    elTable.hidden = true;
  }
}

function setDefaultSortForMode(mode) {
  if (mode === "GOALIE") {
    sortKey = "SVP";   // SV% default
    sortDir = "desc";
  } else {
    sortKey = "PTS";   // PTS default
    sortDir = "desc";
  }
}

function buildTeamOptions(teamRows) {
  const opts = new Set();
  for (const t of teamRows) {
    const id = (t.team_id ?? "").trim();
    if (id) opts.add(id);
  }

  const current = elTeam.value || "__ALL__";
  elTeam.innerHTML = `<option value="__ALL__">All</option>`;
  [...opts]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .forEach(id => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      elTeam.appendChild(opt);
    });

  if ([...elTeam.options].some(o => o.value === current)) elTeam.value = current;
}

function buildConfOptions(teamRows) {
  const opts = new Set();
  for (const t of teamRows) {
    const c = String(t.conference ?? "").trim();
    if (c) opts.add(c);
  }

  const current = elConf.value || "__ALL__";
  elConf.innerHTML = `<option value="__ALL__">All</option>`;

  [...opts]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .forEach(c => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      elConf.appendChild(opt);
    });

  if ([...elConf.options].some(o => o.value === current)) elConf.value = current;
}

function render() {
  const seasonId = getSeasonId();
  const mode = elPos.value;          // "SKATER" or "GOALIE"
  const teamId = elTeam.value;       // "__ALL__" or team_id
  const conf = elConf.value;         // "__ALL__" or conference name
  const minGP = Math.max(0, parseInt(elMinGP.value || "0", 10) || 0);

  const teamById = new Map(teams.map(t => [String(t.team_id ?? "").trim(), t]));

  // --- filter ---
  let view = players.slice();

  if (conf !== "__ALL__") {
    view = view.filter(p => {
      const t = teamById.get(String(p.team_id ?? "").trim());
      return String(t?.conference ?? "").trim() === conf;
    });
  }

  // Min GP depends on mode
  if (mode === "GOALIE") {
    // GOALIE: min GP at goalie + exclude pure skaters
    view = view.filter(p =>
      (toIntMaybe(p.gp_g) ?? 0) >= minGP &&
      String(p.position ?? "").trim().toUpperCase() !== "S"
    );
  } else {
    // SKATER: min GP at skater + exclude pure goalies
    view = view.filter(p =>
      (toIntMaybe(p.gp_s) ?? 0) >= minGP &&
      String(p.position ?? "").trim().toUpperCase() !== "G"
    );
  }

  if (teamId !== "__ALL__") {
    view = view.filter(p => String(p.team_id ?? "").trim() === teamId);
  }

  // --- map/decorate ---
  const rows = view.map(p => {
    const g = toIntMaybe(p.g) ?? 0;

    // Shots + SH% (store as rate for sorting, percent for display)
    const shotsRaw = (p.shots ?? "").toString().trim();
    const shotsVal = shotsRaw === "" ? null : Number(shotsRaw);
    const shots = Number.isFinite(shotsVal) ? shotsVal : null;
    const shRate = (shots !== null && shots > 0) ? (g / shots) : null; // 0-1

const gp_s = toIntMaybe(p.gp_s) ?? 0;
const pts  = toIntMaybe(p.pts) ?? 0;

const ppgCsv = toNumMaybe(p.p_per_gp);
const ppg = (ppgCsv != null && Number.isFinite(ppgCsv))
  ? ppgCsv
  : perGpNormalized(pts, p, "SKATER", advOn);

const sp = toNumMaybe(p.sp);
const spgCsv = toNumMaybe(p.sp_per_gp);
const spg = (spgCsv != null && Number.isFinite(spgCsv))
  ? spgCsv
  : perGpNormalized(sp, p, "SKATER", advOn);

    // Goalie stats
    const gp_g = toIntMaybe(p.gp_g) ?? 0;
    const svp = toNumMaybe(p.sv_pct); // 0-1 in CSV
    const gaa = toNumMaybe(p.gaa);
    const sa = toIntMaybe(p.sa);
    const ga = toIntMaybe(p.ga);
    const sv = (sa != null && ga != null) ? (sa - ga) : null;

    return {
      player_key: (p.player_key ?? "").trim(),
      name: (p.name ?? "").trim(),
      pos: (p.position ?? "").trim(),
      team_id: (p.team_id ?? "").trim(),

      // skater
      gp_s,
      g,
      a: toIntMaybe(p.a) ?? 0,
      pts,
      ppg,
      shots: (shots !== null ? Math.trunc(shots) : null),
      shRate,

      // adv (skater)
      hits: toIntMaybe(p.hits),
      ta: toIntMaybe(p.takeaways),
      to: toIntMaybe(p.turnovers),

      // goalie
      gp_g,
      sa,
      ga,
      sv,
      svp, // 0-1
      gaa,
      w: toIntMaybe(p.wins),
      so: toIntMaybe(p.so),

      // star points (shown in both modes)
      sp,
      spg,

      team: teamById.get((p.team_id ?? "").trim()),
    };
  });

  // --- sort (click headers) ---
  if (!isSortKeyAllowedForMode(sortKey, mode)) {
    setDefaultSortForMode(mode);
  }
  rows.sort((a, b) => compareByKey(a, b, sortKey, sortDir, mode));

  // --- header + body ---
  renderHeader(mode, advOn);
  updateSortIndicators();

  elTbody.innerHTML = "";

  for (const r of rows) {
    const tr = document.createElement("tr");

    // Logo cell
    const tdLogo = document.createElement("td");
    tdLogo.className = "logo-cell";
    if (r.team?.bg_color) tdLogo.style.backgroundColor = r.team.bg_color;

    const img = document.createElement("img");
    img.className = "logo";
    img.loading = "lazy";

    if (!r.team_id) {
      img.style.visibility = "hidden";
    } else {
      img.alt = `${r.team_id} logo`;
      img.src = `../logos/${seasonId}/${r.team_id}.png`;
      img.onerror = () => (img.style.visibility = "hidden");
    }

    tdLogo.appendChild(img);

    // Player link
    const tdPlayer = document.createElement("td");
    const aPlayer = document.createElement("a");
    aPlayer.className = "team-link";
    aPlayer.href = `player.html?season=${encodeURIComponent(seasonId)}&player_key=${encodeURIComponent(r.player_key)}`;
    aPlayer.textContent = r.name;
    tdPlayer.appendChild(aPlayer);

    // Team link
    const tdTeam = document.createElement("td");
    if (!r.team_id) {
      tdTeam.textContent = "Free Agent";
    } else {
      const aTeam = document.createElement("a");
      aTeam.className = "team-link";
      aTeam.href = `team.html?season=${encodeURIComponent(seasonId)}&team_id=${encodeURIComponent(r.team_id)}`;
      aTeam.textContent = r.team_id;
      tdTeam.appendChild(aTeam);
    }

    tr.appendChild(tdLogo);
    tr.appendChild(tdPlayer);
    tr.appendChild(td(r.pos));
    tr.appendChild(tdTeam);

    if (mode === "GOALIE") {
      tr.appendChild(tdNum(r.gp_g));
      tr.appendChild(tdNumMaybe(r.sa));
      tr.appendChild(tdNumMaybe(r.ga));
      tr.appendChild(tdNumMaybe(r.sv));
      tr.appendChild(tdPctMaybe(r.svp !== null ? r.svp * 100 : null, 1));
      tr.appendChild(tdNumMaybe(r.gaa, 2));
      tr.appendChild(tdNumMaybe(r.w));
      tr.appendChild(tdNumMaybe(r.so));
      tr.appendChild(tdNumMaybe(r.sp, 1));
      tr.appendChild(tdNumMaybe(r.spg, 2));
    } else {
tr.appendChild(tdNum(r.gp_s));
tr.appendChild(tdNum(r.g));
tr.appendChild(tdNum(r.a));
tr.appendChild(tdNum(r.pts));
tr.appendChild(tdNumMaybe(r.ppg, 2));
tr.appendChild(tdNumMaybe(r.shots));
tr.appendChild(tdPctMaybe(r.shRate !== null ? r.shRate * 100 : null, 1));

if (advOn) {
  tr.appendChild(tdNumMaybe(r.hits, null, true));
  tr.appendChild(tdNumMaybe(r.ta, null, true));
  tr.appendChild(tdNumMaybe(r.to, null, true));
}

// SP columns at the very end
tr.appendChild(tdNumMaybe(r.sp, 1));
tr.appendChild(tdNumMaybe(r.spg, 2));
    }

    elTbody.appendChild(tr);
  }

  elTable.hidden = false;
  elStatus.hidden = true;
}

function isSortKeyAllowedForMode(key, mode) {
  if (!key) return false;

  if (mode === "GOALIE") {
    return ["GPG", "SA", "GA", "SV", "SVP", "GAA", "W", "SO", "SP", "SPPG"].includes(key);
  }
  return ["GPS", "G", "A", "PTS", "PPG", "S", "SH", "SP", "SPPG"].includes(key);
}

function compareByKey(a, b, key, dir, mode) {
  const av = getSortValue(a, key, mode);
  const bv = getSortValue(b, key, mode);

  const aNull = (av == null || Number.isNaN(av));
  const bNull = (bv == null || Number.isNaN(bv));

  // null/blank always at bottom
  if (aNull && bNull) return tieBreak(a, b);
  if (aNull) return 1;
  if (bNull) return -1;

  const diff = bv - av; // default desc
  const out = (dir === "desc") ? diff : -diff;

  if (out !== 0) return out;
  return tieBreak(a, b);
}

function tieBreak(a, b) {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function getSortValue(r, key, mode) {
  if (mode === "GOALIE") {
    switch (key) {
      case "GPG": return r.gp_g ?? 0;
      case "SA":  return (r.sa == null ? null : r.sa);
      case "GA":  return (r.ga == null ? null : r.ga);
      case "SV":  return (r.sv == null ? null : r.sv);
      case "SVP": return (r.svp == null ? null : r.svp); // 0-1
      case "GAA": return (r.gaa == null ? null : r.gaa);
      case "W":   return (r.w == null ? null : r.w);
      case "SO":  return (r.so == null ? null : r.so);
      case "SP":  return (r.sp == null ? null : r.sp);
      case "SPPG":return (r.spg == null ? null : r.spg);
      default:    return null;
    }
  }

  // SKATER
  switch (key) {
    case "GPS": return r.gp_s ?? 0;
    case "G":   return r.g ?? 0;
    case "A":   return r.a ?? 0;
    case "PTS": return r.pts ?? 0;
    case "PPG": return (r.ppg == null ? null : r.ppg);
    case "S":   return (r.shots == null ? null : r.shots);
    case "SH":  return (r.shRate == null ? null : r.shRate); // 0-1
	case "SP":  return (r.sp == null ? null : r.sp);
    case "SPPG":return (r.spg == null ? null : r.spg);
    default:    return null;
  }
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

/* ------------------------- table helpers ------------------------- */

function td(v) {
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

function tdPctMaybe(v, decimals = 1) {
  const td = document.createElement("td");
  td.className = "num";

  if (v === null || v === undefined || v === "") {
    td.textContent = "";
    return td;
  }

  const n = Number(v);
  if (!Number.isFinite(n)) {
    td.textContent = "";
    return td;
  }

  td.textContent = n.toFixed(decimals);
  return td;
}

function setLoading(isLoading, msg = "") {
  elStatus.hidden = !isLoading;
  elStatus.textContent = msg;
  elTable.hidden = isLoading;
}

function renderHeader(mode, advOn) {
  const cols = [];

  // Common (not sortable)
  cols.push({ label: "", cls: "" });
  cols.push({ label: "Player", cls: "left" });
  cols.push({ label: "Pos", cls: "left" });
  cols.push({ label: "Team", cls: "left" });

  if (mode === "GOALIE") {
    cols.push(
      { label: "GP", cls: "num", key: "GPG" },
      { label: "SA", cls: "num", key: "SA" },
      { label: "GA", cls: "num", key: "GA" },
      { label: "Sv", cls: "num", key: "SV" },
      { label: "SV%", cls: "num", key: "SVP" },
      { label: "GAA", cls: "num", key: "GAA" },
      { label: "W", cls: "num", key: "W" },
      { label: "SO", cls: "num", key: "SO" },
      { label: "SP", cls: "num", key: "SP" },
      { label: "SP/GP", cls: "num", key: "SPPG" },
    );
  } else {
    cols.push(
  { label: "GP", cls: "num", key: "GPS" },
  { label: "G", cls: "num", key: "G" },
  { label: "A", cls: "num", key: "A" },
  { label: "PTS", cls: "num", key: "PTS" },
  { label: "P/GP", cls: "num", key: "PPG" },
  { label: "S", cls: "num", key: "S" },
  { label: "SH%", cls: "num", key: "SH" },
);

if (advOn) {
  cols.push(
    { label: "HIT", cls: "num adv" },
    { label: "TA", cls: "num adv" },
    { label: "TO", cls: "num adv" },
  );
}

// SP columns always at the very end
cols.push(
  { label: "SP", cls: "num", key: "SP" },
  { label: "SP/GP", cls: "num", key: "SPPG" },
);
  }

  const tr = document.createElement("tr");
  for (const c of cols) {
    const th = document.createElement("th");
    th.textContent = c.label;
    if (c.cls) th.className = c.cls;
    if (c.key) th.dataset.key = c.key; // sortable headers only
    tr.appendChild(th);
  }

  elThead.innerHTML = "";
  elThead.appendChild(tr);
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

