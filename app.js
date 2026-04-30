"use strict";

const WIND_MODELS = [
  { id: "ncep_hrrr_conus", label: "HRRR", res: "3km" },
  { id: "ncep_nam_conus", label: "NAM", res: "12km" },
  { id: "icon_global", label: "ICON", res: "11km" },
  { id: "gfs_seamless", label: "GFS", res: "25km" },
  { id: "ecmwf_ifs025", label: "ECMWF", res: "25km" },
];

const MARINE_MODELS = [
  { id: "ncep_gfswave025", label: "GFS Wave", res: "25km" },
  { id: "ecmwf_wam025", label: "ECMWF WAM", res: "25km" },
  { id: "meteofrance_wave", label: "MeteoFr", res: "10km" },
];

const API_BASE = "https://api.open-meteo.com/v1/forecast";
const MARINE_API_BASE = "https://marine-api.open-meteo.com/v1/marine";
const STORAGE_KEY = "myweather-location";

let state = {
  location: null,
  viewMode: "detailed",
  data: null,
};

// --------------- Location ---------------

function getSavedLocation() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return null;
}

function saveLocation(loc) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(loc));
}

function requestGeolocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation not supported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(err),
      { timeout: 10000 }
    );
  });
}

function detectTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// --------------- API Layer ---------------

function buildForecastUrl(loc) {
  const params = new URLSearchParams({
    latitude: loc.lat,
    longitude: loc.lon,
    hourly: "wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m,precipitation,weather_code",
    models: WIND_MODELS.map((m) => m.id).join(","),
    wind_speed_unit: "mph",
    temperature_unit: "fahrenheit",
    precipitation_unit: "inch",
    timezone: loc.tz,
    forecast_days: 16,
  });
  return `${API_BASE}?${params.toString()}`;
}

function buildMarineUrl(loc) {
  const params = new URLSearchParams({
    latitude: loc.lat,
    longitude: loc.lon,
    hourly: "wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction",
    models: MARINE_MODELS.map((m) => m.id).join(","),
    length_unit: "imperial",
    timezone: loc.tz,
  });
  return `${MARINE_API_BASE}?${params.toString()}`;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// --------------- Data Parsing ---------------

function findKey(hourly, baseName, modelId) {
  const suffixed = baseName + "_" + modelId;
  if (hourly[suffixed] !== undefined) return suffixed;
  if (hourly[baseName] !== undefined) return baseName;
  return null;
}

function getArr(hourly, baseName, modelId, len) {
  const key = findKey(hourly, baseName, modelId);
  return key ? hourly[key] : new Array(len).fill(null);
}

function parseForecastResponse(json) {
  const hourly = json.hourly;
  const timeStrings = hourly.time;
  const times = timeStrings.map((t) => new Date(t));
  const len = times.length;

  const windModels = WIND_MODELS.map((m) => ({
    ...m,
    speeds: getArr(hourly, "wind_speed_10m", m.id, len),
    gusts: getArr(hourly, "wind_gusts_10m", m.id, len),
    dirs: getArr(hourly, "wind_direction_10m", m.id, len),
    temps: getArr(hourly, "temperature_2m", m.id, len),
  }));

  // Weather codes & precip come from best-match (no model prefix)
  // but if prefixed, grab from GFS as fallback
  const weatherCode = getArr(hourly, "weather_code", "gfs_seamless", len);
  const precip = getArr(hourly, "precipitation", "gfs_seamless", len);

  return { times, timeStrings, windModels, weatherCode, precip };
}

function parseMarineResponse(json) {
  const hourly = json.hourly;
  const times = (hourly.time || []).map((t) => new Date(t));
  const len = times.length;

  const marineModels = MARINE_MODELS.map((m) => ({
    ...m,
    waveHeight: getArr(hourly, "wave_height", m.id, len),
    wavePeriod: getArr(hourly, "wave_period", m.id, len),
    waveDir: getArr(hourly, "wave_direction", m.id, len),
    swellHeight: getArr(hourly, "swell_wave_height", m.id, len),
    swellPeriod: getArr(hourly, "swell_wave_period", m.id, len),
    swellDir: getArr(hourly, "swell_wave_direction", m.id, len),
  }));

  return { times, marineModels };
}

// --------------- Display Helpers ---------------

function windColor(speed) {
  if (speed == null) return "";
  if (speed <= 5) return "var(--wind-calm)";
  if (speed <= 10) return "var(--wind-light)";
  if (speed <= 15) return "var(--wind-moderate)";
  if (speed <= 20) return "var(--wind-strong)";
  return "var(--wind-very-strong)";
}

function swellColor(height) {
  if (height == null) return "";
  if (height <= 1) return "var(--swell-flat)";
  if (height <= 3) return "var(--swell-small)";
  if (height <= 5) return "var(--swell-medium)";
  if (height <= 8) return "var(--swell-large)";
  return "var(--swell-xl)";
}

function tempColor(f) {
  if (f == null) return "";
  if (f <= 50) return "var(--temp-cold)";
  if (f <= 60) return "var(--temp-cool)";
  if (f <= 70) return "var(--temp-mild)";
  if (f <= 80) return "var(--temp-warm)";
  return "var(--temp-hot)";
}

function weatherIcon(code) {
  if (code == null) return "";
  if (code === 0) return "☀️";
  if (code <= 3) return "⛅";
  if (code <= 48) return "☁️";
  if (code <= 67) return "🌧️";
  if (code <= 77) return "❄️";
  if (code <= 82) return "⛈️";
  if (code <= 99) return "⚡";
  return "";
}

function dirArrow(deg) {
  return deg != null ? "↓" : "";
}

function dirRotation(deg) {
  return deg != null ? `rotate(${deg}deg)` : "";
}

// --------------- Render Helpers ---------------

function findCurrentHourIdx(times, indices) {
  const now = new Date();
  let best = indices[0];
  let minDiff = Math.abs(times[indices[0]] - now);
  for (const idx of indices) {
    const diff = Math.abs(times[idx] - now);
    if (diff < minDiff) { minDiff = diff; best = idx; }
  }
  return best;
}

function buildDayGroups(times, indices) {
  const groups = [];
  let cur = null;
  for (const idx of indices) {
    const label = times[idx].toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    if (label !== cur) { cur = label; groups.push({ label, indices: [idx] }); }
    else groups[groups.length - 1].indices.push(idx);
  }
  return groups;
}

function addSectionHeader(table, label, colCount) {
  const tr = document.createElement("tr");
  tr.className = "section-row";
  const labelTd = document.createElement("td");
  labelTd.className = "model-cell section-label";
  labelTd.textContent = label;
  tr.appendChild(labelTd);
  const spacer = document.createElement("td");
  spacer.colSpan = colCount;
  spacer.className = "section-spacer";
  tr.appendChild(spacer);
  table.appendChild(tr);
}

function makeCell(idx, currentHourIdx) {
  const td = document.createElement("td");
  td.className = "wind-cell";
  if (idx === currentHourIdx) td.classList.add("wind-cell--now");
  return td;
}

function makeEmptyCell(idx, currentHourIdx) {
  const td = makeCell(idx, currentHourIdx);
  td.classList.add("wind-cell--empty");
  td.textContent = "—";
  return td;
}

// --------------- Main Render ---------------

function render() {
  const container = document.getElementById("grid-container");
  const existing = container.querySelector(".forecast-table");
  if (existing) existing.remove();
  if (!state.data) return;

  const { forecast, marine } = state.data;
  const { times, windModels, weatherCode, precip } = forecast;
  const isSummary = state.viewMode === "summary";

  const indices = [];
  for (let i = 0; i < times.length; i++) {
    if (isSummary && times[i].getHours() % 3 !== 0) continue;
    indices.push(i);
  }

  const dayGroups = buildDayGroups(times, indices);
  const nowIdx = findCurrentHourIdx(times, indices);

  // Marine time mapping
  const marineMap = new Map();
  if (marine) {
    for (let mi = 0; mi < marine.times.length; mi++) {
      marineMap.set(marine.times[mi].getTime(), mi);
    }
  }
  function mIdx(windIdx) {
    return marineMap.get(times[windIdx].getTime());
  }

  const table = document.createElement("table");
  table.className = "forecast-table";

  // ---- Day headers ----
  const dayRow = document.createElement("tr");
  dayRow.appendChild(Object.assign(document.createElement("th"), { className: "day-header model-cell" }));
  for (const g of dayGroups) {
    const th = document.createElement("th");
    th.className = "day-header";
    th.colSpan = g.indices.length;
    th.textContent = g.label;
    if (g.indices.includes(nowIdx)) th.classList.add("day-header--now");
    dayRow.appendChild(th);
  }
  table.appendChild(dayRow);

  // ---- Hour headers ----
  const hourRow = document.createElement("tr");
  hourRow.appendChild(Object.assign(document.createElement("th"), { className: "hour-header model-cell" }));
  for (const idx of indices) {
    const th = document.createElement("th");
    th.className = "hour-header";
    const h = times[idx].getHours();
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    th.textContent = `${h12}${h < 12 ? "a" : "p"}`;
    if (idx === nowIdx) th.classList.add("hour-header--now");
    hourRow.appendChild(th);
  }
  table.appendChild(hourRow);

  // ---- Weather conditions ----
  const wxRow = document.createElement("tr");
  wxRow.className = "weather-row";
  wxRow.appendChild(Object.assign(document.createElement("td"), { className: "model-cell", textContent: "Conditions" }));
  for (const idx of indices) {
    const td = makeCell(idx, nowIdx);
    td.className += " wx-cell";
    td.textContent = weatherIcon(weatherCode[idx]);
    wxRow.appendChild(td);
  }
  table.appendChild(wxRow);

  // ---- Rain ----
  const rainRow = document.createElement("tr");
  rainRow.appendChild(Object.assign(document.createElement("td"), { className: "model-cell", textContent: "Rain in" }));
  for (const idx of indices) {
    const td = makeCell(idx, nowIdx);
    const v = precip[idx];
    if (v != null && v >= 0.01) {
      td.style.backgroundColor = "var(--precip-rain)";
      td.textContent = v.toFixed(2);
    }
    rainRow.appendChild(td);
  }
  table.appendChild(rainRow);

  // ---- Temp section ----
  addSectionHeader(table, "Temp °F", indices.length);

  for (const model of windModels) {
    const tr = document.createElement("tr");
    tr.appendChild(Object.assign(document.createElement("td"), { className: "model-cell", textContent: `${model.label} ${model.res}` }));
    for (const idx of indices) {
      const temp = model.temps[idx];
      if (temp == null) {
        tr.appendChild(makeEmptyCell(idx, nowIdx));
      } else {
        const td = makeCell(idx, nowIdx);
        td.style.backgroundColor = tempColor(temp);
        td.textContent = Math.round(temp);
        tr.appendChild(td);
      }
    }
    table.appendChild(tr);
  }

  // ---- Wind section ----
  addSectionHeader(table, "Wind mph", indices.length);

  for (const model of windModels) {
    const tr = document.createElement("tr");
    tr.appendChild(Object.assign(document.createElement("td"), { className: "model-cell", textContent: `${model.label} ${model.res}` }));

    for (const idx of indices) {
      const speed = model.speeds[idx];
      const gust = model.gusts[idx];
      const dir = model.dirs[idx];

      if (speed == null) {
        tr.appendChild(makeEmptyCell(idx, nowIdx));
        continue;
      }

      const td = makeCell(idx, nowIdx);
      td.style.backgroundColor = windColor(speed);

      const speedSpan = document.createElement("span");
      speedSpan.className = "wind-cell__speed";
      speedSpan.textContent = Math.round(speed);
      td.appendChild(speedSpan);

      const arrowSpan = document.createElement("span");
      arrowSpan.className = "wind-cell__arrow";
      arrowSpan.textContent = dirArrow(dir);
      if (dir != null) {
        arrowSpan.style.display = "inline-block";
        arrowSpan.style.transform = dirRotation(dir);
      }
      td.appendChild(arrowSpan);

      if (gust != null) {
        const gustSpan = document.createElement("span");
        gustSpan.className = "wind-cell__gust";
        gustSpan.textContent = Math.round(gust);
        td.appendChild(gustSpan);
      }

      tr.appendChild(td);
    }
    table.appendChild(tr);
  }

  // ---- Swell section ----
  if (marine) {
    addSectionHeader(table, "Swell ft", indices.length);

    for (const model of marine.marineModels) {
      // Skip model if it has zero non-null swell data
      const hasSwellData = model.swellHeight.some((v) => v != null);
      const hasWaveData = model.waveHeight.some((v) => v != null);
      if (!hasSwellData && !hasWaveData) continue;

      const tr = document.createElement("tr");
      tr.appendChild(Object.assign(document.createElement("td"), { className: "model-cell", textContent: model.label }));

      for (const idx of indices) {
        const mi = mIdx(idx);
        const wh = mi !== undefined ? model.waveHeight[mi] : null;
        const sh = mi !== undefined ? model.swellHeight[mi] : null;
        const sp = mi !== undefined ? model.swellPeriod[mi] : null;
        const sd = mi !== undefined ? model.swellDir[mi] : null;

        const height = sh != null ? sh : wh;

        if (height == null) {
          tr.appendChild(makeEmptyCell(idx, nowIdx));
          continue;
        }

        const td = makeCell(idx, nowIdx);
        td.style.backgroundColor = swellColor(height);

        const htSpan = document.createElement("span");
        htSpan.className = "wind-cell__speed";
        htSpan.textContent = height.toFixed(1);
        td.appendChild(htSpan);

        if (sd != null) {
          const arrowSpan = document.createElement("span");
          arrowSpan.className = "wind-cell__arrow";
          arrowSpan.textContent = "↓";
          arrowSpan.style.display = "inline-block";
          arrowSpan.style.transform = dirRotation(sd);
          td.appendChild(arrowSpan);
        }

        if (sp != null) {
          const perSpan = document.createElement("span");
          perSpan.className = "wind-cell__gust";
          perSpan.textContent = Math.round(sp) + "s";
          td.appendChild(perSpan);
        }

        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
  }

  container.appendChild(table);

  // Auto-scroll to now
  const nowCell = container.querySelector(".wind-cell--now") || container.querySelector(".hour-header--now");
  if (nowCell) {
    const cr = container.getBoundingClientRect();
    const nr = nowCell.getBoundingClientRect();
    container.scrollLeft += nr.left - cr.left - cr.width / 3;
  }
}

// --------------- UI ---------------

function updateLocationDisplay() {
  const el = document.getElementById("location-display");
  if (state.location) {
    el.textContent = `${state.location.lat.toFixed(2)}, ${state.location.lon.toFixed(2)}`;
    el.title = `${state.location.lat}, ${state.location.lon}`;
  } else {
    el.textContent = "";
  }
}

function updateViewToggle() {
  const btnD = document.getElementById("btn-detailed");
  const btnS = document.getElementById("btn-summary");
  const c = document.getElementById("grid-container");
  btnD.classList.toggle("view-toggle__btn--active", state.viewMode === "detailed");
  btnS.classList.toggle("view-toggle__btn--active", state.viewMode === "summary");
  c.classList.toggle("grid-container--summary", state.viewMode === "summary");
}

function bindEvents() {
  document.getElementById("btn-detailed").addEventListener("click", () => { state.viewMode = "detailed"; updateViewToggle(); render(); });
  document.getElementById("btn-summary").addEventListener("click", () => { state.viewMode = "summary"; updateViewToggle(); render(); });
  document.getElementById("retry-btn").addEventListener("click", () => loadForecast());
  document.getElementById("update-location-btn").addEventListener("click", async () => { await detectAndSetLocation(); loadForecast(); });
}

async function loadForecast() {
  if (!state.location) return;
  const loading = document.getElementById("loading");
  const error = document.getElementById("error");
  const container = document.getElementById("grid-container");

  loading.hidden = false;
  loading.textContent = "Loading forecast data…";
  error.hidden = true;
  const existing = container.querySelector(".forecast-table");
  if (existing) existing.remove();

  try {
    const loc = state.location;
    const [forecastJson, marineJson] = await Promise.all([
      fetchJson(buildForecastUrl(loc)),
      fetchJson(buildMarineUrl(loc)).catch(() => null),
    ]);

    state.data = {
      forecast: parseForecastResponse(forecastJson),
      marine: marineJson ? parseMarineResponse(marineJson) : null,
    };

    document.getElementById("last-updated").textContent =
      "Updated " + new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

    loading.hidden = true;
    render();
  } catch (err) {
    console.error("Forecast fetch failed:", err);
    loading.hidden = true;
    error.querySelector("p").textContent = "Couldn’t fetch forecast data.";
    error.hidden = false;
  }
}

async function detectAndSetLocation() {
  const loading = document.getElementById("loading");
  loading.hidden = false;
  loading.textContent = "Detecting your location…";
  try {
    const coords = await requestGeolocation();
    state.location = { lat: coords.lat, lon: coords.lon, tz: detectTimezone() };
    saveLocation(state.location);
    updateLocationDisplay();
    loading.textContent = "Loading forecast data…";
  } catch (err) {
    console.error("Geolocation failed:", err);
    loading.hidden = true;
    const error = document.getElementById("error");
    error.querySelector("p").textContent = "Location access denied. Please allow location access and try again.";
    error.hidden = false;
  }
}

async function init() {
  bindEvents();
  if (window.innerWidth <= 600) { state.viewMode = "summary"; updateViewToggle(); }
  const saved = getSavedLocation();
  if (saved) { state.location = saved; updateLocationDisplay(); loadForecast(); }
  else { await detectAndSetLocation(); loadForecast(); }
}

init();
