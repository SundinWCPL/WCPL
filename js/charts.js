// js/charts.js
import { loadCSV, toNumMaybe, toIntMaybe, truthy01 } from "./data.js";
import { initSeasonPicker, getSeasonId, onSeasonChange, withSeason } from "./season.js";

/* ---------------------------
   DOM
--------------------------- */
const elSeason = document.getElementById("seasonSelect");
const elStatus = document.getElementById("status");

const elMode   = document.getElementById("modeSelect");
const elStage  = document.getElementById("stageSelect");
const elX      = document.getElementById("xSelect");
const elY      = document.getElementById("ySelect");
const elColor  = document.getElementById("colorSelect");
const elMinGP  = document.getElementById("minGpInput");
const elTrend  = document.getElementById("trendlineToggle");

const elChart  = document.getElementById("chart");

const SHOT_TOTAL_OVERRIDES = {
  S1: {
    REG: {
      WEST: { SF: 291, SA: 250 },
      VGN:  { SF: 237, SA: 347 },
      SLY:  { SF: 296, SA: 254 },
      MOFO: { SF: 280, SA: 255 },
      MM:   { SF: 245, SA: 252 },
      BCL:  { SF: 256, SA: 256 },
    },

    PO: {
      WEST: { SF: 51, SA: 63 },
      VGN:  { SF: 24, SA: 27 },
      SLY:  { SF: 28, SA: 36 },
      MOFO: { SF: 94, SA: 91 },
      MM:   { SF: 21, SA: 16 },
      BCL:  { SF: 132, SA: 113 },
    }
  }
};

/* ---------------------------
   Seasons meta (adv_stats)
--------------------------- */
const SEASONS_PATH = new URL(
  (window.location.pathname.includes("/pages/") ? "../data/" : "data/") + "seasons.csv",
  window.location.href
).toString();

let seasonsMeta = []; // seasons.csv rows

/* ---------------------------
   Caches per season
--------------------------- */
const cache = new Map(); // seasonId -> { teams, schedule, games, playersReg, playersPO, boxscores }

/* ---------------------------
   Helpers
--------------------------- */
function setStatus(msg){
  elStatus.textContent = msg;
  elStatus.hidden = !msg;
}

function seasonAdvEnabled(seasonId){
  const row = seasonsMeta.find(r => r.season_id === seasonId);
  return row ? truthy01(row.adv_stats) : false;
}

function safeDiv(a, b){
  if (a === null || b === null) return null;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (b === 0) return null;
  return a / b;
}

function fmtPercent(v, decimals = 1){
  if (v === null) return "";
  return `${(v * 100).toFixed(decimals)}%`;
}
function fmtNumber(v, decimals = 2){
  if (v === null) return "";

  // If it's effectively an integer, show no decimals
  if (Number.isInteger(v)) return v.toString();

  const abs = Math.abs(v);
  const d = abs >= 100 ? 0 : decimals;
  return v.toFixed(d);
}
function clampMinGP(){
  const n = toIntMaybe(elMinGP.value);
  if (n === null || n < 0) return 1;
  return n;
}
function suggestMinGP(mode, stageSel, data){
  // Teams: always show all teams (unless you later want "min team GP")
  if (mode === "TEAM") return 1;

  const target = (mode === "SKATER") ? 5 : 3;
  const minPointsWanted = (mode === "SKATER") ? 12 : 6; // tweak to taste

  const players = (stageSel === "PO") ? data.playersPO : data.playersReg;
  const gpField = (mode === "SKATER") ? "gp_s" : "gp_g";

  const gps = players.map(r => toIntMaybe(r[gpField]) ?? 0);
  const maxGP = gps.length ? Math.max(...gps) : 0;

  // If nobody has reached the target yet, don't hide the chart
  if (maxGP < target) return 1;

  // Start at target and step down until we keep enough points
  for (let mgp = target; mgp >= 1; mgp--){
    const cnt = gps.filter(gp => gp >= mgp).length;
    if (cnt >= minPointsWanted) return mgp;
  }

  return 1;
}

/**
 * Player key rules:
 * 1) player_key (if present)
 * 2) steam_id (if present)
 * 3) name
 */
function playerKey(r){
  const pk = (r.player_key || "").toString().trim();
  if (pk) return pk;

  const sid = (r.steam_id || "").toString().trim();
  if (sid) return sid;

  const nm = (r.name || "").toString().trim();
  return nm || "";
}

function teamIdFromPlayerRow(r){
  return (r.team_id || "").toString().trim();
}

/* ---------------------------
   Stat Registry
--------------------------- */
const STATS = [
  /* ===== SKATERS ===== */
  { id:"gp_s", label:"GP", scope:"SKATER", format:"number", invert:false, advOnly:false, needsBoxscores:false,
    get:(r)=>toNumMaybe(r.gp_s) },

  { id:"g", label:"Goals", scope:"SKATER", format:"number", invert:false, advOnly:false, needsBoxscores:false,
    get:(r)=>toNumMaybe(r.g) },

  { id:"a", label:"Assists", scope:"SKATER", format:"number", invert:false, advOnly:false, needsBoxscores:false,
    get:(r)=>toNumMaybe(r.a) },

  { id:"pts", label:"Points", scope:"SKATER", format:"number", invert:false, advOnly:false, needsBoxscores:false,
    get:(r)=>toNumMaybe(r.pts) },

  { id:"shots", label:"Shots", scope:"SKATER", format:"number", invert:false, advOnly:false, needsBoxscores:false,
    get:(r)=>toNumMaybe(r.shots) },

  { id:"passes", label:"Passes*", scope:"SKATER", format:"number", invert:false, advOnly:true, needsBoxscores:false,
    get:(r)=>toNumMaybe(r.passes) },

  { id:"exits", label:"Exits*", scope:"SKATER", format:"number", invert:false, advOnly:true, needsBoxscores:false,
    get:(r)=>toNumMaybe(r.exits) },

  { id:"entries", label:"Entries*", scope:"SKATER", format:"number", invert:false, advOnly:true, needsBoxscores:false,
    get:(r)=>toNumMaybe(r.entries) },

  { id:"turnovers", label:"Turnovers*", scope:"SKATER", format:"number", invert:true, advOnly:true, needsBoxscores:false,
    get:(r)=>toNumMaybe(r.turnovers) },

  { id:"takeaways", label:"Takeaways*", scope:"SKATER", format:"number", invert:false, advOnly:true, needsBoxscores:false,
    get:(r)=>toNumMaybe(r.takeaways) },

  { id:"possession_s", label:"Possession (s)*", scope:"SKATER", format:"number", invert:false, advOnly:true, needsBoxscores:false,
    get:(r)=>toNumMaybe(r.possession_s) },
	
	{ id:"sp_s", label:"SP", scope:"SKATER", format:"number", invert:false, advOnly:false, needsBoxscores:false,
  get:(r)=>toNumMaybe(r.sp) },

{ id:"sp_per_gp_s", label:"SP/GP", scope:"SKATER", format:"number", invert:false, advOnly:false, needsBoxscores:false,
  get:(r)=>{
    const sp = toNumMaybe(r.sp);
    const gp = toNumMaybe(r.gp_s);
    return safeDiv(sp, gp);
  } },


  // Shooting % (rename to Sh%)
  { id:"sh_pct", label:"Sh%", scope:"SKATER", format:"percent", invert:false, advOnly:false, needsBoxscores:false,
    get:(r)=> {
      const g = toNumMaybe(r.g);
      const sh = toNumMaybe(r.shots);
      return safeDiv(g, sh);
    }
  },

  // Rates (/GP fallback, /15 is separate)
  { id:"g_rate", label:"G/GP", scope:"SKATER", format:"number", invert:false, advOnly:false, needsBoxscores:false,
    get:(r)=>{
      const g = toNumMaybe(r.g);
      const gp = toNumMaybe(r.gp_s);
      return safeDiv(g, gp);
    }
  },
  { id:"p_rate", label:"P/GP", scope:"SKATER", format:"number", invert:false, advOnly:false, needsBoxscores:false,
    get:(r)=>{
      const p = toNumMaybe(r.pts);
      const gp = toNumMaybe(r.gp_s);
      return safeDiv(p, gp);
    }
  },

  { id:"g_per_15", label:"G/15*", scope:"SKATER", format:"number", invert:false, advOnly:true, needsBoxscores:true,
    get:(r, ctx)=>{
      const key = playerKey(r);
      const g = toNumMaybe(r.g);
      const toi = ctx.toiByPlayer.get(key) ?? null;
      if (toi === null) return null;
      return safeDiv(g, (toi / 900)); // 900s = 15 min
    }
  },
  { id:"p_per_15", label:"P/15*", scope:"SKATER", format:"number", invert:false, advOnly:true, needsBoxscores:true,
    get:(r, ctx)=>{
      const key = playerKey(r);
      const p = toNumMaybe(r.pts);
      const toi = ctx.toiByPlayer.get(key) ?? null;
      if (toi === null) return null;
      return safeDiv(p, (toi / 900));
    }
  },

  // Possession%* = poss_s / toi_s (from boxscores)
  { id:"poss_pct", label:"Possession%*", scope:"SKATER", format:"percent", invert:false, advOnly:true, needsBoxscores:true,
    get:(r, ctx)=>{
      const key = playerKey(r);
      const poss = ctx.possByPlayer.get(key) ?? null;
      const toi  = ctx.toiByPlayer.get(key) ?? null;
      return safeDiv(poss, toi);
    }
  },

  // GF%* (WCPL definition): team goal share in games player appeared in
  { id:"gf_pct", label:"GF%*", scope:"SKATER", format:"percent", invert:false, advOnly:true, needsBoxscores:true,
    get:(r, ctx)=>{
      const key = playerKey(r);
      const gf = ctx.gfByPlayer.get(key) ?? null;
      const ga = ctx.gaByPlayer.get(key) ?? null;
      return safeDiv(gf, (gf === null || ga === null) ? null : (gf + ga));
    }
  },

  /* ===== GOALIES ===== */
  { id:"gp_g", label:"GP", scope:"GOALIE", format:"number", invert:false, advOnly:false, needsBoxscores:false,
    get:(r)=>toNumMaybe(r.gp_g) },

  { id:"sa", label:"SA", scope:"GOALIE", format:"number", invert:true, advOnly:false, needsBoxscores:false,
    get:(r)=>toNumMaybe(r.sa) },

  { id:"ga", label:"GA", scope:"GOALIE", format:"number", invert:true, advOnly:false, needsBoxscores:false,
    get:(r)=>toNumMaybe(r.ga) },

  { id:"sv", label:"SV", scope:"GOALIE", format:"number", invert:false, advOnly:false, needsBoxscores:false,
    get:(r)=>{
      const sa = toNumMaybe(r.sa);
      const ga = toNumMaybe(r.ga);
      if (sa === null || ga === null) return null;
      return sa - ga;
    }
  },

  { id:"sv_pct", label:"SV%", scope:"GOALIE", format:"percent", invert:false, advOnly:false, needsBoxscores:false,
    get:(r)=>toNumMaybe(r.sv_pct) },

  { id:"so", label:"SO", scope:"GOALIE", format:"number", invert:false, advOnly:false, needsBoxscores:false,
    get:(r)=>toNumMaybe(r.so) },

  { id:"wins", label:"W", scope:"GOALIE", format:"number", invert:false, advOnly:false, needsBoxscores:false,
    get:(r)=>toNumMaybe(r.wins) },

  { id:"sp", label:"SP", scope:"GOALIE", format:"number", invert:false, advOnly:false, needsBoxscores:false,
    get:(r)=>toNumMaybe(r.sp) },

  { id:"gaa", label:"GAA", scope:"GOALIE", format:"number", invert:true, advOnly:false, needsBoxscores:false,
    get:(r)=>toNumMaybe(r.gaa) },

  { id:"sp_per_gp", label:"SP/GP", scope:"GOALIE", format:"number", invert:false, advOnly:false, needsBoxscores:false,
    get:(r)=>{
      const sp = toNumMaybe(r.sp);
      const gp = toNumMaybe(r.gp_g);
      return safeDiv(sp, gp);
    }
  },

  { id:"body_sv", label:"Body SV*", scope:"GOALIE", format:"number", invert:false, advOnly:true, needsBoxscores:false,
    get:(r)=>toNumMaybe(r.body_sv) },

  { id:"stick_sv", label:"Stick SV*", scope:"GOALIE", format:"number", invert:false, advOnly:true, needsBoxscores:false,
    get:(r)=>toNumMaybe(r.stick_sv) },

  /* ===== TEAMS ===== */
  { id:"team_gp", label:"GP", scope:"TEAM", format:"number", invert:false, advOnly:false, needsBoxscores:false,
    get:(t, ctx)=> ctx.teamAgg.get(t.team_id)?.gp ?? null
  },
  { id:"gf", label:"GF", scope:"TEAM", format:"number", invert:false, advOnly:false, needsBoxscores:false,
    get:(t, ctx)=> ctx.teamAgg.get(t.team_id)?.gf ?? null
  },
  { id:"ga_team", label:"GA", scope:"TEAM", format:"number", invert:true, advOnly:false, needsBoxscores:false,
    get:(t, ctx)=> ctx.teamAgg.get(t.team_id)?.ga ?? null
  },
  { id:"g_share", label:"G%", scope:"TEAM", format:"percent", invert:false, advOnly:false, needsBoxscores:false,
    get:(t, ctx)=>{
      const a = ctx.teamAgg.get(t.team_id);
      if (!a) return null;
      return safeDiv(a.gf, a.gf + a.ga);
    }
  },
  { id:"sf", label:"Shots For", scope:"TEAM", format:"number", invert:false, advOnly:false, needsBoxscores:false,
    get:(t, ctx)=> ctx.teamAgg.get(t.team_id)?.sf ?? null
  },
  { id:"sa_team", label:"Shots Against", scope:"TEAM", format:"number", invert:true, advOnly:false, needsBoxscores:false,
    get:(t, ctx)=> ctx.teamAgg.get(t.team_id)?.sa ?? null
  },
{ id:"sf_sa_ratio", label:"SF / SA", scope:"TEAM", format:"number", invert:false, advOnly:false, needsBoxscores:false,
  get:(t, ctx)=>{
    const a = ctx.teamAgg.get(t.team_id);
    if (!a) return null;
    return safeDiv(a.sf, a.sa);
  }
},
  { id:"poss_for", label:"Possession For*", scope:"TEAM", format:"number", invert:false, advOnly:true, needsBoxscores:false,
    get:(t, ctx)=> ctx.teamAgg.get(t.team_id)?.possFor ?? null
  },
  { id:"poss_against", label:"Possession Against*", scope:"TEAM", format:"number", invert:true, advOnly:true, needsBoxscores:false,
    get:(t, ctx)=> ctx.teamAgg.get(t.team_id)?.possAgainst ?? null
  },
  { id:"poss_share_team", label:"Possession%*", scope:"TEAM", format:"percent", invert:false, advOnly:true, needsBoxscores:false,
    get:(t, ctx)=>{
      const a = ctx.teamAgg.get(t.team_id);
      if (!a) return null;
      return safeDiv(a.possFor, a.possFor + a.possAgainst);
    }
  },
  { id:"pdo", label:"PDO", scope:"TEAM", format:"number", invert:false, advOnly:false, needsBoxscores:false,
  get:(t, ctx)=>{
    const a = ctx.teamAgg.get(t.team_id);
    if (!a) return null;

    const sh = safeDiv(a.gf, a.sf);        // Team shooting %
    const sv = safeDiv(a.sa - a.ga, a.sa); // Team save %

    if (sh === null || sv === null) return null;
    return (sh + sv) * 100;
  }
},

{ id:"team_sh_pct", label:"Sh%", scope:"TEAM", format:"percent", invert:false, advOnly:false, needsBoxscores:false,
  get:(t, ctx)=>{
    const a = ctx.teamAgg.get(t.team_id);
    if (!a) return null;
    return safeDiv(a.gf, a.sf);
  }
},
{ id:"team_sv_pct", label:"Sv%", scope:"TEAM", format:"percent", invert:false, advOnly:false, needsBoxscores:false,
  get:(t, ctx)=>{
    const a = ctx.teamAgg.get(t.team_id);
    if (!a) return null;
    return safeDiv(a.sa - a.ga, a.sa);
  }
},


];

function statById(id){
  return STATS.find(s => s.id === id) || null;
}

/* ---------------------------
   Dropdown definitions
--------------------------- */
function statsForScope(scope, advOn, hasBox){
  return STATS.filter(s =>
    s.scope === scope &&
    (!s.advOnly || advOn) &&
    (!s.needsBoxscores || hasBox)
  );
}

function selectHasValue(selectEl, value){
  if (!value) return false;
  return Array.from(selectEl.options).some(o => o.value === value);
}

function buildAxisDropdown(selectEl, scope, advOn, hasBox){
  selectEl.innerHTML = "";

  const og = document.createElement("optgroup");
  og.label =
    scope === "SKATER" ? "Skater Stats" :
    scope === "GOALIE" ? "Goalie Stats" :
    "Team Stats";

  const list = statsForScope(scope, advOn, hasBox)
  .slice()
  .sort((a, b) => {
    // Put SP at the bottom for SKATER + GOALIE axis lists
    const aIsSP = (a.id === "sp_s" || a.id === "sp");
    const bIsSP = (b.id === "sp_s" || b.id === "sp");
    if (aIsSP && !bIsSP) return 1;
    if (!aIsSP && bIsSP) return -1;
    return 0;
  });


  for (const st of list){
	  if (scope === "GOALIE" && st.id === "sp_per_gp") continue;
if (scope === "SKATER" && st.id === "sp_per_gp_s") continue;

    // When TOI is available, hide GP-based rates (we'll show /15 instead)
    if (scope === "SKATER" && advOn && hasBox){
      if (st.id === "g_rate" || st.id === "p_rate") continue;
    } else {
      // When no TOI, hide /15 options
      if (st.id === "g_per_15" || st.id === "p_per_15") continue;
      if (st.id === "poss_pct" || st.id === "gf_pct") {
        // These require boxscores anyway, but keep safe.
      }
    }

    const opt = document.createElement("option");
    opt.value = st.id;
    opt.textContent = st.label;
    og.appendChild(opt);
  }

  selectEl.appendChild(og);
}

function buildColorDropdown(selectEl, scope, advOn, hasBox){
  selectEl.innerHTML = "";

  const og = document.createElement("optgroup");
  og.label =
    scope === "SKATER" ? "Skater" :
    scope === "GOALIE" ? "Goalie" : "Team";

  const ids =
    scope === "SKATER" ? [
      "sh_pct",
      "p_rate",
      "g_rate",
      "gf_pct",
      "poss_pct",
      "p_per_15",
      "g_per_15",
	  "sp_per_gp_s",
    ] :
    scope === "GOALIE" ? [
      "sv_pct",
      "gaa",
      "ga",
      "sa",
	  "sp_per_gp",
    ] :
    [
      "g_share",
      "sf_sa_ratio",
	  "team_sv_pct",
      "poss_share_team",
	  "pdo",
    ];

  for (const id of ids){
    const st = statById(id);
    if (!st) continue;
    if (st.scope !== scope) continue;
    if (st.advOnly && !advOn) continue;
    if (st.needsBoxscores && !hasBox) continue;

    // TOI availability swaps GP rates for /15
    if (scope === "SKATER" && advOn && hasBox){
      if (id === "p_rate" || id === "g_rate") continue;
    } else {
      if (id === "p_per_15" || id === "g_per_15") continue;
    }

    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = st.label;
    og.appendChild(opt);
  }

  if (!og.children.length){
    // fallback
    const fallback = statsForScope(scope, advOn, hasBox)[0];
    if (fallback){
      const opt = document.createElement("option");
      opt.value = fallback.id;
      opt.textContent = fallback.label;
      og.appendChild(opt);
    }
  }

  selectEl.appendChild(og);
}

/* ---------------------------
   Data loading & aggregation
--------------------------- */
async function getSeasonData(seasonId){
  if (cache.has(seasonId)) return cache.get(seasonId);

  const teamsPath = `../data/${seasonId}/teams.csv`;
  const schedPath = `../data/${seasonId}/schedule.csv`;
  const gamesPath = `../data/${seasonId}/games.csv`;
  const pRegPath  = `../data/${seasonId}/players.csv`;
  const pPOPath   = `../data/${seasonId}/players_playoffs.csv`;
  const boxPath   = `../data/${seasonId}/boxscores.csv`;

  const [teams, schedule, games, playersReg, playersPO, boxscores] = await Promise.all([
    loadCSV(teamsPath).catch(()=>[]),
    loadCSV(schedPath).catch(()=>[]),
    loadCSV(gamesPath).catch(()=>[]),
    loadCSV(pRegPath).catch(()=>[]),
    loadCSV(pPOPath).catch(()=>[]),
    loadCSV(boxPath).catch(()=>[]),
  ]);

  const out = { teams, schedule, games, playersReg, playersPO, boxscores };
  cache.set(seasonId, out);
  return out;
}

function isPlayoffsStage(stage){
  return stage && stage.toLowerCase() !== "reg";
}

function buildTeamAgg(teams, schedule, games, seasonId, stageSel){
  const wantPO = (stageSel === "PO");

  const wantMatchIds = new Set();
  for (const s of schedule){
    const po = isPlayoffsStage(s.stage);
    if ((wantPO && po) || (!wantPO && !po)){
      wantMatchIds.add(s.match_id);
    }
  }

  const agg = new Map();
  function ensure(teamId){
    if (!agg.has(teamId)){
      agg.set(teamId, {
        gp:0,
        gf:0, ga:0,
        sf:0, sa:0,
        possFor:0, possAgainst:0
      });
    }
    return agg.get(teamId);
  }

  for (const g of games){
    if (!wantMatchIds.has(g.match_id)) continue;

    const hg = toIntMaybe(g.home_goals);
    const ag = toIntMaybe(g.away_goals);
    if (hg === null || ag === null) continue;

    const home = g.home_team_id;
    const away = g.away_team_id;

    const hs = toIntMaybe(g.home_shots) ?? 0;
    const as = toIntMaybe(g.away_shots) ?? 0;

    const hp = toIntMaybe(g.home_possession_s) ?? 0;
    const ap = toIntMaybe(g.away_possession_s) ?? 0;

    // home
    {
      const a = ensure(home);
      a.gp += 1;
      a.gf += hg;
      a.ga += ag;
      a.sf += hs;
      a.sa += as;
      a.possFor += hp;
      a.possAgainst += ap;
    }
    // away
    {
      const a = ensure(away);
      a.gp += 1;
      a.gf += ag;
      a.ga += hg;
      a.sf += as;
      a.sa += hs;
      a.possFor += ap;
      a.possAgainst += hp;
    }
  }

  for (const t of teams){
    if (!agg.has(t.team_id)){
      agg.set(t.team_id, { gp:0, gf:0, ga:0, sf:0, sa:0, possFor:0, possAgainst:0 });
    }
  }
  
  // Apply manual SF/SA overrides (e.g., S1 totals with no per-game shots)
const stageKey = (stageSel === "PO") ? "PO" : "REG";
const ovSeason = SHOT_TOTAL_OVERRIDES[seasonId];
const ovStage  = ovSeason?.[stageKey];

if (ovStage) {
  for (const [team_id, v] of Object.entries(ovStage)) {
    const row = agg.get(team_id);
    if (!row) continue;

    if (typeof v?.SF === "number") row.sf = v.SF;
    if (typeof v?.SA === "number") row.sa = v.SA;
  }
}

  return agg;
}

/* ---------------------------
   Boxscores-derived maps
--------------------------- */
function buildBoxscoreMaps(boxscores, gamesById, scheduleById, stageSel){
  const maps = {
    hasBox: false,
    toiByPlayer: new Map(),
    possByPlayer: new Map(),
    gfByPlayer: new Map(),
    gaByPlayer: new Map(),
    teamByPlayer: new Map(),
    matchIdsByPlayer: new Map(),
  };

  if (!boxscores || boxscores.length === 0) return maps;

  const wantPO = (stageSel === "PO");

  function matchAllowed(matchId){
    const s = scheduleById.get(matchId);
    if (!s) return false;
    const po = isPlayoffsStage(s.stage);
    return (wantPO && po) || (!wantPO && !po);
  }

  for (const r of boxscores){
    const matchId = r.match_id;
    if (!matchAllowed(matchId)) continue;

    const key = playerKey(r);
    if (!key) continue;

    const toi = toIntMaybe(r.toi_s);
    const poss = toIntMaybe(r.poss_s);

    if (toi !== null){
      maps.toiByPlayer.set(key, (maps.toiByPlayer.get(key) ?? 0) + toi);
    }
    if (poss !== null){
      maps.possByPlayer.set(key, (maps.possByPlayer.get(key) ?? 0) + poss);
    }

    if (!maps.matchIdsByPlayer.has(key)) maps.matchIdsByPlayer.set(key, new Set());
    maps.matchIdsByPlayer.get(key).add(matchId);

    const tid = (r.team_id || "").toString().trim();
    if (tid && !maps.teamByPlayer.has(key)) maps.teamByPlayer.set(key, tid);
  }

  // GF/GA per player using games + match list and player's team_id
  for (const [key, matchSet] of maps.matchIdsByPlayer.entries()){
    const teamId = maps.teamByPlayer.get(key);
    if (!teamId) continue;

    let gf = 0;
    let ga = 0;

    for (const matchId of matchSet){
      const g = gamesById.get(matchId);
      if (!g) continue;

      const hg = toIntMaybe(g.home_goals);
      const ag = toIntMaybe(g.away_goals);
      if (hg === null || ag === null) continue;

      const isHome = (g.home_team_id === teamId);
      const isAway = (g.away_team_id === teamId);
      if (!isHome && !isAway) continue;

      gf += (isHome ? hg : ag);
      ga += (isHome ? ag : hg);
    }

    maps.gfByPlayer.set(key, gf);
    maps.gaByPlayer.set(key, ga);
  }

  maps.hasBox = true;
  return maps;
}

/* ---------------------------
   Context builder
--------------------------- */
function buildContext(seasonId, data, stageSel, advOn){
  const gamesById = new Map();
  for (const g of data.games) gamesById.set(g.match_id, g);

  const scheduleById = new Map();
  for (const s of data.schedule) scheduleById.set(s.match_id, s);

  const teamsById = new Map();
  for (const t of data.teams) teamsById.set(t.team_id, t);

  const teamAgg = buildTeamAgg(data.teams, data.schedule, data.games, seasonId, stageSel);

  const boxMaps = buildBoxscoreMaps(data.boxscores, gamesById, scheduleById, stageSel);

  const useToiRates = advOn && boxMaps.hasBox;

  return {
    seasonId,
    advOn,
    hasBox: boxMaps.hasBox,
    useToiRates,
    teamsById,
    teamAgg,
    gamesById,
    scheduleById,
    ...boxMaps,
  };
}
/* ---------------------------
   Plotly rendering
--------------------------- */
function plotPoints(points, xStat, yStat, cStat, ctx){
  const pts = points.filter(p => p.x !== null && p.y !== null);

  const colorVals = pts.map(p => p.c);

  // Inversion: lower should be greener
  let z = colorVals.slice();
  if (cStat && cStat.invert){
    const vals = z.filter(v => v !== null && Number.isFinite(v));
    const zMax = vals.length ? Math.max(...vals) : null;
    if (zMax !== null){
      z = z.map(v => (v === null || !Number.isFinite(v)) ? null : (zMax - v));
    }
  }

  const hoverX = xStat.format === "percent" ? (v)=>fmtPercent(v) : (v)=>fmtNumber(v);
  const hoverY = yStat.format === "percent" ? (v)=>fmtPercent(v) : (v)=>fmtNumber(v);
  const hoverC = cStat?.format === "percent" ? (v)=>fmtPercent(v) : (v)=>fmtNumber(v);

  const trace = {
    type: "scatter",
    mode: "markers",
    x: pts.map(p => p.x),
    y: pts.map(p => p.y),
    text: pts.map(p => p.label),
hovertext: pts.map(p => {
  const xLine = `${xStat.label}: ${hoverX(p.x)}`;
  const yLine = `${yStat.label}: ${hoverY(p.y)}`;
  const cLine = cStat ? `${cStat.label}: ${hoverC(p.c)}` : "";

  const lines = [];

  // Show team line for players/goalies only
  if (ctx.mode !== "TEAM") {
    const teamLine = p.team_name || p.team_id || "";
    if (teamLine) lines.push(teamLine);
  }

  lines.push(xLine, yLine);
  if (cLine) lines.push(cLine);

  return lines.join("<br>");
}),
    customdata: pts.map(p => ({
      id: p.id,
      team_id: p.team_id,
      team_name: p.team_name || "",
      mode: p.mode
    })),
    marker: {
size: 10,
opacity: 0.9,
      color: z,
      colorscale: [
  [0.0, "red"],
  [0.5, "yellow"],
  [1.0, "green"]
],
      showscale: true,
      colorbar: {
  title: cStat ? cStat.label : "",
  tickformat: (cStat && cStat.format === "percent") ? ".1%" : undefined
},
line: {width: 0},
    },
hovertemplate:
  "<b>%{text}</b><br>" +
  "%{hovertext}" +
  "<extra></extra>"
  };

  const layout = {
    margin: { l: 55, r: 20, t: 10, b: 55 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    xaxis: {
  title: xStat.label,
  zeroline: false,
  gridcolor: "rgba(255,255,255,0.06)",
  tickformat: (xStat.format === "percent") ? ".1%" : undefined
},
yaxis: {
  title: yStat.label,
  zeroline: false,
  gridcolor: "rgba(255,255,255,0.06)",
  tickformat: (yStat.format === "percent") ? ".1%" : undefined
},

    font: { color: "rgba(255,255,255,0.92)" },
    showlegend: false,
  };

  const config = {
    responsive: true,
    displaylogo: false,
  };

  const traces = [trace];

  if (elTrend.checked && pts.length >= 2){
    const line = olsTrendline(pts.map(p=>p.x), pts.map(p=>p.y));
    if (line){
      traces.push({
        type: "scatter",
        mode: "lines",
        x: line.x,
        y: line.y,
        hoverinfo: "skip",
        line: { width: 2 },
      });
    }
  }

  Plotly.react(elChart, traces, layout, config);

// Force Plotly to re-measure the container (important after widening the page)
requestAnimationFrame(() => Plotly.Plots.resize(elChart));

}

function olsTrendline(xs, ys){
  const n = xs.length;
  if (n < 2) return null;

  let sx=0, sy=0, sxx=0, sxy=0;
  for (let i=0;i<n;i++){
    const x = xs[i], y = ys[i];
    sx += x; sy += y;
    sxx += x*x;
    sxy += x*y;
  }
  const denom = (n*sxx - sx*sx);
  if (denom === 0) return null;

  const b = (n*sxy - sx*sy) / denom;
  const a = (sy - b*sx) / n;

  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs);

  const xLine = [xmin, xmax];
  const yLine = xLine.map(x => a + b*x);
  return { x: xLine, y: yLine };
}

/* ---------------------------
   Refresh
--------------------------- */
async function refresh(){
  const seasonId = getSeasonId();
  if (!seasonId){
    setStatus("No season selected.");
    return;
  }

  setStatus("Loading…");

  const advOn = seasonAdvEnabled(seasonId);
  const stageSel = elStage.value;

  const data = await getSeasonData(seasonId);

  if (!data.teams.length){
    setStatus(`No data exists for Season ${seasonId}.`);
    Plotly.purge(elChart);
    return;
  }

  const ctxBase = buildContext(seasonId, data, stageSel, advOn);
  const mode = elMode.value;
  const ctx = { ...ctxBase, mode };

// Preserve current selections before we rebuild the dropdowns
const prevX = elX.value;
const prevY = elY.value;
const prevC = elColor.value;

// Dropdowns depend on mode + adv + boxscore availability
buildAxisDropdown(elX, mode, advOn, ctx.hasBox);
buildAxisDropdown(elY, mode, advOn, ctx.hasBox);
buildColorDropdown(elColor, mode, advOn, ctx.hasBox);

// Preferred defaults per mode
const defX =
  (mode === "SKATER") ? "gp_s" :
  (mode === "GOALIE") ? "sv" :
  "team_sh_pct";

const defY =
  (mode === "SKATER") ? "pts" :
  (mode === "GOALIE") ? "sa" :
  "team_sv_pct";

const defC =
  (mode === "SKATER") ? "sh_pct" :
  (mode === "GOALIE") ? "sv_pct" :
  "pdo";

// Restore previous selection if valid; otherwise apply the mode default (if available)
if (selectHasValue(elX, prevX)) elX.value = prevX;
else if (selectHasValue(elX, defX)) elX.value = defX;

if (selectHasValue(elY, prevY)) elY.value = prevY;
else if (selectHasValue(elY, defY)) elY.value = defY;

if (selectHasValue(elColor, prevC)) elColor.value = prevC;
else if (selectHasValue(elColor, defC)) elColor.value = defC;


  const xStat = statById(elX.value);
  const yStat = statById(elY.value);
  const cStat = statById(elColor.value);

  if (!xStat || !yStat){
    setStatus("Missing axis selection.");
    return;
  }
// Auto-pick Min GP when context changes, unless the user has manually set it
const ctxKey = `${seasonId}|${stageSel}|${mode}`;
if (refresh._lastMinGpKey !== ctxKey){
  refresh._lastMinGpKey = ctxKey;

  if (!refresh._minGpTouched){
    elMinGP.value = suggestMinGP(mode, stageSel, data);
  }
}

  const minGP = clampMinGP();

  let points = [];
  if (mode === "TEAM"){
    points = data.teams
      .map(t => {
        const x = xStat.get(t, ctx);
        const y = yStat.get(t, ctx);
        const c = cStat ? cStat.get(t, ctx) : null;
        return {
          id: t.team_id,
          label: t.team_name || t.team_id,
          team_id: t.team_id,
          team_name: t.team_name || t.team_id,
          mode,
          x, y, c
        };
      })
      .filter(p => {
        const gp = ctx.teamAgg.get(p.team_id)?.gp ?? 0;
        return gp >= minGP;
      });
  } else {
    const players = (stageSel === "PO") ? data.playersPO : data.playersReg;

    points = players
      .map(r => {
        const gpField = (mode === "SKATER") ? "gp_s" : "gp_g";
        const gp = toNumMaybe(r[gpField]) ?? 0;

        const team_id = teamIdFromPlayerRow(r);
        const team = ctx.teamsById.get(team_id);
        const team_name = team ? (team.team_name || team.team_id) : (team_id || "");

        const key = playerKey(r);

        const x = xStat.get(r, ctx);
        const y = yStat.get(r, ctx);
        const c = cStat ? cStat.get(r, ctx) : null;

        return {
          id: key,
          label: r.name || key,
          team_id,
          team_name,
          mode,
          gp,
          x, y, c
        };
      })
      .filter(p => p.gp >= minGP);
  }

  if (advOn && !ctx.hasBox){
    setStatus("Loaded (boxscores empty — TOI-based options hidden until Season 2 data starts).");
  } else {
    setStatus("");
  }

  plotPoints(points, xStat, yStat, cStat, ctx);

// Click routing
elChart.removeAllListeners?.("plotly_click");

if (mode !== "TEAM"){
  elChart.on("plotly_click", (ev) => {
    const pt = ev?.points?.[0];
    if (!pt) return;
    const cd = pt.customdata;
    if (!cd?.id) return;

    const href = withSeason(`player.html?player_key=${encodeURIComponent(cd.id)}`, seasonId);
    window.location.href = href;
  });
} else {
  elChart.on("plotly_click", (ev) => {
    const pt = ev?.points?.[0];
    if (!pt) return;
    const cd = pt.customdata;
    const teamId = cd?.team_id || cd?.id;
    if (!teamId) return;

    const href = withSeason(`team.html?team_id=${encodeURIComponent(teamId)}`, seasonId);
    window.location.href = href;
  });
}
}

/* ---------------------------
   Boot
--------------------------- */
boot();

async function boot(){
  try{
    seasonsMeta = await loadCSV(SEASONS_PATH).catch(()=>[]);
    await initSeasonPicker(elSeason);

    elMode.addEventListener("change", refresh);
    elStage.addEventListener("change", refresh);
    elX.addEventListener("change", refresh);
    elY.addEventListener("change", refresh);
    elColor.addEventListener("change", refresh);

elMinGP.addEventListener("input", () => {
  refresh._minGpTouched = true;   // user is taking control
  window.clearTimeout(boot._t);
  boot._t = window.setTimeout(refresh, 150);
});

    elTrend.addEventListener("change", refresh);

    onSeasonChange(refresh);

    await refresh();
  } catch (err){
    console.error(err);
    setStatus(err?.message || "Failed to load.");
  }
  window.addEventListener("resize", () => Plotly.Plots.resize(elChart));
}
