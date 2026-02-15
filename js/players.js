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

const elRateMode = document.getElementById("rateMode");


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
  elRateMode?.addEventListener("change", render);

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
  elTeam.innerHTML = `
  <option value="__ALL__">All</option>
  <option value="FREE_AGENT">Free Agents</option>
`;
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
  const rateMode = elRateMode?.value || "TOTAL"; // "TOTAL" | "P15"

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

if (teamId === "FREE_AGENT") {
  // Players with blank team_id in players.csv
  view = view.filter(p => String(p.team_id ?? "").trim() === "");
} else if (teamId !== "__ALL__") {
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

const gDisp = valueMaybePer15(g, p, "SKATER", advOn, rateMode);
const aDisp = valueMaybePer15(toIntMaybe(p.a) ?? 0, p, "SKATER", advOn, rateMode);

const sp = toNumMaybe(p.sp);

const xg = toNumMaybe(p.xG);
const xgDisp = valueMaybePer15(xg, p, "SKATER", advOn, rateMode);

const ptsDisp  = valueMaybePer15(pts, p, "SKATER", advOn, rateMode);
const shotsDisp= valueMaybePer15(shots, p, "SKATER", advOn, rateMode);
const hitsDisp = valueMaybePer15(toIntMaybe(p.hits), p, "SKATER", advOn, rateMode);
const taDisp   = valueMaybePer15(toIntMaybe(p.takeaways), p, "SKATER", advOn, rateMode);
const toDisp   = valueMaybePer15(toIntMaybe(p.turnovers), p, "SKATER", advOn, rateMode);
const spDisp   = valueMaybePer15(sp, p, "SKATER", advOn, rateMode);
const possSeconds = toNumMaybe(p.possession_s);
const possMinutes = (possSeconds != null) ? possSeconds / 60 : null;

// Totals = minutes
// Per 15 = seconds per 15 (normalized)
const possDisp = (rateMode === "P15")
  ? valueMaybePer15(possSeconds, p, "SKATER", advOn, rateMode)
  : possMinutes;

    // Goalie stats
    const gp_g = toIntMaybe(p.gp_g) ?? 0;
    const svp = toNumMaybe(p.sv_pct); // 0-1 in CSV
    const gaa = toNumMaybe(p.gaa);
    const sa = toIntMaybe(p.sa);
    const ga = toIntMaybe(p.ga);
    const sv = (sa != null && ga != null) ? (sa - ga) : null;
	
	const saDisp = valueMaybePer15(sa, p, "GOALIE", advOn, rateMode);
	const gaDisp = valueMaybePer15(ga, p, "GOALIE", advOn, rateMode);
	const svDisp = valueMaybePer15(sv, p, "GOALIE", advOn, rateMode);

	const wRaw  = toIntMaybe(p.wins);
	const soRaw = toIntMaybe(p.so);

	const wDisp  = valueMaybePer15(wRaw, p, "GOALIE", advOn, rateMode);
	const soDisp = valueMaybePer15(soRaw, p, "GOALIE", advOn, rateMode);

	const xga = toNumMaybe(p.xGA);
	const xgaDisp = valueMaybePer15(xga, p, "GOALIE", advOn, rateMode);

	const gsax = (xga != null && ga != null) ? (xga - ga) : null;
	const gsaxDisp = valueMaybePer15(gsax, p, "GOALIE", advOn, rateMode);
	
	

    return {
      player_key: (p.player_key ?? "").trim(),
      name: (p.name ?? "").trim(),
      pos: (p.position ?? "").trim(),
      team_id: (p.team_id ?? "").trim(),

      // skater
      gp_s,
      g,
      gDisp,
      a: toIntMaybe(p.a) ?? 0,
      aDisp,

pts,
ptsDisp,
shots: (shots !== null ? Math.trunc(shots) : null),
shotsDisp,
shRate,

hits: toIntMaybe(p.hits),
hitsDisp,
ta: toIntMaybe(p.takeaways),
taDisp,
to: toIntMaybe(p.turnovers),
toDisp,
possDisp,

xg,
xgDisp,

sp,
spDisp,

      // goalie
      gp_g,
      sa,
	ga,
	sv,
	saDisp,
	gaDisp,
	svDisp,
	
	svp,
	gaa,

	w: wRaw,
	so: soRaw,
	wDisp,
	soDisp,

	  
	  xga,
	xgaDisp,
	gsax,
	gsaxDisp,

      // star points (shown in both modes)
      sp,

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
  if (r.player_key === "name:jurkey") {
    tdTeam.textContent = "Genuine Piece of Shit";
  } else {
    tdTeam.textContent = "Free Agent";
  }
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
      const isPer15 = rateMode === "P15";

	tr.appendChild(tdNumMaybe(r.saDisp, isPer15 ? 2 : null));
	tr.appendChild(tdNumMaybe(r.gaDisp, isPer15 ? 2 : null));
	tr.appendChild(tdNumMaybe(r.svDisp, isPer15 ? 2 : null));
	tr.appendChild(tdPctMaybe(r.svp !== null ? r.svp * 100 : null, 1));
	tr.appendChild(tdNumMaybe(r.gaa, 2));
	tr.appendChild(tdNumMaybe(r.wDisp,  isPer15 ? 2 : null));
	tr.appendChild(tdNumMaybe(r.soDisp, isPer15 ? 2 : null));


	tr.appendChild(tdNumMaybe(r.xgaDisp, 2));
	tr.appendChild(tdNumMaybe(r.gsaxDisp, 2));

	tr.appendChild(tdNumMaybe(r.sp, 1));

} else {
  tr.appendChild(tdNum(r.gp_s));
  const isPer15 = rateMode === "P15";

  tr.appendChild(tdNumMaybe(r.gDisp, isPer15 ? 2 : null));
  tr.appendChild(tdNumMaybe(r.aDisp, isPer15 ? 2 : null));


tr.appendChild(tdNumMaybe(r.ptsDisp, isPer15 ? 2 : null));
tr.appendChild(tdNumMaybe(r.shotsDisp, isPer15 ? 2 : null));
  tr.appendChild(tdPctMaybe(r.shRate !== null ? r.shRate * 100 : null, 1));

  if (advOn) {
tr.appendChild(tdNumMaybe(r.hitsDisp, isPer15 ? 2 : null, true));
tr.appendChild(tdNumMaybe(r.taDisp,   isPer15 ? 2 : null, true));
tr.appendChild(tdNumMaybe(r.toDisp,   isPer15 ? 2 : null, true));
tr.appendChild(tdNumMaybe(r.possDisp, isPer15 ? 1 : 1, true));
  }

tr.appendChild(tdNumMaybe(r.xgDisp, 2));                 // always 2 dp
tr.appendChild(tdNumMaybe(r.spDisp, isPer15 ? 2 : 1));
}

    elTbody.appendChild(tr);
  }

  elTable.hidden = false;
  elStatus.hidden = true;
}

function isSortKeyAllowedForMode(key, mode) {
  if (!key) return false;

  if (mode === "GOALIE") {
    return ["GPG", "SA", "GA", "SV", "SVP", "GAA", "W", "SO", "XGA", "GSAX", "SP"].includes(key);
  }

  return ["GPS", "G", "A", "PTS", "S", "SH", "HIT", "TA", "TO", "POSS", "XG", "SP"].includes(key);
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
	  case "XGA":  return (r.xgaDisp == null ? null : r.xgaDisp);
	  case "GSAX": return (r.gsaxDisp == null ? null : r.gsaxDisp);
      case "SP":  return (r.sp == null ? null : r.sp);
      default:    return null;
    }
  }

// SKATER
switch (key) {
  case "GPS":  return r.gp_s ?? 0;
  case "G":    return r.g ?? 0;
  case "A":    return r.a ?? 0;

  // Sort by displayed value (Totals or Per15)
  case "PTS":  return (r.ptsDisp == null ? null : r.ptsDisp);
  case "S":    return (r.shotsDisp == null ? null : r.shotsDisp);

  // still a rate
  case "SH":   return (r.shRate == null ? null : r.shRate);

  // Sort by displayed adv values
  case "HIT":  return (r.hitsDisp == null ? null : r.hitsDisp);
  case "TA":   return (r.taDisp   == null ? null : r.taDisp);
  case "TO":   return (r.toDisp   == null ? null : r.toDisp);
  case "POSS": return (r.possDisp == null ? null : r.possDisp);
  case "XG":   return (r.xgDisp == null ? null : r.xgDisp);
  case "SP":   return (r.spDisp == null ? null : r.spDisp);
  default:     return null;
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
	  { label: "xGA", cls: "num", key: "XGA" },
	  { label: "GSAx", cls: "num", key: "GSAX" },
      { label: "SP", cls: "num", key: "SP" },
    );
  } else {
    cols.push(
  { label: "GP", cls: "num", key: "GPS" },
  { label: "G", cls: "num", key: "G" },
  { label: "A", cls: "num", key: "A" },
  { label: "PTS", cls: "num", key: "PTS" },
  { label: "S", cls: "num", key: "S" },
  { label: "SH%", cls: "num", key: "SH" },
);

if (advOn) {
cols.push(
  { label: "HIT", cls: "num adv", key: "HIT" },
  { label: "TA",  cls: "num adv", key: "TA"  },
  { label: "TO",  cls: "num adv", key: "TO"  },
  {
  label: (elRateMode?.value === "P15") ? "Poss (s)" : "Poss (m)",
  cls: "num adv",
  key: "POSS"
},
);
}

// SP columns always at the very end
cols.push(
  { label: "xG", cls: "num", key: "XG" },
  { label: "SP", cls: "num", key: "SP" },
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
function valueMaybePer15(total, rawRow, scope, advOn, rateMode){
  if (total == null) return null;
  if (rateMode !== "P15") return total;
  if (!advOn) return total;

  return perGpNormalized(total, rawRow, scope, true);
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

