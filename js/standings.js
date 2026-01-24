// js/standings.js
import { loadCSV, toIntMaybe } from "./data.js";
import { initSeasonPicker, getSeasonId, onSeasonChange } from "./season.js";

const elSeason = document.getElementById("seasonSelect");
const elStatus = document.getElementById("status");
const elTable = document.getElementById("standingsTable");
const elTbody = elTable.querySelector("tbody");
const elConf = document.getElementById("confFilter");

let teamRows = [];
let standings = [];

boot();

async function boot() {
  await initSeasonPicker(elSeason);
  elConf.addEventListener("change", render);

  onSeasonChange(() => refresh());
  await refresh();
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
    const schedPath = `../data/${seasonId}/schedule.csv`;

    teamRows = await loadCSV(teamsPath);
    const games = await loadCSV(gamesPath);
    const schedule = await loadCSV(schedPath);

    buildConferenceOptions(teamRows);
    standings = computeStandings(teamRows, games, schedule);

    setLoading(false);
    render();
  } catch (err) {
    console.error(err);
    setLoading(true, `No data exists for Season ${seasonId}.`);
    elTable.hidden = true;
  }
}

function buildConferenceOptions(teams) {
  const set = new Set();
  for (const t of teams) {
    const c = (t.conference ?? "").trim();
    if (c) set.add(c);
  }

  const current = elConf.value || "__ALL__";
  elConf.innerHTML = `<option value="__ALL__">All</option>`;

  [...set].sort((a, b) => a.localeCompare(b)).forEach(c => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    elConf.appendChild(opt);
  });

  elConf.value = [...elConf.options].some(o => o.value === current) ? current : "__ALL__";
}

function computeStandings(teamRows, gameRows, scheduleRows) {
  // match_id -> stage (reg / playoffs / etc.)
  const stageByMatch = new Map();
  for (const s of scheduleRows) {
    if (s.match_id && s.stage) {
      stageByMatch.set(s.match_id.trim(), s.stage.trim().toLowerCase());
    }
  }

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
      GP: 0,
      W: 0,
      OTW: 0,
      L: 0,   // regulation loss
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

    const matchId = (g.match_id ?? "").trim();
    const stage = stageByMatch.get(matchId);

    // Regular season only
    if (stage !== "reg") continue;

    const hg = toIntMaybe(g.home_goals);
    const ag = toIntMaybe(g.away_goals);
    const ot = toIntMaybe(g.ot) ?? 0;

    if (hg === null || ag === null) continue;

    const homeRow = tmap.get(home);
    const awayRow = tmap.get(away);
    if (!homeRow || !awayRow) continue;

    homeRow.GP += 1;
    awayRow.GP += 1;

    homeRow.GF += hg; homeRow.GA += ag;
    awayRow.GF += ag; awayRow.GA += hg;

    const isOT = ot > 0;
    const homeWin = hg > ag;
    const awayWin = ag > hg;

    if (!homeWin && !awayWin) continue;

    if (!isOT) {
      // Reg: W=3, L=0
      if (homeWin) {
        homeRow.W += 1; homeRow.PTS += 3;
        awayRow.L += 1;
      } else {
        awayRow.W += 1; awayRow.PTS += 3;
        homeRow.L += 1;
      }
    } else {
      // OT: OTW=2, OTL=1
      if (homeWin) {
        homeRow.OTW += 1; homeRow.PTS += 2;
        awayRow.OTL += 1; awayRow.PTS += 1;
      } else {
        awayRow.OTW += 1; awayRow.PTS += 2;
        homeRow.OTL += 1; homeRow.PTS += 1;
      }
    }
  }

  const out = [...tmap.values()].map(r => ({
    ...r,
    DIFF: r.GF - r.GA,
  }));

  // Sort: PTS desc, DIFF desc, GF desc, GA asc, Team name
  out.sort((a, b) => {
    if (a.conference !== b.conference) return a.conference.localeCompare(b.conference);
    if (b.PTS !== a.PTS) return b.PTS - a.PTS;
    if (b.DIFF !== a.DIFF) return b.DIFF - a.DIFF;
    if (b.GF !== a.GF) return b.GF - a.GF;
    if (a.GA !== b.GA) return a.GA - b.GA;
    return a.team_name.localeCompare(b.team_name);
  });

  // Assign rank within conference
  const rankByConf = new Map();
  for (const r of out) {
    const c = r.conference || "";
    rankByConf.set(c, (rankByConf.get(c) ?? 0) + 1);
    r.RK = rankByConf.get(c);
  }

  return out;
}

function render() {
  const seasonId = getSeasonId();
  if (!seasonId) return;

  const conf = elConf.value || "__ALL__";
  const rows = standings.filter(r => conf === "__ALL__" ? true : r.conference === conf);

  if (!rows.length) {
    setLoading(true, `No data exists for Season ${seasonId}.`);
    elTable.hidden = true;
    return;
  }

  elTbody.innerHTML = "";

  for (const r of rows) {
    const tr = document.createElement("tr");

    // RK
    const tdRk = document.createElement("td");
    tdRk.className = "num";
    tdRk.textContent = String(r.RK ?? "");
    tr.appendChild(tdRk);

    // Logo
    const tdLogo = document.createElement("td");
    tdLogo.className = "logo-cell";
    if (r.bg_color) tdLogo.style.backgroundColor = r.bg_color;

    const img = document.createElement("img");
    img.className = "logo";
    img.alt = `${r.team_id} logo`;
    img.loading = "lazy";
    img.src = `../logos/${seasonId}/${r.team_id}.png`;
    img.onerror = () => (img.style.visibility = "hidden");

    tdLogo.appendChild(img);
    tr.appendChild(tdLogo);

    // Team link
    const tdTeam = document.createElement("td");
    const a = document.createElement("a");
    a.className = "team-link";
    a.href = `team.html?season=${encodeURIComponent(seasonId)}&team_id=${encodeURIComponent(r.team_id)}`;
    a.textContent = r.team_name || r.team_id;
    tdTeam.appendChild(a);
    tr.appendChild(tdTeam);

    // Conference
    const tdConf = document.createElement("td");
    tdConf.textContent = r.conference || "";
    tr.appendChild(tdConf);

    // Numbers
    tr.appendChild(tdNum(r.GP));
    tr.appendChild(tdNum(r.W));
    tr.appendChild(tdNum(r.OTW));
    tr.appendChild(tdNum(r.L));
    tr.appendChild(tdNum(r.OTL));
    tr.appendChild(tdNum(r.PTS));
    tr.appendChild(tdNum(r.GF));
    tr.appendChild(tdNum(r.GA));
    tr.appendChild(tdNum(r.DIFF));

    elTbody.appendChild(tr);
  }

  setLoading(false);
  elTable.hidden = false;
}

function tdNum(v) {
  const td = document.createElement("td");
  td.className = "num";
  td.textContent = (v ?? "") === "" ? "" : String(v);
  return td;
}

function setLoading(isLoading, msg = "") {
  elStatus.hidden = !isLoading;
  elStatus.textContent = msg;
  elTable.hidden = isLoading;
}
