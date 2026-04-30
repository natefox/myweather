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
const VIEW_MODE_KEY = "myweather-view-mode";
const SHORE_NORMAL_KEY = "myweather-shore-normal";
const DEFAULT_SHORE_NORMAL = 225;
const TIDE_CACHE_KEY = "myweather-tide-station";
const NOAA_TIDE_BASE = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
const NOAA_STATIONS_URL = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions";

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
    hourly: "wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m,precipitation,precipitation_probability,relative_humidity_2m,weather_code",
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

async function findNearestTideStation(lat, lon) {
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  try {
    const cached = JSON.parse(localStorage.getItem(TIDE_CACHE_KEY));
    if (cached && cached.key === cacheKey) return cached;
  } catch (e) {}

  const json = await fetchJson(NOAA_STATIONS_URL);
  const sorted = json.stations
    .map((s) => ({ id: s.id, name: s.name, dist: (s.lat - lat) ** 2 + (s.lng - lon) ** 2 }))
    .sort((a, b) => a.dist - b.dist);

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const today = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;

  for (const candidate of sorted.slice(0, 5)) {
    try {
      const testUrl = `${NOAA_TIDE_BASE}?begin_date=${today}&range=24&station=${candidate.id}&product=predictions&datum=MLLW&units=english&time_zone=lst_ldt&interval=h&format=json`;
      const test = await fetchJson(testUrl);
      if (test.predictions && test.predictions.length > 0) {
        const result = { key: cacheKey, id: candidate.id, name: candidate.name };
        localStorage.setItem(TIDE_CACHE_KEY, JSON.stringify(result));
        return result;
      }
    } catch (e) {}
  }
  return null;
}

function buildTideUrl(stationId) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const beginDate = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const params = new URLSearchParams({
    begin_date: beginDate,
    range: 384,
    station: stationId,
    product: "predictions",
    datum: "MLLW",
    units: "english",
    time_zone: "lst_ldt",
    interval: "h",
    format: "json",
  });
  return `${NOAA_TIDE_BASE}?${params.toString()}`;
}

function parseTideResponse(json) {
  if (!json || !json.predictions) return null;
  const tideMap = new Map();
  for (const p of json.predictions) {
    const d = new Date(p.t.replace(" ", "T"));
    tideMap.set(d.getTime(), parseFloat(p.v));
  }
  return tideMap;
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
  const precipProb = getArr(hourly, "precipitation_probability", "gfs_seamless", len);
  const humidity = getArr(hourly, "relative_humidity_2m", "gfs_seamless", len);

  return { times, timeStrings, windModels, weatherCode, precip, precipProb, humidity };
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

function tideColor(level) {
  if (level == null) return "";
  if (level <= 0) return "var(--tide-very-low)";
  if (level <= 2) return "var(--tide-low)";
  if (level <= 4) return "var(--tide-mid)";
  if (level <= 5.5) return "var(--tide-high)";
  return "var(--tide-very-high)";
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

// --------------- Shore / Offshore Detection ---------------

function getShoreNormal() {
  try {
    const saved = localStorage.getItem(SHORE_NORMAL_KEY);
    if (saved != null) return parseFloat(saved);
  } catch (e) {}
  return DEFAULT_SHORE_NORMAL;
}

function angleDiff(a, b) {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function circularMean(angles) {
  let sinSum = 0, cosSum = 0;
  for (const a of angles) {
    const rad = a * Math.PI / 180;
    sinSum += Math.sin(rad);
    cosSum += Math.cos(rad);
  }
  return (Math.atan2(sinSum, cosSum) * 180 / Math.PI + 360) % 360;
}

function shoreType(windDir) {
  if (windDir == null) return null;
  const diff = angleDiff(windDir, getShoreNormal());
  if (diff > 120) return "offshore";
  if (diff < 60) return "onshore";
  return "cross";
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

  const { forecast, marine, tides, tideStationName } = state.data;
  const { times, windModels, weatherCode, precip, precipProb, humidity } = forecast;
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

  // ---- Rain chance % ----
  const rainPctRow = document.createElement("tr");
  rainPctRow.appendChild(Object.assign(document.createElement("td"), { className: "model-cell", textContent: "Rain %" }));
  for (const idx of indices) {
    const td = makeCell(idx, nowIdx);
    const p = precipProb[idx];
    if (p != null && p > 0) {
      td.style.backgroundColor = `rgba(68, 119, 238, ${Math.min(p / 100, 1) * 0.8})`;
      td.textContent = Math.round(p);
    }
    rainPctRow.appendChild(td);
  }
  table.appendChild(rainPctRow);

  // ---- Rain amount ----
  const rainRow = document.createElement("tr");
  rainRow.appendChild(Object.assign(document.createElement("td"), { className: "model-cell", textContent: "Rain in" }));
  for (const idx of indices) {
    const td = makeCell(idx, nowIdx);
    const v = precip[idx];
    if (v != null && v >= 0.005) {
      td.style.backgroundColor = "var(--precip-rain)";
      td.textContent = v < 0.01 ? "tr" : v.toFixed(2);
    }
    rainRow.appendChild(td);
  }
  table.appendChild(rainRow);

  // ---- Humidity % ----
  const humRow = document.createElement("tr");
  humRow.appendChild(Object.assign(document.createElement("td"), { className: "model-cell", textContent: "Humidity %" }));
  for (const idx of indices) {
    const td = makeCell(idx, nowIdx);
    const h = humidity[idx];
    if (h != null) {
      const alpha = Math.min(h / 100, 1) * 0.6;
      td.style.backgroundColor = `rgba(68, 119, 238, ${alpha})`;
      td.textContent = Math.round(h);
    }
    humRow.appendChild(td);
  }
  table.appendChild(humRow);

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

  // ---- Tide section ----
  if (tides && tides.size > 0) {
    addSectionHeader(table, "Tide ft", indices.length);
    const tr = document.createElement("tr");
    const labelTd = document.createElement("td");
    labelTd.className = "model-cell";
    labelTd.textContent = "Tide";
    if (tideStationName) {
      const sub = document.createElement("span");
      sub.className = "tide-station-name";
      sub.textContent = tideStationName;
      labelTd.appendChild(sub);
    }
    tr.appendChild(labelTd);
    for (const idx of indices) {
      const level = tides.get(times[idx].getTime());
      if (level == null) {
        tr.appendChild(makeEmptyCell(idx, nowIdx));
      } else {
        const td = makeCell(idx, nowIdx);
        td.style.backgroundColor = tideColor(level);
        const valSpan = document.createElement("span");
        valSpan.className = "wind-cell__speed";
        valSpan.textContent = level.toFixed(1);
        td.appendChild(valSpan);
        tr.appendChild(td);
      }
    }
    table.appendChild(tr);
  }

  container.appendChild(table);

  // Offshore/onshore/epic highlight for current hour
  const nowDirs = windModels.map((m) => m.dirs[nowIdx]).filter((d) => d != null);
  const nowSpeeds = windModels.map((m) => m.speeds[nowIdx]).filter((s) => s != null);
  const avgSpeed = nowSpeeds.length ? nowSpeeds.reduce((a, b) => a + b, 0) / nowSpeeds.length : 0;
  const windType = nowDirs.length ? shoreType(circularMean(nowDirs)) : null;

  let ecmwfWaveHeight = null;
  if (marine) {
    const wam = marine.marineModels.find((m) => m.id === "ecmwf_wam025");
    if (wam) {
      const mi = mIdx(nowIdx);
      if (mi !== undefined) ecmwfWaveHeight = wam.waveHeight[mi];
    }
  }

  const isEpic = windType === "offshore" && avgSpeed >= 5 && ecmwfWaveHeight != null && ecmwfWaveHeight > 4;

  container.classList.remove("grid-container--offshore", "grid-container--onshore", "grid-container--cross", "grid-container--epic");
  if (isEpic) {
    container.classList.add("grid-container--epic");
  } else if (windType) {
    container.classList.add("grid-container--" + windType);
  }

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

function setViewMode(mode) {
  state.viewMode = mode;
  localStorage.setItem(VIEW_MODE_KEY, mode);
  history.replaceState(null, "", "#" + mode);
  updateViewToggle();
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
  document.getElementById("btn-detailed").addEventListener("click", () => { setViewMode("detailed"); render(); });
  document.getElementById("btn-summary").addEventListener("click", () => { setViewMode("summary"); render(); });
  window.addEventListener("hashchange", () => {
    const hash = location.hash.replace("#", "");
    if (hash === "detailed" || hash === "summary") { setViewMode(hash); render(); }
  });
  document.getElementById("retry-btn").addEventListener("click", () => loadForecast());
  document.getElementById("update-location-btn").addEventListener("click", async () => { await detectAndSetLocation(); loadForecast(); });
}

async function loadForecast() {
  if (!state.location) return;
  const loading = document.getElementById("loading");
  const error = document.getElementById("error");
  const container = document.getElementById("grid-container");

  loading.hidden = false;
  document.getElementById("loading-text").textContent = "Loading forecast data…";
  error.hidden = true;
  const existing = container.querySelector(".forecast-table");
  if (existing) existing.remove();

  try {
    const loc = state.location;
    const tideStation = await findNearestTideStation(loc.lat, loc.lon).catch(() => null);

    const [forecastJson, marineJson, tideJson] = await Promise.all([
      fetchJson(buildForecastUrl(loc)),
      fetchJson(buildMarineUrl(loc)).catch(() => null),
      tideStation ? fetchJson(buildTideUrl(tideStation.id)).catch(() => null) : null,
    ]);

    state.data = {
      forecast: parseForecastResponse(forecastJson),
      marine: marineJson ? parseMarineResponse(marineJson) : null,
      tides: tideJson ? parseTideResponse(tideJson) : null,
      tideStationName: tideStation ? tideStation.name : null,
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
  document.getElementById("loading-text").textContent = "Detecting your location…";
  try {
    const coords = await requestGeolocation();
    state.location = { lat: coords.lat, lon: coords.lon, tz: detectTimezone() };
    saveLocation(state.location);
    updateLocationDisplay();
    document.getElementById("loading-text").textContent = "Loading forecast data…";
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
  const hash = location.hash.replace("#", "");
  if (hash === "detailed" || hash === "summary") {
    state.viewMode = hash;
  } else {
    const savedView = localStorage.getItem(VIEW_MODE_KEY);
    if (savedView === "detailed" || savedView === "summary") state.viewMode = savedView;
    else if (window.innerWidth <= 600) state.viewMode = "summary";
  }
  updateViewToggle();
  history.replaceState(null, "", "#" + state.viewMode);
  const saved = getSavedLocation();
  if (saved) { state.location = saved; updateLocationDisplay(); loadForecast(); }
  else { await detectAndSetLocation(); loadForecast(); }
}

init();
