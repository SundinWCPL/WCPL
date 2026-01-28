import { loadCSV } from "./data.js";
import { initSeasonPicker, getSeasonId, onSeasonChange } from "./season.js";

const elSeason = document.getElementById("seasonSelect");
const elStatus = document.getElementById("status");
const elTable  = document.getElementById("fantasyTable");
const elTbody  = document.getElementById("fantasyTbody");

const elLeagueWrap = document.getElementById("leagueFilterWrap");
const elLeagueSel  = document.getElementById("leagueSelect");

let fantasyRows = [];
let playersRows = [];
let leagueFilter = null;

boot();

async function boot() {
  await initSeasonPicker(elSeason);
  onSeasonChange(() => refresh());
  wireLeagueFilter();
  await refresh();
}

function wireLeagueFilter() {
  elLeagueSel.addEventListener("change", () => {
    leagueFilter = elLeagueSel.value || null;
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

  try {
    const fantasyPath = `../data/${seasonId}/fantasy.csv`;
    const playersPath = `../data/${seasonId}/players.csv`;

    [fantasyRows, playersRows] = await Promise.all([
      loadCSV(fantasyPath),
      loadCSV(playersPath)
    ]);

    buildLeagueOptions(fantasyRows);
    setLoading(false);
    render();
  } catch (err) {
    console.error(err);
    setLoading(true, `No data exists for Season ${seasonId}.`);
    elTable.hidden = true;
  }
}

function buildLeagueOptions(rows) {
  const leagues = [...new Set(rows.map(r => String(r.league ?? "").trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })
  );

  if (leagues.length <= 1) {
    elLeagueWrap.hidden = true;
    leagueFilter = null;
    elLeagueSel.innerHTML = "";
    return;
  }

  elLeagueWrap.hidden = false;
  elLeagueSel.innerHTML = "";

  const all = document.createElement("option");
  all.value = "";
  all.textContent = "All";
  elLeagueSel.appendChild(all);

  for (const lg of leagues) {
    const opt = document.createElement("option");
    opt.value = lg;
    opt.textContent = lg;
    elLeagueSel.appendChild(opt);
  }

  // keep selection if possible
  if (leagueFilter && [...elLeagueSel.options].some(o => o.value === leagueFilter)) {
    elLeagueSel.value = leagueFilter;
  } else {
    elLeagueSel.value = "";
    leagueFilter = null;
  }
}

function render() {
  const pmap = new Map();
  for (const p of playersRows) {
    const key = String(p.player_key ?? "").trim();
    if (key) pmap.set(key, p);
  }

  // Build team blocks
  let blocks = fantasyRows
    .filter(r => {
      const lg = String(r.league ?? "").trim();
      return !leagueFilter || lg === leagueFilter;
    })
    .map(r => {
      const teamName = String(r.gm_id ?? "").trim(); // FULL gm_id string as requested

      const keys = [r.skater1, r.skater2, r.skater3, r.goalie1].map(x => String(x ?? "").trim()).filter(Boolean);

      const players = keys.map(k => {
        const prow = pmap.get(k);
        const sp = toNum(prow?.sp);
        const displayName = (prow?.name && String(prow.name).trim()) ? String(prow.name).trim() : stripNamePrefix(k);
        return { key: k, displayName, sp };
      });

      // sort within team by SP desc
      players.sort((a, b) => (b.sp - a.sp) || a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));

      const totalSp = players.reduce((sum, x) => sum + (x.sp || 0), 0);

      // ensure exactly 4 rows for layout consistency
      while (players.length < 4) players.push({ key: "", displayName: "", sp: 0 });

      return { teamName, players, totalSp };
    });

  // sort overall by Total SP desc
  blocks.sort((a, b) => (b.totalSp - a.totalSp) || a.teamName.localeCompare(b.teamName, undefined, { sensitivity: "base" }));

  // Render
  elTbody.innerHTML = "";

  for (const team of blocks) {
    for (let i = 0; i < 4; i++) {
      const p = team.players[i];
      const tr = document.createElement("tr");

if (i === 0) {
  tr.classList.add("team-start");
}

      if (i === 0) {
        const tdTeam = document.createElement("td");
        tdTeam.className = "team-cell";
        tdTeam.rowSpan = 4;
        tdTeam.textContent = team.teamName; // full gm_id
        tr.appendChild(tdTeam);
      }

const tdPlayer = document.createElement("td");
tdPlayer.className = "player-cell";

if (p.key) {
  const a = document.createElement("a");
  a.href = `player.html?season=${encodeURIComponent(getSeasonId())}&player_key=${encodeURIComponent(p.key)}`;
  a.className = "player-link";
  a.textContent = p.displayName || "";
  tdPlayer.appendChild(a);
} else {
  tdPlayer.textContent = p.displayName || "";
}

tr.appendChild(tdPlayer);

const tdSp = document.createElement("td");
tdSp.className = "sp-cell";
tdSp.textContent = p.displayName ? String(p.sp ?? 0) : "";
      tr.appendChild(tdSp);

      if (i === 0) {
        const tdTotal = document.createElement("td");
        tdTotal.className = "total-sp";
        tdTotal.rowSpan = 4;
        tdTotal.textContent = String(team.totalSp ?? 0);
        tr.appendChild(tdTotal);
      }

      elTbody.appendChild(tr);
    }
  }

  elTable.hidden = false;
}

function setLoading(isLoading, msg = "") {
  elStatus.hidden = !isLoading;
  elStatus.textContent = msg;
  elTable.hidden = isLoading;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function stripNamePrefix(s) {
  const x = String(s ?? "");
  return x.startsWith("name:") ? x.slice(5) : x;
}
