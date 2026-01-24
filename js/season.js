// js/season.js
import { loadCSV, truthy01 } from "./data.js";

const SEASONS_PATH = "../data/seasons.csv";

let seasons = [];
let currentSeasonId = null;
const listeners = new Set();

export async function initSeasonPicker(selectEl) {
  seasons = await loadCSV(SEASONS_PATH);

  // Determine initial season:
  // 1) URL ?season=S1
  // 2) first is_active=1
  // 3) first row
  const urlSeason = getUrlParam("season");
  const active = seasons.find(s => truthy01(s.is_active));
  const first = seasons[0];

  currentSeasonId = (urlSeason && seasons.some(s => s.season_id === urlSeason))
    ? urlSeason
    : (active?.season_id ?? first?.season_id ?? null);

  // Populate select
  selectEl.innerHTML = "";
  for (const s of seasons) {
    const opt = document.createElement("option");
    opt.value = s.season_id;
    opt.textContent = s.season_name ? `${s.season_name} (${s.season_id})` : s.season_id;
    selectEl.appendChild(opt);
  }

  if (currentSeasonId) selectEl.value = currentSeasonId;

  // Keep URL in sync
  setUrlParam("season", currentSeasonId);

  selectEl.addEventListener("change", () => {
    const next = selectEl.value;
    if (!next || next === currentSeasonId) return;
    currentSeasonId = next;
    setUrlParam("season", currentSeasonId);
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
