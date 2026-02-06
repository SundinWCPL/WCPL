// js/season.js
import { loadCSV, truthy01 } from "./data.js";

const SEASONS_PATH = new URL(
  (window.location.pathname.includes("/pages/") ? "../data/" : "data/") + "seasons.csv",
  window.location.href
).toString();

const LS_KEY = "wcpl_season"; // NEW: remember last picked season

let seasons = [];
let currentSeasonId = null;
const listeners = new Set();

export async function initSeasonPicker(selectEl) {
  seasons = await loadCSV(SEASONS_PATH);

  // Determine initial season:
  // 1) URL ?season=S1
  // 2) localStorage last choice
  // 3) first is_active=1
  // 4) first row
  const urlSeason = getUrlParam("season");
  const savedSeason = getSavedSeason();
  const active = seasons.find(s => truthy01(s.is_active));
  const first = seasons[0];

  currentSeasonId =
    (urlSeason && seasons.some(s => s.season_id === urlSeason)) ? urlSeason :
    (savedSeason && seasons.some(s => s.season_id === savedSeason)) ? savedSeason :
    (active?.season_id ?? first?.season_id ?? null);

  // Populate select
  selectEl.innerHTML = "";
  for (const s of seasons) {
    const opt = document.createElement("option");
    opt.value = s.season_id;
    opt.textContent = s.season_name ? `${s.season_name} (${s.season_id})` : s.season_id;
    selectEl.appendChild(opt);
  }

  if (currentSeasonId) selectEl.value = currentSeasonId;

  // Keep URL + localStorage in sync
  if (currentSeasonId) {
    setUrlParam("season", currentSeasonId);
    saveSeason(currentSeasonId);
  }

  selectEl.addEventListener("change", () => {
    const next = selectEl.value;
    if (!next || next === currentSeasonId) return;
    currentSeasonId = next;
    setUrlParam("season", currentSeasonId);
    saveSeason(currentSeasonId); // NEW
    notify();
  });
}

export function getSeasonId() {
  return currentSeasonId;
}

export function onSeasonChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// NEW: helper to stamp season onto links
export function withSeason(href, seasonId = currentSeasonId) {
  if (!seasonId) return href;
  const url = new URL(href, window.location.href);
  url.searchParams.set("season", seasonId);
  return url.pathname + url.search;
}

function notify() {
  for (const cb of listeners) cb(currentSeasonId);
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

// NEW localStorage helpers
function getSavedSeason() {
  try { return localStorage.getItem(LS_KEY); } catch { return null; }
}
function saveSeason(seasonId) {
  try { localStorage.setItem(LS_KEY, seasonId); } catch {}
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
