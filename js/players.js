import { loadCSV, toIntMaybe, toNumMaybe } from "./data.js";
import { initSeasonPicker, getSeasonId, onSeasonChange, saveStage, playoffsHaveBegun, applyDefaultStage, getDataPath, getLogoPath } from "./season.js";

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
let boxscores = [];


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

function normalizeName(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function isGoalieBoxRow(r) {
  const pos = String(r.position ?? "").trim().toUpperCase();
  if (pos === "G") return true;
  const sa = toIntMaybe(r.sa);
  const ga = toIntMaybe(r.ga);
  return (sa != null || ga != null);
}

function computeRoleSplitFromBoxscores(boxRows, pSeason) {
  const playerSteam =
    String(pSeason.steam_id ?? pSeason.steamid ?? pSeason.steamID ?? pSeason.steam ?? pSeason.steam64 ?? "").trim();
  const playerNameNorm = normalizeName(pSeason.name);

  function isMe(r) {
    const rSteam = String(
      r.steam_id ?? r.steamid ?? r.steamID ?? r.steam ?? r.steam64 ?? ""
    ).trim();

    if (playerSteam && rSteam && rSteam === playerSteam) return true;

    const rowNameNorm = normalizeName(
      r.player_name ?? r.name ?? r.player ?? r.playerName ?? ""
    );

    return rowNameNorm && playerNameNorm && rowNameNorm === playerNameNorm;
  }

  function addNum(bucket, key, val) {
    bucket[key] = (bucket[key] ?? 0) + (toNumMaybe(val) ?? 0);
  }

  const out = {
    skater: {
      g: 0, a: 0, pts: 0,
      shots: 0,
      passes: 0,
      entries: 0,
      exits: 0,
      takeaways: 0,
      turnovers: 0,
      hits: 0,
      blocks: 0,
      xG: 0,
      sp: 0,
      possession_s: 0,
      toi: 0
    },
    goalie: {
      pts: 0,
      passes: 0,
      sa: 0,
      ga: 0,
      xGA: 0,
      wins: 0,
      so: 0,
      sp: 0,
      toi: 0
    }
  };

  for (const r of (boxRows || [])) {
    if (!isMe(r)) continue;

    const isG = isGoalieBoxRow(r);
    const bucket = isG ? out.goalie : out.skater;

    if (isG) {
      addNum(bucket, "pts", (toNumMaybe(r.g) ?? 0) + (toNumMaybe(r.a) ?? 0));
      addNum(bucket, "passes", r.passes);
      addNum(bucket, "sa", r.sa);
      addNum(bucket, "ga", r.ga);
      addNum(bucket, "xGA", r.xGA ?? r.xga);
      addNum(bucket, "wins", r.w ?? r.wins);
      addNum(bucket, "so", r.so);
      addNum(bucket, "sp", r.sp);
      addNum(bucket, "toi", r.toi_g ?? r.toi_s ?? r.toi);
    } else {
      addNum(bucket, "g", r.g);
      addNum(bucket, "a", r.a);
      addNum(bucket, "pts", (toNumMaybe(r.g) ?? 0) + (toNumMaybe(r.a) ?? 0));
      addNum(bucket, "shots", r.shots);
      addNum(bucket, "passes", r.passes);
      addNum(bucket, "entries", r.entries);
      addNum(bucket, "exits", r.exits);
      addNum(bucket, "takeaways", r.takeaways);
      addNum(bucket, "turnovers", r.turnovers);
      addNum(bucket, "hits", r.hits);
      addNum(bucket, "blocks", r.blocks);
      addNum(bucket, "xG", r.xG ?? r.xg);
      addNum(bucket, "sp", r.sp);
      addNum(bucket, "possession_s", r.possession_s ?? r.possession ?? r.poss_s ?? r.poss);
      addNum(bucket, "toi", r.toi_s ?? r.toi);
    }
  }

  return out;
}

function getFlexSplitForPlayer(p) {
  const gpS = toIntMaybe(p.gp_s) ?? 0;
  const gpG = toIntMaybe(p.gp_g) ?? 0;
  if (!(gpS > 0 && gpG > 0)) return null;
  return computeRoleSplitFromBoxscores(boxscores, p);
}

function per15WithToi(total, toi) {
  const t = toNumMaybe(total);
  const secs = toNumMaybe(toi);
  if (t == null || secs == null || secs <= 0) return null;
  return t * 900 / secs;
}

async function refresh() {
  const seasonId = getSeasonId();
  const schedPath = getDataPath("schedule.csv", seasonId);
  if (!seasonId) {
    setLoading(true, "No season found in seasons.csv.");
    return;
  }

  setLoading(true, `Loading ${seasonId}…`);

  try {
    const seasonsPath = `../data/seasons.csv`;
    const teamsPath = getDataPath("teams.csv", seasonId);

    const regularPlayersPath = getDataPath("players.csv", seasonId);
    const playoffPlayersPath = getDataPath("players_playoffs.csv", seasonId);

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

// Build match_id -> stage map
const matchStage = new Map();

for (const s of schedule) {
  const mid = String(s.match_id ?? "").trim();
  const st = String(s.stage ?? "").trim().toLowerCase();

  if (mid && st) {
    matchStage.set(mid, st);
  }
}



    // Decide which players file to load
    const stage = elStage.value; // "REG" | "PO"
    const playersPath = (stage === "PO" && hasPlayoffs)
      ? playoffPlayersPath
      : regularPlayersPath;
	  
	  	const boxscoresPath = getDataPath("boxscores.csv", seasonId);

    // Now load players
[players, boxscores] = await Promise.all([
  loadCSV(playersPath),
  loadCSV(boxscoresPath).catch(() => [])
]);

// Filter boxscores based on selected stage
const stageKey = (stage === "PO") ? "po" : "reg";

boxscores = boxscores.filter(r => {
  const mid = String(r.match_id ?? "").trim();
  const st = matchStage.get(mid);

  if (!st) return false;

  if (stageKey === "reg") {
    return st === "reg";
  }

  // playoffs view
  return st === "qf" || st === "sf" || st === "f";
});

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
	  const roleSplit = getFlexSplitForPlayer(p);
const skToi = roleSplit ? toNumMaybe(roleSplit.skater.toi) : toNumMaybe(p.toi_s ?? p.toi);
const gkToi = roleSplit ? toNumMaybe(roleSplit.goalie.toi) : toNumMaybe(p.toi_g ?? p.toi);
const gp_s = toIntMaybe(p.gp_s) ?? 0;

const g = roleSplit ? (toNumMaybe(roleSplit.skater.g) ?? 0) : (toIntMaybe(p.g) ?? 0);
const aRaw = roleSplit ? (toNumMaybe(roleSplit.skater.a) ?? 0) : (toIntMaybe(p.a) ?? 0);
const pts  = roleSplit ? (toNumMaybe(roleSplit.skater.pts) ?? 0) : (toIntMaybe(p.pts) ?? 0);

const shots = roleSplit ? toNumMaybe(roleSplit.skater.shots) : (() => {
  const shotsRaw = (p.shots ?? "").toString().trim();
  const shotsVal = shotsRaw === "" ? null : Number(shotsRaw);
  return Number.isFinite(shotsVal) ? shotsVal : null;
})();

const shRate = (shots !== null && shots > 0) ? (g / shots) : null;

const sp = roleSplit ? toNumMaybe(roleSplit.skater.sp) : toNumMaybe(p.sp);
const xg = roleSplit ? toNumMaybe(roleSplit.skater.xG) : toNumMaybe(p.xG);
const gfax = (xg != null) ? (g - xg) : null;

const hitsRaw = roleSplit ? toNumMaybe(roleSplit.skater.hits) : toIntMaybe(p.hits);
const blocksRaw = roleSplit ? toNumMaybe(roleSplit.skater.blocks) : toIntMaybe(p.blocks);
const passesRaw = roleSplit ? toNumMaybe(roleSplit.skater.passes) : toIntMaybe(p.passes);
const taRaw = roleSplit ? toNumMaybe(roleSplit.skater.takeaways) : toIntMaybe(p.takeaways);
const toRaw = roleSplit ? toNumMaybe(roleSplit.skater.turnovers) : toIntMaybe(p.turnovers);
const entriesRaw = roleSplit ? toNumMaybe(roleSplit.skater.entries) : toIntMaybe(p.entries);
const exitsRaw = roleSplit ? toNumMaybe(roleSplit.skater.exits) : toIntMaybe(p.exits);
const possSeconds = roleSplit ? toNumMaybe(roleSplit.skater.possession_s) : toNumMaybe(p.possession_s);

const gDisp      = (rateMode === "P15") ? per15WithToi(g, skToi) : g;
const aDisp      = (rateMode === "P15") ? per15WithToi(aRaw, skToi) : aRaw;
const ptsDisp    = (rateMode === "P15") ? per15WithToi(pts, skToi) : pts;
const shotsDisp  = (rateMode === "P15") ? per15WithToi(shots, skToi) : shots;
const hitsDisp   = (rateMode === "P15") ? per15WithToi(hitsRaw, skToi) : hitsRaw;
const blocksDisp = (rateMode === "P15") ? per15WithToi(blocksRaw, skToi) : blocksRaw;
const passesDisp = (rateMode === "P15") ? per15WithToi(passesRaw, skToi) : passesRaw;
const taDisp     = (rateMode === "P15") ? per15WithToi(taRaw, skToi) : taRaw;
const toDisp     = (rateMode === "P15") ? per15WithToi(toRaw, skToi) : toRaw;
const xgDisp     = (rateMode === "P15") ? per15WithToi(xg, skToi) : xg;
const gfaxDisp   = (rateMode === "P15") ? per15WithToi(gfax, skToi) : gfax;
const spDisp     = (rateMode === "P15") ? per15WithToi(sp, skToi) : sp;

const possDisp = (rateMode === "P15")
  ? per15WithToi(possSeconds, skToi)
  : (possSeconds != null ? possSeconds / 60 : null);

    // Goalie stats
const gp_g = toIntMaybe(p.gp_g) ?? 0;

const sa = roleSplit ? toNumMaybe(roleSplit.goalie.sa) : toIntMaybe(p.sa);
const ga = roleSplit ? toNumMaybe(roleSplit.goalie.ga) : toIntMaybe(p.ga);
const sv = (sa != null && ga != null) ? (sa - ga) : null;

const svp = (sa != null && sa > 0 && sv != null)
  ? (sv / sa)
  : toNumMaybe(p.sv_pct);

const gaa = (ga != null && gkToi != null && gkToi > 0)
  ? (ga * 900 / gkToi)
  : toNumMaybe(p.gaa);

const wRaw  = roleSplit ? toNumMaybe(roleSplit.goalie.wins) : toIntMaybe(p.wins);
const soRaw = roleSplit ? toNumMaybe(roleSplit.goalie.so) : toIntMaybe(p.so);
const goaliePtsRaw = roleSplit ? toNumMaybe(roleSplit.goalie.pts) : toIntMaybe(p.pts);
const xga = roleSplit ? toNumMaybe(roleSplit.goalie.xGA) : toNumMaybe(p.xGA);
const gsax = (xga != null && ga != null) ? (xga - ga) : null;

const saDisp   = (rateMode === "P15") ? per15WithToi(sa, gkToi) : sa;
const gaDisp   = (rateMode === "P15") ? per15WithToi(ga, gkToi) : ga;
const svDisp   = (rateMode === "P15") ? per15WithToi(sv, gkToi) : sv;
const wDisp    = (rateMode === "P15") ? per15WithToi(wRaw, gkToi) : wRaw;
const soDisp   = (rateMode === "P15") ? per15WithToi(soRaw, gkToi) : soRaw;
const xgaDisp  = (rateMode === "P15") ? per15WithToi(xga, gkToi) : xga;
const gsaxDisp = (rateMode === "P15") ? per15WithToi(gsax, gkToi) : gsax;
	
	

    return {
      player_key: (p.player_key ?? "").trim(),
      name: (p.name ?? "").trim(),
      pos: (p.position ?? "").trim(),
      team_id: (p.team_id ?? "").trim(),

      // skater
            gp_s,
      g,
      gDisp,
      a: aRaw,
      aDisp,

      pts,
      ptsDisp,
      shots: (shots !== null ? Math.trunc(shots) : null),
      shotsDisp,
      shRate,

      hits: hitsRaw,
      hitsDisp,
      blocks: blocksRaw,
      blocksDisp,
      passes: passesRaw,
      passesDisp,
      ta: taRaw,
      taDisp,
      to: toRaw,
      toDisp,
      possDisp,

      xg,
      xgDisp,

      gfax,
      gfaxDisp,

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
      img.src = getLogoPath(r.team_id, seasonId);
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
	tr.appendChild(tdNumMaybe(r.ptsDisp, isPer15 ? 2 : null));
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
tr.appendChild(tdNumMaybe(r.blocksDisp, isPer15 ? 2 : null, true));
tr.appendChild(tdNumMaybe(r.passesDisp, isPer15 ? 2 : null, true));
tr.appendChild(tdNumMaybe(r.taDisp,   isPer15 ? 2 : null, true));
tr.appendChild(tdNumMaybe(r.toDisp,   isPer15 ? 2 : null, true));
tr.appendChild(tdNumMaybe(r.possDisp, isPer15 ? 1 : 1, true));
  }

tr.appendChild(tdNumMaybe(r.xgDisp, 2));                 // always 2 dp
tr.appendChild(tdNumMaybe(r.gfaxDisp, 2));
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
    return ["GPG", "SA", "GA", "SV", "SVP", "GAA", "PTS", "W", "SO", "XGA", "GSAX", "SP"].includes(key);
  }

  return ["GPS", "G", "A", "PTS", "S", "SH", "HIT", "BLK", "PASS", "TA", "TO", "POSS", "XG", "GFAX", "SP"].includes(key);
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

      case "SA":  return (r.saDisp == null ? null : r.saDisp);
      case "GA":  return (r.gaDisp == null ? null : r.gaDisp);
      case "SV":  return (r.svDisp == null ? null : r.svDisp);
      case "W":   return (r.wDisp  == null ? null : r.wDisp);
      case "SO":  return (r.soDisp == null ? null : r.soDisp);
      case "SVP": return (r.svp == null ? null : r.svp); // 0-1
      case "GAA": return (r.gaa == null ? null : r.gaa);
	  case "PTS": return (r.ptsDisp == null ? null : r.ptsDisp);
      case "XGA":  return (r.xgaDisp == null ? null : r.xgaDisp);
      case "GSAX": return (r.gsaxDisp == null ? null : r.gsaxDisp);
      case "SP":  return (r.spDisp == null ? null : r.spDisp);

      default:    return null;
    }
  }

  // SKATER
  switch (key) {
    case "GPS": return r.gp_s ?? 0;


    case "G":   return (r.gDisp == null ? null : r.gDisp);
    case "A":   return (r.aDisp == null ? null : r.aDisp);
    case "PTS":  return (r.ptsDisp == null ? null : r.ptsDisp);
    case "S":    return (r.shotsDisp == null ? null : r.shotsDisp);
    case "SH":   return (r.shRate == null ? null : r.shRate);
    case "HIT":  return (r.hitsDisp == null ? null : r.hitsDisp);
	case "BLK":  return (r.blocksDisp == null ? null : r.blocksDisp);
	case "PASS": return (r.passesDisp == null ? null : r.passesDisp);
    case "TA":   return (r.taDisp   == null ? null : r.taDisp);
    case "TO":   return (r.toDisp   == null ? null : r.toDisp);
    case "POSS": return (r.possDisp == null ? null : r.possDisp);
    case "XG":   return (r.xgDisp   == null ? null : r.xgDisp);
    case "GFAX": return (r.gfaxDisp == null ? null : r.gfaxDisp);
    case "SP":   return (r.spDisp   == null ? null : r.spDisp);

    default: return null;
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
	  { label: "PTS", cls: "num", key: "PTS" },
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
  { label: "BLK", cls: "num adv", key: "BLK" },
  { label: "PASS", cls: "num adv", key: "PASS" },
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
  { label: "GFAx", cls: "num", key: "GFAX" },
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

