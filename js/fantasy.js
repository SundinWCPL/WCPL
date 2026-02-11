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
    resetLeagueUI();
    fantasyRows = [];
    playersRows = [];
    return;
  }

  setLoading(true, `Loading ${seasonId}…`);
  resetLeagueUI();            // NEW: clear old S2 UI immediately
  fantasyRows = [];           // NEW: clear old data immediately
  playersRows = [];           // NEW

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

    // NEW: ensure no stale S2 state leaks into S1
    resetLeagueUI();
    fantasyRows = [];
    playersRows = [];

    setLoading(true, `No data exists for Season ${seasonId}.`);
    elTable.hidden = true;
  }
}

function buildLeagueOptions(rows) {
  const leagues = [...new Set(
    rows.map(r => String(r.league ?? "").trim()).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  // If only one league, hide selector and lock it in
  if (leagues.length <= 1) {
    elLeagueWrap.hidden = true;
    leagueFilter = leagues[0] ?? null;
    elLeagueSel.innerHTML = "";
    return;
  }

  elLeagueWrap.hidden = false;
  elLeagueSel.innerHTML = "";

  for (const lg of leagues) {
    const opt = document.createElement("option");
    opt.value = lg;
    opt.textContent = lg;
    elLeagueSel.appendChild(opt);
  }

  // Always force a valid league selection
  if (!leagueFilter || !leagues.includes(leagueFilter)) {
    leagueFilter = leagues[0];
  }

  elLeagueSel.value = leagueFilter;
}

function render() {
	 if (!fantasyRows.length || !playersRows.length || !leagueFilter) {
    elTbody.innerHTML = "";
    elTable.hidden = true;
    return;
  }
  const pmap = new Map();
  for (const p of playersRows) {
    const key = String(p.player_key ?? "").trim();
    if (key) pmap.set(key, p);
  }

  // Build team blocks
  let blocks = fantasyRows
    .filter(r => {
      const lg = String(r.league ?? "").trim();
      return lg === leagueFilter;
    })
    .map(r => {
      const teamName = String(r.gm_id ?? "").trim(); // FULL gm_id string as requested

      // Dynamically grab all playerN columns
const keys = Object.keys(r)
  .filter(k => /^player\d+$/i.test(k))
  .sort((a, b) => {
    const na = Number(a.replace(/\D/g, ""));
    const nb = Number(b.replace(/\D/g, ""));
    return na - nb;
  })
  .map(k => String(r[k] ?? "").trim())
  .filter(Boolean);

      const players = keys.map(k => {
        const prow = pmap.get(k);
        const sp = computeFantasyPointsFromPlayerRow(prow);
        const displayName = (prow?.name && String(prow.name).trim()) ? String(prow.name).trim() : stripNamePrefix(k);
        return { key: k, displayName, sp };
      });


      // sort within team by SP desc
      players.sort((a, b) => (b.sp - a.sp) || a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
	  
	  const rowCount = players.length;

      const totalSp = players.reduce((sum, x) => sum + (x.sp || 0), 0);

      return { teamName, players, totalSp, rowCount };
    });

  // sort overall by Total SP desc
  blocks.sort((a, b) => (b.totalSp - a.totalSp) || a.teamName.localeCompare(b.teamName, undefined, { sensitivity: "base" }));

  // Render
  elTbody.innerHTML = "";

  for (const team of blocks) {
    for (let i = 0; i < team.rowCount; i++) {
      const p = team.players[i];
      const tr = document.createElement("tr");

if (i === 0) {
  tr.classList.add("team-start");
}

      if (i === 0) {
        const tdTeam = document.createElement("td");
        tdTeam.className = "team-cell";
        tdTeam.rowSpan = team.rowCount;
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
tdSp.textContent = p.displayName ? fmtPts(p.sp) : "";
      tr.appendChild(tdSp);

      if (i === 0) {
        const tdTotal = document.createElement("td");
        tdTotal.className = "total-sp";
        tdTotal.rowSpan = team.rowCount;
        tdTotal.textContent = fmtPts(team.totalSp);
        tr.appendChild(tdTotal);
      }

      elTbody.appendChild(tr);
    }
  }

  elTable.hidden = false;
}
function isGoalieRow(p) {
  const pos = String(p?.position ?? "").trim().toUpperCase();
  if (pos === "G" || pos === "GK" || pos === "GOALIE") return true;

  // fallback if position isn't clean
  return toNum(p?.gp_g) > 0;
}

function computeFantasyPointsFromPlayerRow(p) {
  if (!p) return 0;

  // Skater-equivalent columns in players.csv
  const sk = (
    toNum(p.g) * 65 +
    toNum(p.a) * 30 +
    toNum(p.shots) * 5 +         // maps to sog in your JSON
    toNum(p.passes) * 2.5 +
    toNum(p.takeaways) * 7.5 +
    toNum(p.turnovers) * -5 +
    toNum(p.entries) * 1 +
    toNum(p.exits) * 1 +
    toNum(p.hits) * 2.5
  );

  if (!isGoalieRow(p)) return sk;

  // --- Goalie scoring ---
const sa = toNum(p.sa);
const ga = toNum(p.ga);
const saves = Math.max(0, sa - ga);

const shutouts = toNum(p.so);   // per-shutout
const wins = toNum(p.wins) || toNum(p.w) || 0;

return (
  saves * 10 +
  shutouts * 50 +
  wins * 50 +
  toNum(p.passes) * 2.5 +
  toNum(p.g) * 65 +
  toNum(p.a) * 30
);
}

function fmtPts(x) {
  const n = toNum(x);
  if (Number.isInteger(n)) return String(n);
  // keep it readable (weights are .5 increments)
  return n.toFixed(1);
}

function setLoading(isLoading, msg = "") {
  elStatus.hidden = !isLoading;
  elStatus.textContent = msg;
  elTable.hidden = isLoading;
}

function resetLeagueUI() {
  elLeagueWrap.hidden = true;
  elLeagueSel.innerHTML = "";
  leagueFilter = null;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function stripNamePrefix(s) {
  const x = String(s ?? "");
  return x.startsWith("name:") ? x.slice(5) : x;
}
