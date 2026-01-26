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
