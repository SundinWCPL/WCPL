// js/season.js
import { loadCSV, truthy01 } from "./data.js";

function dataBase() {
  const path = window.location.pathname || "";
  return path.includes("/pages/") ? "../data" : "data";
}

function seasonsPath() {
  return new URL(`${dataBase()}/seasons.csv`, window.location.href).toString();
}

const LS_KEY = "wcpl_season";
const LS_DIVISION_KEY_PREFIX = "wcpl_division_";

let seasons = [];
let divisions = [];
let currentSeasonId = null;
let currentDivisionId = null;
let divisionSelectEl = null;
const listeners = new Set();

export async function initSeasonPicker(selectEl) {
  seasons = await loadCSV(seasonsPath());

  const urlSeason = getUrlParam("season");
  const savedSeason = getSavedSeason();
  const active = seasons.find(s => truthy01(s.is_active));
  const first = seasons[0];

  currentSeasonId =
    (urlSeason && seasons.some(s => s.season_id === urlSeason)) ? urlSeason :
    (savedSeason && seasons.some(s => s.season_id === savedSeason)) ? savedSeason :
    (active?.season_id ?? first?.season_id ?? null);

  selectEl.innerHTML = "";
  for (const s of seasons) {
    const opt = document.createElement("option");
    opt.value = s.season_id;
    opt.textContent = s.season_name ? `${s.season_name} (${s.season_id})` : s.season_id;
    selectEl.appendChild(opt);
  }

  if (currentSeasonId) selectEl.value = currentSeasonId;

  await initDivisionPicker(selectEl);

  if (currentSeasonId) {
    setUrlParam("season", currentSeasonId);
    saveSeason(currentSeasonId);
  }
  syncDivisionUrl();

  selectEl.addEventListener("change", async () => {
    const next = selectEl.value;
    if (!next || next === currentSeasonId) return;
    currentSeasonId = next;
    setUrlParam("season", currentSeasonId);
    saveSeason(currentSeasonId);
    await initDivisionPicker(selectEl);
    syncDivisionUrl();
    notify();
  });
}

async function initDivisionPicker(seasonSelectEl) {
  divisions = await loadDivisions(currentSeasonId);

  if (!divisionSelectEl) {
    divisionSelectEl = document.getElementById("divisionSelect");
  }

  if (!divisionSelectEl && divisions.length) {
    divisionSelectEl = document.createElement("select");
    divisionSelectEl.id = "divisionSelect";
    divisionSelectEl.className = seasonSelectEl.className || "";
    divisionSelectEl.title = "Division";
    divisionSelectEl.style.marginLeft = "8px";
    seasonSelectEl.insertAdjacentElement("afterend", divisionSelectEl);

    divisionSelectEl.addEventListener("change", () => {
      const next = divisionSelectEl.value;
      if (!next || next === currentDivisionId) return;
      currentDivisionId = next;
      saveDivision(currentSeasonId, currentDivisionId);
      syncDivisionUrl();
      notify();
    });
  }

  if (!divisionSelectEl) {
    currentDivisionId = null;
    return;
  }

  if (!divisions.length) {
    currentDivisionId = null;
    divisionSelectEl.hidden = true;
    divisionSelectEl.innerHTML = "";
    return;
  }

  const urlDivision = getUrlParam("division");
  const savedDivision = getSavedDivision(currentSeasonId);
  const first = divisions[0];

  currentDivisionId =
    (urlDivision && divisions.some(d => d.division_id === urlDivision)) ? urlDivision :
    (savedDivision && divisions.some(d => d.division_id === savedDivision)) ? savedDivision :
    (first?.division_id ?? null);

  divisionSelectEl.innerHTML = "";
  for (const d of divisions) {
    const opt = document.createElement("option");
    opt.value = d.division_id;
    opt.textContent = d.division_name || d.division_id;
    divisionSelectEl.appendChild(opt);
  }

  if (currentDivisionId) {
    divisionSelectEl.value = currentDivisionId;
    saveDivision(currentSeasonId, currentDivisionId);
  }
  divisionSelectEl.hidden = false;
}

async function loadDivisions(seasonId) {
  if (!seasonId) return [];
  const path = `${dataBase()}/${seasonId}/divisions.csv`;
  try {
    const rows = await loadCSV(path);
    return rows
      .map(r => ({
        division_id: String(r.division_id ?? "").trim(),
        division_name: String(r.division_name ?? r.name ?? "").trim()
      }))
      .filter(r => r.division_id);
  } catch {
    return [];
  }
}

export function getSeasonId() {
  return currentSeasonId;
}

export function getDivisionId() {
  return currentDivisionId;
}

export function hasDivisions() {
  return !!currentDivisionId;
}

export function getDataPath(fileName, seasonId = currentSeasonId, divisionId = currentDivisionId) {
  if (!seasonId) return `${dataBase()}/${fileName}`;
  const clean = String(fileName ?? "").replace(/^\/+/, "");

  // Division folders only apply to the currently selected season.
  // This keeps career aggregation from accidentally looking for old seasons at
  // data/S1/D1/... or data/S2/D1/... while viewing S3/D1.
  const useDivision = divisionId && String(seasonId) === String(currentSeasonId);

  return useDivision
    ? `${dataBase()}/${seasonId}/${divisionId}/${clean}`
    : `${dataBase()}/${seasonId}/${clean}`;
}

const LOGO_VERSION = "2026-08-25-1";

export function getLogoPath(teamId, seasonId = currentSeasonId) {
  const cleanTeam = encodeURIComponent(String(teamId ?? "").trim());
  const prefix = (window.location.pathname || "").includes("/pages/") ? "../logos" : "logos";
  return `${prefix}/${seasonId}/${cleanTeam}.png?v=${encodeURIComponent(LOGO_VERSION)}`;
}

export function onSeasonChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function withSeason(href, seasonId = currentSeasonId, divisionId = currentDivisionId) {
  if (!seasonId) return href;
  const url = new URL(href, window.location.href);
  url.searchParams.set("season", seasonId);
  if (divisionId) url.searchParams.set("division", divisionId);
  else url.searchParams.delete("division");
  return url.pathname + url.search;
}

function notify() {
  for (const cb of listeners) cb(currentSeasonId, currentDivisionId);
}

function getUrlParam(key) {
  const url = new URL(window.location.href);
  return url.searchParams.get(key);
}

function setUrlParam(key, val) {
  const url = new URL(window.location.href);
  if (val === null || val === undefined || val === "") url.searchParams.delete(key);
  else url.searchParams.set(key, val);
  window.history.replaceState({}, "", url);
}

function syncDivisionUrl() {
  if (currentDivisionId) setUrlParam("division", currentDivisionId);
  else setUrlParam("division", null);
}

function getSavedSeason() {
  try { return localStorage.getItem(LS_KEY); } catch { return null; }
}
function saveSeason(seasonId) {
  try { localStorage.setItem(LS_KEY, seasonId); } catch {}
}
function getSavedDivision(seasonId) {
  if (!seasonId) return null;
  try { return localStorage.getItem(LS_DIVISION_KEY_PREFIX + seasonId); } catch { return null; }
}
function saveDivision(seasonId, divisionId) {
  if (!seasonId || !divisionId) return;
  try { localStorage.setItem(LS_DIVISION_KEY_PREFIX + seasonId, divisionId); } catch {}
}
// --- Stage (REG/PO) helpers ---------------------------------------------

const LS_STAGE_KEY_PREFIX = "wcpl_stage_"; // per-season

export function getSavedStage(seasonId = currentSeasonId) {
  if (!seasonId) return null;
  try { return localStorage.getItem(LS_STAGE_KEY_PREFIX + seasonId); } catch { return null; }
}

export function saveStage(stage, seasonId = currentSeasonId) {
  if (!seasonId) return;
  try { localStorage.setItem(LS_STAGE_KEY_PREFIX + seasonId, stage); } catch {}
}

// "Playoffs have begun" if any qf/sf/f game is marked played in schedule.csv.
// Optionally, pass gamesRows to fallback-detect by goals.
export function playoffsHaveBegun(scheduleRows = [], gamesRows = null) {
  const isPOStage = (st) => {
    const s = String(st ?? "").trim().toLowerCase();
    return s === "qf" || s === "sf" || s === "f";
  };

  // Primary: schedule status
  for (const r of scheduleRows) {
    if (!isPOStage(r.stage)) continue;
    const status = String(r.status ?? "").trim().toLowerCase();
    if (status === "played" || status === "final") return true;
  }

  // Optional fallback: if games provided, detect scores for playoff match_ids
  if (Array.isArray(gamesRows) && gamesRows.length) {
    const poIds = new Set(
      scheduleRows
        .filter(r => isPOStage(r.stage))
        .map(r => String(r.match_id ?? "").trim())
        .filter(Boolean)
    );

    for (const g of gamesRows) {
      const mid = String(g.match_id ?? "").trim();
      if (!poIds.has(mid)) continue;
      // "played" if goals exist (string non-blank)
      const hg = String(g.home_goals ?? "").trim();
      const ag = String(g.away_goals ?? "").trim();
      if (hg !== "" && ag !== "") return true;
    }
  }

  return false;
}

// Apply default stage on a page, respecting saved user choice.
// - playoffsEnabled: whether PO option is actually available (players_playoffs exists, etc)
export function applyDefaultStage(elStage, seasonId, { playoffsEnabled, playoffsBegun }) {
  if (!elStage) return;

  const saved = getSavedStage(seasonId);

  // If saved exists, honor it (unless PO is not enabled)
  if (saved === "PO" || saved === "REG") {
    elStage.value = (saved === "PO" && playoffsEnabled) ? "PO" : "REG";
    return;
  }

  // No saved choice: auto-default
  elStage.value = (playoffsEnabled && playoffsBegun) ? "PO" : "REG";
}
