// js/teams.js
import { loadCSV, toIntMaybe } from "./data.js";
import { initSeasonPicker, getSeasonId, onSeasonChange } from "./season.js";

const elSeason = document.getElementById("seasonSelect");
const elStatus = document.getElementById("status");
const elTable = document.getElementById("teamsTable");
const elTbody = elTable.querySelector("tbody");
const elConf = document.getElementById("confFilter");
const elSearch = document.getElementById("teamSearch");

let teams = [];      // from teams.csv
let standings = [];  // computed rows

boot();

async function boot() {
  await initSeasonPicker(elSeason);

  wireFilters();
  onSeasonChange(() => refresh());

  await refresh();
}

function wireFilters() {
  elConf.addEventListener("change", render);
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
    const teamsPath = `../data/${seasonId}/teams.csv`;
    const gamesPath = `../data/${seasonId}/games.csv`;

    teams = await loadCSV(teamsPath);
    const games = await loadCSV(gamesPath);

    // Build conference filter options dynamically (free-text conferences)
    buildConferenceOptions(teams);

    // Compute standings
    standings = computeStandings(teams, games);

    setLoading(false);
    render();
  } catch (err) {
    console.error(err);
    setLoading(true, `Failed to load season data. Check paths and CSV formatting.`);
    elTable.hidden = true;
  }
}

function buildConferenceOptions(teamRows) {
  const confs = new Set();
  for (const t of teamRows) {
    const c = (t.conference ?? "").trim();
    if (c) confs.add(c);
  }

  const current = elConf.value || "__ALL__";
  elConf.innerHTML = `<option value="__ALL__">All</option>`;
  [...confs].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .forEach(c => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      elConf.appendChild(opt);
    });

  // Preserve selection if possible
  if ([...elConf.options].some(o => o.value === current)) elConf.value = current;
}

function computeStandings(teamRows, gameRows) {
  // Index teams by team_id
  const tmap = new Map();
  for (const t of teamRows) {
    const team_id = (t.team_id ?? "").trim();
    if (!team_id) continue;

    tmap.set(team_id, {
      team_id,
      team_name: (t.team_name ?? "").trim(),
      conference: (t.conference ?? "").trim(),
      bg_color: (t.bg_color ?? "").trim(),
      text_color: (t.text_color ?? "").trim(),
      // computed:
      GP: 0,
      W: 0,
      OTW: 0,
      L: 0,    // regulation losses
      OTL: 0,
      PTS: 0,
      GF: 0,
      GA: 0,
    });
  }

  for (const g of gameRows) {
    const home = (g.home_team_id ?? "").trim();
    const away = (g.away_team_id ?? "").trim();
    if (!home || !away) continue;

    const hg = toIntMaybe(g.home_goals);
    const ag = toIntMaybe(g.away_goals);
    const ot = toIntMaybe(g.ot) ?? 0;

    // If a "played" game row exists, goals should be present;
    // if not, skip safely.
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

    const isOT = ot > 0;

    // Determine winner/loser
    const homeWin = hg > ag;
    const awayWin = ag > hg;

    if (!homeWin && !awayWin) {
      // If ties exist in your league, tell me now.
      // For now: ignore tie handling (shouldn't happen).
      continue;
    }

    if (!isOT) {
      // Regulation: W=3, L=0
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
      // OT: OTW=2, OTL=1
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

  // Output array + derived diff
  const out = [...tmap.values()].map(r => ({
    ...r,
    DIFF: r.GF - r.GA,
  }));

  // Default sort: PTS desc, DIFF desc, GF desc, team_name asc
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
  const q = elSearch.value.trim().toLowerCase();

  let view = standings.slice();

  if (conf !== "__ALL__") {
    view = view.filter(r => (r.conference ?? "") === conf);
  }

  if (q) {
    view = view.filter(r =>
      (r.team_name ?? "").toLowerCase().includes(q) ||
      (r.team_id ?? "").toLowerCase().includes(q)
    );
  }

  elTbody.innerHTML = "";
  const seasonId = getSeasonId();

  for (const r of view) {
    const tr = document.createElement("tr");

    // Logo
    const tdLogo = document.createElement("td");
    tdLogo.className = "logo-cell";
    const img = document.createElement("img");
    img.className = "logo";
    img.alt = `${r.team_name} logo`;
    img.loading = "lazy";
    img.src = `../logos/${seasonId}/${r.team_id}.png`;
    img.onerror = () => (img.style.visibility = "hidden");
    tdLogo.appendChild(img);

    // Team cell (clickable)
    const tdTeam = document.createElement("td");
    const a = document.createElement("a");
    a.className = "team-link";
    a.href = `team.html?season=${encodeURIComponent(seasonId)}&team_id=${encodeURIComponent(r.team_id)}`;
    a.textContent = r.team_name || r.team_id;
    tdTeam.appendChild(a);

    // Conference
    const tdConf = document.createElement("td");
    tdConf.textContent = r.conference ?? "";

    // Optional: apply team colors (non-invasive)
    if (r.bg_color) tdTeam.style.backgroundColor = r.bg_color;
    if (r.text_color) tdTeam.style.color = r.text_color;

    tr.appendChild(tdLogo);
    tr.appendChild(tdTeam);
    tr.appendChild(tdConf);
    tr.appendChild(tdNum(r.GP));
    tr.appendChild(tdNum(r.W));
    tr.appendChild(tdNum(r.OTW));
    tr.appendChild(tdNum(r.L));
    tr.appendChild(tdNum(r.OTL));
    tr.appendChild(tdNum(r.PTS));
    tr.appendChild(tdNum(r.GF));
    tr.appendChild(tdNum(r.GA));
    tr.appendChild(tdNumSigned(r.DIFF));

    elTbody.appendChild(tr);
  }

  elTable.hidden = false;
}

function tdNum(n) {
  const td = document.createElement("td");
  td.className = "num";
  td.textContent = String(n ?? 0);
  return td;
}

function tdNumSigned(n) {
  const td = document.createElement("td");
  td.className = "num";
  const v = n ?? 0;
  td.textContent = v > 0 ? `+${v}` : String(v);
  return td;
}

function setLoading(isLoading, msg = "") {
  elStatus.hidden = !isLoading;
  elStatus.textContent = msg;
  elTable.hidden = isLoading;
}
