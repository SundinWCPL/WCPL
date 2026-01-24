import { loadCSV, toIntMaybe, toNumMaybe } from "./data.js";
import { initSeasonPicker, getSeasonId, onSeasonChange } from "./season.js";

const elSeason = document.getElementById("seasonSelect");
const elStatus = document.getElementById("status");

const elPos = document.getElementById("posFilter");
const elTeam = document.getElementById("teamFilter");
const elSort = document.getElementById("sortSelect");
const elSearch = document.getElementById("playerSearch");

const elTable = document.getElementById("playersTable");
const elTbody = elTable.querySelector("tbody");
const elThead = elTable.querySelector("thead");
let advOn = false;


let seasons = [];
let teams = [];
let players = [];

boot();

async function boot() {
  await initSeasonPicker(elSeason);

  wireFilters();
  onSeasonChange(() => refresh());

  await refresh();
}

function wireFilters() {
  elPos.addEventListener("change", () => {
    buildSortOptions();
    render();
  });
  elTeam.addEventListener("change", render);
  elSort.addEventListener("change", render);
  elSearch.addEventListener("input", render);
}

async function refresh() {
  const seasonId = getSeasonId();
  if (!seasonId) {
    setLoading(true, "No season found in seasons.csv.");
    return;
  }

  setLoading(true, `Loading ${seasonId}…`);

  try {
    const seasonsPath = `../data/seasons.csv`;
    const teamsPath = `../data/${seasonId}/teams.csv`;
    const playersPath = `../data/${seasonId}/players.csv`;

    [seasons, teams, players] = await Promise.all([
      loadCSV(seasonsPath),
      loadCSV(teamsPath),
      loadCSV(playersPath),
    ]);

    // adv_stats toggle like team.js
    const seasonRow = seasons.find(s => String(s.season_id ?? "").trim() === seasonId);
    advOn = (toIntMaybe(seasonRow?.adv_stats) ?? 0) === 1;
	document.body.classList.toggle("hide-adv", !advOn);

    buildTeamOptions(teams);
    buildSortOptions();

    setLoading(false);
    render();
  } catch (err) {
    console.error(err);
    setLoading(true, `No data exists for Season ${seasonId}.`);
    elTable.hidden = true;
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
  [...opts].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .forEach(id => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      elTeam.appendChild(opt);
    });

  // Preserve selection if possible
  if ([...elTeam.options].some(o => o.value === current)) elTeam.value = current;
}

function buildSortOptions() {
  const mode = elPos.value;

  const options = [
    { value: "name_asc", label: "Name (A→Z)" },
    { value: "team_asc", label: "Team (A→Z)" },
  ];

  if (mode === "GOALIE") {
    options.push(
      { value: "svp_desc", label: "SV%" },
      { value: "gaa_asc", label: "GAA" },
      { value: "w_desc", label: "Wins" },
      { value: "gp_g_desc", label: "GP(G)" },
    );
  } else {
    // ALL or SKATER
    options.push(
      { value: "pts_desc", label: "PTS" },
      { value: "g_desc", label: "Goals" },
      { value: "a_desc", label: "Assists" },
      { value: "gp_s_desc", label: "GP(S)" },
      { value: "shp_desc", label: "SH%" },
    );
  }

  const current = elSort.value || (mode === "GOALIE" ? "svp_desc" : "pts_desc");
  elSort.innerHTML = "";
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    elSort.appendChild(opt);
  }

  if ([...elSort.options].some(o => o.value === current)) elSort.value = current;
  else elSort.value = options[0]?.value ?? "name_asc";
}

function render() {
  const seasonId = getSeasonId();
  const mode = elPos.value;          // "SKATER" or "GOALIE"
  const teamId = elTeam.value;       // "__ALL__" or team_id
  const q = elSearch.value.trim().toLowerCase();
  const sort = elSort.value;

  const teamById = new Map(teams.map(t => [String(t.team_id ?? "").trim(), t]));

  // --- filter ---
  let view = players.slice();

  // position filter (no "All" logic here; if you still have it in HTML, it will behave like SKATER)
  if (mode === "GOALIE") view = view.filter(p => (toIntMaybe(p.gp_g) ?? 0) > 0);
  else view = view.filter(p => (toIntMaybe(p.gp_s) ?? 0) > 0);

  if (teamId !== "__ALL__") {
    view = view.filter(p => String(p.team_id ?? "").trim() === teamId);
  }

  if (q) {
    view = view.filter(p =>
      (p.name ?? "").toLowerCase().includes(q) ||
      (p.team_id ?? "").toLowerCase().includes(q) ||
      (p.position ?? "").toLowerCase().includes(q)
    );
  }

  // --- map/decorate ---
  const rows = view.map(p => {
    const g = toIntMaybe(p.g) ?? 0;

    const shotsRaw = (p.shots ?? "").toString().trim();
    const shotsVal = shotsRaw === "" ? null : Number(shotsRaw);
    const shots = Number.isFinite(shotsVal) ? shotsVal : null;
    const shp = (shots !== null && shots > 0) ? (g / shots) * 100 : null;

    return {
      player_key: (p.player_key ?? "").trim(),
      name: (p.name ?? "").trim(),
      pos: (p.position ?? "").trim(),
      team_id: (p.team_id ?? "").trim(),

      gp_s: toIntMaybe(p.gp_s) ?? 0,
      g,
      a: toIntMaybe(p.a) ?? 0,
      pts: toIntMaybe(p.pts) ?? 0,
      ppg: toNumMaybe(p.p_per_gp),
      shots: (shots !== null ? Math.trunc(shots) : null),
      shp,

      hits: toIntMaybe(p.hits),
      ta: toIntMaybe(p.takeaways),
      to: toIntMaybe(p.turnovers),

      gp_g: toIntMaybe(p.gp_g) ?? 0,
      svp: toNumMaybe(p.sv_pct), // 0-1
      gaa: toNumMaybe(p.gaa),
      w: toIntMaybe(p.wins),
      so: toIntMaybe(p.so),

      team: teamById.get((p.team_id ?? "").trim()),
    };
  });

  // --- sort ---
  rows.sort((a, b) => {
    switch (sort) {
      case "name_asc": return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      case "team_asc": return a.team_id.localeCompare(b.team_id, undefined, { sensitivity: "base" });

      // skater sorts
      case "pts_desc": return (b.pts - a.pts) || (b.g - a.g) || a.name.localeCompare(b.name);
      case "g_desc": return (b.g - a.g) || (b.pts - a.pts) || a.name.localeCompare(b.name);
      case "a_desc": return (b.a - a.a) || (b.pts - a.pts) || a.name.localeCompare(b.name);
      case "gp_s_desc": return (b.gp_s - a.gp_s) || (b.pts - a.pts) || a.name.localeCompare(b.name);
      case "shp_desc": return ((b.shp ?? -1) - (a.shp ?? -1)) || (b.pts - a.pts) || a.name.localeCompare(b.name);

      // goalie sorts
      case "svp_desc": return ((b.svp ?? -1) - (a.svp ?? -1)) || ((b.w ?? 0) - (a.w ?? 0)) || a.name.localeCompare(b.name);
      case "gaa_asc": return ((a.gaa ?? 999) - (b.gaa ?? 999)) || ((b.w ?? 0) - (a.w ?? 0)) || a.name.localeCompare(b.name);
      case "w_desc": return ((b.w ?? 0) - (a.w ?? 0)) || ((b.gp_g ?? 0) - (a.gp_g ?? 0)) || a.name.localeCompare(b.name);
      case "gp_g_desc": return (b.gp_g - a.gp_g) || ((b.w ?? 0) - (a.w ?? 0)) || a.name.localeCompare(b.name);

      default: return 0;
    }
  });

  // --- header + body ---
  renderHeader(mode, advOn);
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
    img.alt = `${r.team_id} logo`;
    img.src = `../logos/${seasonId}/${r.team_id}.png`;
    img.onerror = () => (img.style.visibility = "hidden");
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
    const aTeam = document.createElement("a");
    aTeam.className = "team-link";
    aTeam.href = `team.html?season=${encodeURIComponent(seasonId)}&team_id=${encodeURIComponent(r.team_id)}`;
    aTeam.textContent = r.team_id;
    tdTeam.appendChild(aTeam);

    tr.appendChild(tdLogo);
    tr.appendChild(tdPlayer);
    tr.appendChild(td(r.pos));
    tr.appendChild(tdTeam);

    if (mode === "GOALIE") {
      tr.appendChild(tdNum(r.gp_g));
      tr.appendChild(tdPctMaybe(r.svp !== null ? r.svp * 100 : null, 1));
      tr.appendChild(tdNumMaybe(r.gaa, 2));
      tr.appendChild(tdNumMaybe(r.w));
      tr.appendChild(tdNumMaybe(r.so));
    } else {
      tr.appendChild(tdNum(r.gp_s));
      tr.appendChild(tdNum(r.g));
      tr.appendChild(tdNum(r.a));
      tr.appendChild(tdNum(r.pts));
      tr.appendChild(tdNumMaybe(r.ppg, 2));
      tr.appendChild(tdNumMaybe(r.shots));
      tr.appendChild(tdPctMaybe(r.shp, 1));

      if (advOn) {
        tr.appendChild(tdNumMaybe(r.hits, null, true));
        tr.appendChild(tdNumMaybe(r.ta, null, true));
        tr.appendChild(tdNumMaybe(r.to, null, true));
      }
    }

    elTbody.appendChild(tr);
  }

  elTable.hidden = false;
  elStatus.hidden = true;
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

  // Common
  cols.push({ label: "", cls: "" });
  cols.push({ label: "Player", cls: "left" });
  cols.push({ label: "Pos", cls: "left" });
  cols.push({ label: "Team", cls: "left" });

  if (mode === "GOALIE") {
    cols.push(
      { label: "GP(G)", cls: "num" },
      { label: "SV%", cls: "num" },
      { label: "GAA", cls: "num" },
      { label: "W", cls: "num" },
      { label: "SO", cls: "num" },
    );
  } else {
    // SKATER
    cols.push(
      { label: "GP(S)", cls: "num" },
      { label: "G", cls: "num" },
      { label: "A", cls: "num" },
      { label: "PTS", cls: "num" },
      { label: "P/GP", cls: "num" },
      { label: "S", cls: "num" },
      { label: "SH%", cls: "num" },
    );

    if (advOn) {
      cols.push(
        { label: "HIT", cls: "num adv" },
        { label: "TA", cls: "num adv" },
        { label: "TO", cls: "num adv" },
      );
    }
  }

  const tr = document.createElement("tr");
  for (const c of cols) {
    const th = document.createElement("th");
    th.textContent = c.label;
    if (c.cls) th.className = c.cls;
    tr.appendChild(th);
  }

  elThead.innerHTML = "";
  elThead.appendChild(tr);
}

