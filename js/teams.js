// js/teams.js
import { loadCSV, toIntMaybe, toNumMaybe } from "./data.js";
import {
  initSeasonPicker,
  getSeasonId,
  onSeasonChange,
  saveStage,
  playoffsHaveBegun,
  applyDefaultStage
} from "./season.js";

const elSeason = document.getElementById("seasonSelect");
const elStatus = document.getElementById("status");
const elTable  = document.getElementById("teamsTable");
const elTbody  = elTable.querySelector("tbody");
const elConf   = document.getElementById("confFilter");
const elStage  = document.getElementById("stageSelect");
const elPointsNote = document.getElementById("pointsNote");
const elRateMode = document.getElementById("rateMode");

// NOTE: legacy manual SF/SA overrides (S1 only) preserved.
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

let teams = [];      // from teams.csv
let standings = [];  // computed rows
let sortKey = "PTS";
let sortDir = "desc"; // "desc" or "asc"

boot();

async function boot() {
  await initSeasonPicker(elSeason);

  wireFilters();
  onSeasonChange(() => refresh());

  await refresh();
}

function wireFilters() {
  elConf.addEventListener("change", render);
  elRateMode?.addEventListener("change", render);

  elStage.addEventListener("change", () => {
    saveStage(elStage.value, getSeasonId());
    refresh();
  });

  elTable.querySelector("thead").addEventListener("click", (e) => {
    const th = e.target.closest("th");
    if (!th) return;

    const key = th.dataset.key;
    if (!key) return; // non-sortable header
    if (elStage.value === "PO" && key === "PTS") return;

    if (sortKey === key) {
      sortDir = (sortDir === "desc") ? "asc" : "desc";
    } else {
      sortKey = key;
      sortDir = "desc";
    }

    render();
  });
}

async function refresh() {
  const seasonId = getSeasonId();
  if (!seasonId) {
    setLoading(true, "No season found in seasons.csv.");
    return;
  }

  setLoading(true, `Loading ${seasonId}…`);

  if (elPointsNote) {
    elPointsNote.textContent =
      (elStage.value === "PO")
        ? ""
        : "Points system: Reg W=3, OTW=2, OTL=1, Reg L=0.";
  }

  try {
    const teamsPath = `../data/${seasonId}/teams.csv`;
    const gamesPath = `../data/${seasonId}/games.csv`;
    const schedPath = `../data/${seasonId}/schedule.csv`;

    teams = await loadCSV(teamsPath);
    const games = await loadCSV(gamesPath);
    const schedule = await loadCSV(schedPath);

    setPlayoffsOptionEnabled(hasAnyPlayoffs(schedule));
    const playoffsBegun = playoffsHaveBegun(schedule, games);
    applyDefaultStage(elStage, seasonId, {
      playoffsEnabled: hasAnyPlayoffs(schedule),
      playoffsBegun
    });

    buildConferenceOptions(teams);
    standings = computeStandings(teams, games, schedule, seasonId, elStage.value);

    // Reasonable defaults: REG sorts by PTS, PO sorts by W
    if (elStage.value === "PO") {
      sortKey = "W";
      sortDir = "desc";
    } else if (sortKey === "W") {
      sortKey = "PTS";
      sortDir = "desc";
    }

    setLoading(false);
    render();
  } catch (err) {
    console.error(err);
    setLoading(true, `No data exists for Season ${getSeasonId()}.`);
    elTable.hidden = true;
  }
}

function buildConferenceOptions(teamRows) {
  const confs = new Set();
  for (const t of teamRows) {
    const c = String(t.conference ?? "").trim();
    if (c) confs.add(c);
  }

  const current = elConf.value || "__ALL__";
  elConf.innerHTML = `<option value="__ALL__">All</option>`;
  [...confs]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .forEach(c => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      elConf.appendChild(opt);
    });

  if ([...elConf.options].some(o => o.value === current)) elConf.value = current;
}

function hasAnyPlayoffs(scheduleRows) {
  const PO = new Set(["qf", "sf", "f"]);
  return scheduleRows.some(s => PO.has(String(s.stage ?? "").trim().toLowerCase()));
}

function setPlayoffsOptionEnabled(enabled) {
  const opt = [...elStage.options].find(o => o.value === "PO");
  if (opt) opt.disabled = !enabled;
  if (!enabled && elStage.value === "PO") elStage.value = "REG";
}

function readNumAny(row, keys) {
  for (const k of keys) {
    const v = toNumMaybe(row?.[k]);
    if (v != null) return v;
  }
  return null;
}

function computeStandings(teamRows, gameRows, scheduleRows, seasonId, stageMode) {
  // Map match_id → stage
  const stageByMatch = new Map();
  for (const s of scheduleRows) {
    if (s.match_id && s.stage) {
      stageByMatch.set(String(s.match_id).trim(), String(s.stage).trim().toLowerCase());
    }
  }

  // Index teams by team_id
  const tmap = new Map();
  for (const t of teamRows) {
    const team_id = String(t.team_id ?? "").trim();
    if (!team_id) continue;

    tmap.set(team_id, {
      team_id,
      team_name: String(t.team_name ?? "").trim(),
      conference: String(t.conference ?? "").trim(),
      bg_color: String(t.bg_color ?? "").trim(),
      text_color: String(t.text_color ?? "").trim(),

      // computed:
      GP: 0,
      W: 0,     // total wins (reg + OT)
      OTW: 0,
      L: 0,     // regulation losses
      OTL: 0,
      PTS: 0,

      GF: 0,
      GA: 0,
      SF: 0,
      SA: 0,

      // expected goals (if present in games.csv)
      xG: null,
      xGA: null,
    });
  }

  for (const g of gameRows) {
    const home = String(g.home_team_id ?? "").trim();
    const away = String(g.away_team_id ?? "").trim();
    if (!home || !away) continue;

    const matchId = String(g.match_id ?? "").trim();
    const stage = stageByMatch.get(matchId);

    const s = String(stage ?? "").trim().toLowerCase();
    const isReg = (s === "reg");
    const isPO  = (s === "qf" || s === "sf" || s === "f");

    if (stageMode === "PO") {
      if (!isPO) continue;
    } else {
      // default REG
      if (!isReg) continue;
    }

    const hg = toIntMaybe(g.home_goals);
    const ag = toIntMaybe(g.away_goals);
    const ot = toIntMaybe(g.ot) ?? 0;

    if (hg === null || ag === null) continue;

    const homeRow = tmap.get(home);
    const awayRow = tmap.get(away);
    if (!homeRow || !awayRow) continue;

    // GP
    homeRow.GP += 1;
    awayRow.GP += 1;

    // GF/GA
    homeRow.GF += hg; homeRow.GA += ag;
    awayRow.GF += ag; awayRow.GA += hg;

    // SF/SA (only if both present)
    const hs = toIntMaybe(g.home_shots);
    const as = toIntMaybe(g.away_shots);
    if (hs !== null && as !== null) {
      homeRow.SF += hs; homeRow.SA += as;
      awayRow.SF += as; awayRow.SA += hs;
    }

    // xG/xGA (robust: accept a few common key spellings)
    const hxg = readNumAny(g, ["xg_home", "home_xG", "home_xg", "home_xg_for", "home_xgf"]);
	const axg = readNumAny(g, ["xg_away", "away_xG", "away_xg", "away_xg_for", "away_xgf"]);
    if (hxg != null && axg != null) {
      homeRow.xG  = (homeRow.xG  ?? 0) + hxg;
      homeRow.xGA = (homeRow.xGA ?? 0) + axg;
      awayRow.xG  = (awayRow.xG  ?? 0) + axg;
      awayRow.xGA = (awayRow.xGA ?? 0) + hxg;
    }

    const isOT = ot > 0;

    const homeWin = hg > ag;
    const awayWin = ag > hg;
    if (!homeWin && !awayWin) continue;

    if (!isOT) {
      if (homeWin) {
        homeRow.W += 1;
        homeRow.PTS += 3;
        awayRow.L += 1;
      } else {
        awayRow.W += 1;
        awayRow.PTS += 3;
        homeRow.L += 1;
      }
    } else {
      if (homeWin) {
        homeRow.W += 1;
        homeRow.OTW += 1;
        homeRow.PTS += 2;

        awayRow.OTL += 1;
        awayRow.PTS += 1;
      } else {
        awayRow.W += 1;
        awayRow.OTW += 1;
        awayRow.PTS += 2;

        homeRow.OTL += 1;
        homeRow.PTS += 1;
      }
    }
  }

  // Apply optional manual SF/SA overrides (e.g., S1 totals)
  const stageKey = (stageMode === "PO") ? "PO" : "REG";
  const ovSeason = SHOT_TOTAL_OVERRIDES[seasonId];
  const ovStage  = ovSeason?.[stageKey];

  if (ovStage) {
    for (const [team_id, v] of Object.entries(ovStage)) {
      const row = tmap.get(team_id);
      if (!row) continue;

      if (typeof v?.SF === "number") row.SF = v.SF;
      if (typeof v?.SA === "number") row.SA = v.SA;
    }
  }

  const out = [...tmap.values()].map(r => ({
    ...r,
    DIFF: (r.GF ?? 0) - (r.GA ?? 0),
  }));

  out.sort((a, b) =>
    (b.PTS - a.PTS) ||
    (b.DIFF - a.DIFF) ||
    (b.GF - a.GF) ||
    a.team_name.localeCompare(b.team_name, undefined, { sensitivity: "base" })
  );

  return out;
}

function render() {
  const conf = elConf.value;

  let view = standings.slice();
  if (conf !== "__ALL__") {
    view = view.filter(r => String(r.conference ?? "") === conf);
  }

  view.sort((a, b) => compareByKey(a, b, sortKey, sortDir));
  updateSortIndicators();

  elTbody.innerHTML = "";
  const seasonId = getSeasonId();

  for (const r of view) {
    elTbody.appendChild(renderRow(r, seasonId));
  }

  elTable.hidden = false;
}

function renderRow(r, seasonId) {
  const tr = document.createElement("tr");
  const rateMode = elRateMode?.value || "TOTAL";
  const gp = r.GP ?? 0;

  const per15 = (n) => {
    if (n == null) return null;
    if (rateMode !== "P15") return n;
    return gp > 0 ? (n / gp) : null; // games are 15 minutes
  };

  const tdText = (text, cls) => {
    const cell = document.createElement("td");
    if (cls) cell.className = cls;
    cell.textContent = text ?? "";
    return cell;
  };

  const tdNumMaybe = (n, decimals = null, signed = false) => {
    const td = document.createElement("td");
    td.className = "num";

    if (n == null || !isFinite(n)) {
      td.textContent = "";
      return td;
    }

    const v = Number(n);
    const s = (decimals != null) ? v.toFixed(decimals) : String(Math.trunc(v));
    td.textContent = signed && v > 0 ? `+${s}` : s;
    return td;
  };

  const tdPct = (rate) => {
    const td = document.createElement("td");
    td.className = "num";
    if (rate == null || !isFinite(rate)) {
      td.textContent = "";
      return td;
    }
    td.textContent = `${(rate * 100).toFixed(1)}%`;
    return td;
  };

  const td1 = (n) => {
    const td = document.createElement("td");
    td.className = "num";
    if (n == null || !isFinite(n)) {
      td.textContent = "";
      return td;
    }
    td.textContent = n.toFixed(1);
    return td;
  };

  // Logo
  const tdLogo = document.createElement("td");
  tdLogo.className = "logo-cell";
  if (r.bg_color) tdLogo.style.backgroundColor = r.bg_color;
  tdLogo.style.textAlign = "center";

  const img = document.createElement("img");
  img.className = "logo";
  img.alt = `${r.team_name} logo`;
  img.loading = "lazy";
  img.src = `../logos/${seasonId}/${r.team_id}.png`;
  img.onerror = () => (img.style.visibility = "hidden");
  tdLogo.appendChild(img);

  // Team link
  const tdTeam = document.createElement("td");
  const a = document.createElement("a");
  a.className = "team-link";
  a.href = `team.html?season=${encodeURIComponent(seasonId)}&team_id=${encodeURIComponent(r.team_id)}`;
  a.textContent = r.team_name || r.team_id;
  tdTeam.appendChild(a);

  // Derived stats
  const gf = r.GF ?? 0;
  const ga = r.GA ?? 0;
  const sf = r.SF ?? 0;
  const sa = r.SA ?? 0;

  const gdiff = gf - ga;

  const shRate = sf > 0 ? gf / sf : null;
  const svRate = sa > 0 ? (sa - ga) / sa : null;
  const pdo = (shRate != null && svRate != null) ? (shRate + svRate) * 100 : null;

  const xg = (r.xG == null ? null : r.xG);
  const xga = (r.xGA == null ? null : r.xGA);

  const gfax = (xg == null ? null : (gf - xg));
  const gsax = (xga == null ? null : (xga - ga));

  const isPer15 = (rateMode === "P15");

  tr.appendChild(tdLogo);
  tr.appendChild(tdTeam);

  // unchanged by per15 toggle
  tr.appendChild(tdNumMaybe(r.GP, null));
  tr.appendChild(tdNumMaybe(r.W, null));
  tr.appendChild(tdNumMaybe(r.OTW, null));
  tr.appendChild(tdNumMaybe(r.OTL, null));
  tr.appendChild(tdNumMaybe(r.L, null));
  tr.appendChild(elStage.value === "PO" ? tdText("-", "num") : tdNumMaybe(r.PTS, null));

  tr.appendChild(tdNumMaybe(gdiff, null, true));
  tr.appendChild(tdPct(shRate));
  tr.appendChild(tdPct(svRate));

  tr.appendChild(td1(pdo));

  // per15 toggle affects everything below
  tr.appendChild(tdNumMaybe(per15(gf), isPer15 ? 2 : null));
  tr.appendChild(tdNumMaybe(per15(ga), isPer15 ? 2 : null));
  tr.appendChild(tdNumMaybe(per15(sf), isPer15 ? 2 : null));
  tr.appendChild(tdNumMaybe(per15(sa), isPer15 ? 2 : null));

  tr.appendChild(tdNumMaybe(per15(xg), 2));
  tr.appendChild(tdNumMaybe(per15(gfax), 2));
  tr.appendChild(tdNumMaybe(per15(xga), 2));
  tr.appendChild(tdNumMaybe(per15(gsax), 2));

  return tr;
}

function setLoading(isLoading, msg = "") {
  elStatus.hidden = !isLoading;
  elStatus.textContent = msg;
  elTable.hidden = isLoading;
}

function compareByKey(a, b, key, dir) {
  const av = getSortValue(a, key);
  const bv = getSortValue(b, key);

  const aNull = (av == null || Number.isNaN(av));
  const bNull = (bv == null || Number.isNaN(bv));
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;

  const diff = bv - av;
  return (dir === "desc") ? diff : -diff;
}

function getSortValue(r, key) {
  const rateMode = elRateMode?.value || "TOTAL";
  const gp = r.GP ?? 0;

  const per15 = (n) => {
    if (n == null) return null;
    if (rateMode !== "P15") return n;
    return gp > 0 ? (n / gp) : null;
  };

  const gf = r.GF ?? 0;
  const ga = r.GA ?? 0;
  const sf = r.SF ?? 0;
  const sa = r.SA ?? 0;

  const sh = sf > 0 ? gf / sf : null;
  const sv = sa > 0 ? (sa - ga) / sa : null;
  const pdo = (sh != null && sv != null) ? (sh + sv) * 100 : null;

  const xg = (r.xG == null ? null : r.xG);
  const xga = (r.xGA == null ? null : r.xGA);
  const gfax = (xg == null ? null : (gf - xg));
  const gsax = (xga == null ? null : (xga - ga));

  switch (key) {
    // unchanged keys
    case "GP": return r.GP ?? 0;
    case "W": return r.W ?? 0;
    case "OTW": return r.OTW ?? 0;
    case "OTL": return r.OTL ?? 0;
    case "L": return r.L ?? 0;
    case "PTS": return r.PTS ?? 0;
    case "GDIFF": return gf - ga;
    case "SH": return sh;
    case "SV": return sv;
    case "PDO": return pdo;

    // per15-affected keys
    case "GF": return per15(gf);
    case "GA": return per15(ga);
    case "SF": return per15(sf);
    case "SA": return per15(sa);

    case "XG": return per15(xg);
    case "XGA": return per15(xga);
    case "GFAX": return per15(gfax);
    case "GSAX": return per15(gsax);

    default: return null;
  }
}

function updateSortIndicators() {
  const ths = elTable.querySelectorAll("thead th[data-key]");
  ths.forEach(th => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.key === sortKey) {
      th.classList.add(sortDir === "asc" ? "sort-asc" : "sort-desc");
    }
  });
}
