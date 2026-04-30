"use strict";

const MODELS = [
  { id: "ncep_hrrr_conus", label: "HRRR", res: "3km" },
  { id: "ncep_nam_conus", label: "NAM", res: "12km" },
  { id: "icon_global", label: "ICON", res: "11km" },
  { id: "gfs_seamless", label: "GFS", res: "25km" },
  { id: "ecmwf_ifs025", label: "ECMWF", res: "25km" },
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

function buildWindUrl(loc) {
  const params = new URLSearchParams({
    latitude: loc.lat,
    longitude: loc.lon,
    hourly: "wind_speed_10m,wind_gusts_10m,wind_direction_10m",
    models: MODELS.map((m) => m.id).join(","),
    wind_speed_unit: "mph",
    timezone: loc.tz,
    forecast_days: 16,
  });
  return `${API_BASE}?${params.toString()}`;
}

function buildWeatherUrl(loc) {
  const params = new URLSearchParams({
    latitude: loc.lat,
    longitude: loc.lon,
    hourly: "temperature_2m,precipitation,weather_code,cloud_cover",
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

function parseWindResponse(json) {
  const hourly = json.hourly;
  const timeStrings = hourly.time;
  const parsedTimes = timeStrings.map((t) => new Date(t));

  const models = MODELS.map((model) => {
    const suffix = "_" + model.id;
    function findKey(baseName) {
      if (hourly[baseName + suffix] !== undefined) return baseName + suffix;
      if (hourly[baseName] !== undefined) return baseName;
      return null;
    }
    const speedKey = findKey("wind_speed_10m");
    const gustKey = findKey("wind_gusts_10m");
    const dirKey = findKey("wind_direction_10m");
    return {
      ...model,
      speeds: speedKey ? hourly[speedKey] : new Array(parsedTimes.length).fill(null),
      gusts: gustKey ? hourly[gustKey] : new Array(parsedTimes.length).fill(null),
      dirs: dirKey ? hourly[dirKey] : new Array(parsedTimes.length).fill(null),
    };
  });

  return { times: parsedTimes, timeStrings, models };
}

function parseWeatherResponse(json) {
  const h = json.hourly;
  return {
    temps: h.temperature_2m || [],
    precip: h.precipitation || [],
    weatherCode: h.weather_code || [],
    cloudCover: h.cloud_cover || [],
  };
}

function parseMarineResponse(json) {
  const h = json.hourly;
  return {
    times: (h.time || []).map((t) => new Date(t)),
    waveHeight: h.wave_height || [],
    wavePeriod: h.wave_period || [],
    waveDir: h.wave_direction || [],
    swellHeight: h.swell_wave_height || [],
    swellPeriod: h.swell_wave_period || [],
    swellDir: h.swell_wave_direction || [],
  };
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
    if (diff < minDiff) {
      minDiff = diff;
      best = idx;
    }
  }
  return best;
}

function buildDayGroups(times, indices) {
  const groups = [];
  let currentLabel = null;
  for (const idx of indices) {
    const label = times[idx].toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    if (label !== currentLabel) {
      currentLabel = label;
      groups.push({ label, indices: [idx] });
    } else {
      groups[groups.length - 1].indices.push(idx);
    }
  }
  return groups;
}

function addSectionHeader(table, label, colCount, extraClass) {
  const tr = document.createElement("tr");
  tr.className = "section-row" + (extraClass ? " " + extraClass : "");
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

function addDataRow(table, label, indices, values, currentHourIdx, colorFn, formatFn, extraClass) {
  const tr = document.createElement("tr");
  if (extraClass) tr.className = extraClass;

  const labelCell = document.createElement("td");
  labelCell.className = "model-cell";
  labelCell.textContent = label;
  tr.appendChild(labelCell);

  for (const idx of indices) {
    const td = document.createElement("td");
    td.className = "wind-cell";
    const val = values[idx];
    if (val == null) {
      td.classList.add("wind-cell--empty");
      td.textContent = "—";
    } else {
      if (colorFn) td.style.backgroundColor = colorFn(val);
      td.textContent = formatFn ? formatFn(val, idx) : val;
    }
    if (idx === currentHourIdx) td.classList.add("wind-cell--now");
    tr.appendChild(td);
  }

  table.appendChild(tr);
}

// --------------- Main Render ---------------

function render() {
  const container = document.getElementById("grid-container");
  const existing = container.querySelector(".forecast-table");
  if (existing) existing.remove();

  if (!state.data) return;

  const { wind, weather, marine } = state.data;
  const { times, models } = wind;
  const isSummary = state.viewMode === "summary";

  const indices = [];
  for (let i = 0; i < times.length; i++) {
    if (isSummary && times[i].getHours() % 3 !== 0) continue;
    indices.push(i);
  }

  const dayGroups = buildDayGroups(times, indices);
  const currentHourIdx = findCurrentHourIdx(times, indices);

  // Build marine index mapping (marine times may be shorter)
  const marineMap = new Map();
  if (marine) {
    for (let mi = 0; mi < marine.times.length; mi++) {
      marineMap.set(marine.times[mi].getTime(), mi);
    }
  }

  const table = document.createElement("table");
  table.className = "forecast-table";

  // ---- Day header row ----
  const dayRow = document.createElement("tr");
  const dayCorner = document.createElement("th");
  dayCorner.className = "day-header model-cell";
  dayRow.appendChild(dayCorner);
  for (const group of dayGroups) {
    const th = document.createElement("th");
    th.className = "day-header";
    th.colSpan = group.indices.length;
    th.textContent = group.label;
    if (group.indices.includes(currentHourIdx)) th.classList.add("day-header--now");
    dayRow.appendChild(th);
  }
  table.appendChild(dayRow);

  // ---- Hour header row ----
  const hourRow = document.createElement("tr");
  const hourCorner = document.createElement("th");
  hourCorner.className = "hour-header model-cell";
  hourRow.appendChild(hourCorner);
  for (const idx of indices) {
    const th = document.createElement("th");
    th.className = "hour-header";
    const h = times[idx].getHours();
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const suffix = h < 12 ? "a" : "p";
    th.textContent = `${h12}${suffix}`;
    if (idx === currentHourIdx) th.classList.add("hour-header--now");
    hourRow.appendChild(th);
  }
  table.appendChild(hourRow);

  // ---- Weather conditions row ----
  if (weather) {
    const wxRow = document.createElement("tr");
    wxRow.className = "weather-row";
    const wxLabel = document.createElement("td");
    wxLabel.className = "model-cell";
    wxLabel.textContent = "Conditions";
    wxRow.appendChild(wxLabel);
    for (const idx of indices) {
      const td = document.createElement("td");
      td.className = "wind-cell wx-cell";
      const code = weather.weatherCode[idx];
      td.textContent = weatherIcon(code);
      if (idx === currentHourIdx) td.classList.add("wind-cell--now");
      wxRow.appendChild(td);
    }
    table.appendChild(wxRow);

    addDataRow(table, "Temp °F", indices, weather.temps, currentHourIdx,
      tempColor, (v) => Math.round(v));

    addDataRow(table, "Rain in", indices, weather.precip, currentHourIdx,
      (v) => v >= 0.01 ? "var(--precip-rain)" : "", (v) => v >= 0.01 ? v.toFixed(2) : "");
  }

  // ---- Wind section header ----
  addSectionHeader(table, "Wind mph", indices.length);

  // ---- Wind model rows ----
  for (const model of models) {
    const tr = document.createElement("tr");
    const labelCell = document.createElement("td");
    labelCell.className = "model-cell";
    labelCell.textContent = `${model.label} ${model.res}`;
    tr.appendChild(labelCell);

    for (const idx of indices) {
      const td = document.createElement("td");
      td.className = "wind-cell";
      const speed = model.speeds[idx];
      const gust = model.gusts[idx];
      const dir = model.dirs[idx];

      if (speed == null) {
        td.classList.add("wind-cell--empty");
        td.textContent = "—";
      } else {
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
      }
      if (idx === currentHourIdx) td.classList.add("wind-cell--now");
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }

  // ---- Swell section ----
  if (marine) {
    addSectionHeader(table, "Swell ft", indices.length);

    // Helper to get marine value at a wind-grid time index
    function marineVal(arr, windIdx) {
      const t = times[windIdx].getTime();
      const mi = marineMap.get(t);
      return mi !== undefined ? arr[mi] : null;
    }

    // Wave height row
    const whRow = document.createElement("tr");
    const whLabel = document.createElement("td");
    whLabel.className = "model-cell";
    whLabel.textContent = "Wave Ht";
    whRow.appendChild(whLabel);
    for (const idx of indices) {
      const td = document.createElement("td");
      td.className = "wind-cell";
      const h = marineVal(marine.waveHeight, idx);
      if (h == null) {
        td.classList.add("wind-cell--empty");
        td.textContent = "—";
      } else {
        td.style.backgroundColor = swellColor(h);
        td.textContent = h.toFixed(1);
      }
      if (idx === currentHourIdx) td.classList.add("wind-cell--now");
      whRow.appendChild(td);
    }
    table.appendChild(whRow);

    // Swell height + period + direction row
    const swRow = document.createElement("tr");
    const swLabel = document.createElement("td");
    swLabel.className = "model-cell";
    swLabel.textContent = "Swell";
    swRow.appendChild(swLabel);
    for (const idx of indices) {
      const td = document.createElement("td");
      td.className = "wind-cell";
      const h = marineVal(marine.swellHeight, idx);
      const p = marineVal(marine.swellPeriod, idx);
      const d = marineVal(marine.swellDir, idx);
      if (h == null) {
        td.classList.add("wind-cell--empty");
        td.textContent = "—";
      } else {
        td.style.backgroundColor = swellColor(h);
        const htSpan = document.createElement("span");
        htSpan.className = "wind-cell__speed";
        htSpan.textContent = h.toFixed(1);
        td.appendChild(htSpan);

        const arrowSpan = document.createElement("span");
        arrowSpan.className = "wind-cell__arrow";
        arrowSpan.textContent = dirArrow(d);
        if (d != null) {
          arrowSpan.style.display = "inline-block";
          arrowSpan.style.transform = dirRotation(d);
        }
        td.appendChild(arrowSpan);

        if (p != null) {
          const perSpan = document.createElement("span");
          perSpan.className = "wind-cell__gust";
          perSpan.textContent = Math.round(p) + "s";
          td.appendChild(perSpan);
        }
      }
      if (idx === currentHourIdx) td.classList.add("wind-cell--now");
      td.appendChild(document.createTextNode(""));
      swRow.appendChild(td);
    }
    table.appendChild(swRow);

    // Wave period row
    addDataRow(table, "Period", indices,
      indices.map((i) => marineVal(marine.wavePeriod, i)),
      currentHourIdx, null, (v) => Math.round(v) + "s");

    // Wave direction row
    const wdRow = document.createElement("tr");
    const wdLabel = document.createElement("td");
    wdLabel.className = "model-cell";
    wdLabel.textContent = "Wave Dir";
    wdRow.appendChild(wdLabel);
    for (const idx of indices) {
      const td = document.createElement("td");
      td.className = "wind-cell";
      const d = marineVal(marine.waveDir, idx);
      if (d == null) {
        td.classList.add("wind-cell--empty");
        td.textContent = "—";
      } else {
        const arrowSpan = document.createElement("span");
        arrowSpan.className = "wind-cell__arrow";
        arrowSpan.textContent = "↓";
        arrowSpan.style.display = "inline-block";
        arrowSpan.style.transform = dirRotation(d);
        arrowSpan.style.fontSize = "16px";
        td.appendChild(arrowSpan);
      }
      if (idx === currentHourIdx) td.classList.add("wind-cell--now");
      wdRow.appendChild(td);
    }
    table.appendChild(wdRow);
  }

  container.appendChild(table);

  // Auto-scroll to current hour
  const nowCell =
    container.querySelector(".wind-cell--now") ||
    container.querySelector(".hour-header--now");
  if (nowCell) {
    const containerRect = container.getBoundingClientRect();
    const cellRect = nowCell.getBoundingClientRect();
    const offset = cellRect.left - containerRect.left;
    container.scrollLeft = container.scrollLeft + offset - containerRect.width / 3;
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
  const btnDetailed = document.getElementById("btn-detailed");
  const btnSummary = document.getElementById("btn-summary");
  const container = document.getElementById("grid-container");
  btnDetailed.classList.toggle("view-toggle__btn--active", state.viewMode === "detailed");
  btnSummary.classList.toggle("view-toggle__btn--active", state.viewMode === "summary");
  container.classList.toggle("grid-container--summary", state.viewMode === "summary");
}

function bindEvents() {
  document.getElementById("btn-detailed").addEventListener("click", () => {
    state.viewMode = "detailed";
    updateViewToggle();
    render();
  });
  document.getElementById("btn-summary").addEventListener("click", () => {
    state.viewMode = "summary";
    updateViewToggle();
    render();
  });
  document.getElementById("retry-btn").addEventListener("click", () => {
    loadForecast();
  });
  document.getElementById("update-location-btn").addEventListener("click", async () => {
    await detectAndSetLocation();
    loadForecast();
  });
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
    const [windJson, weatherJson, marineJson] = await Promise.all([
      fetchJson(buildWindUrl(loc)),
      fetchJson(buildWeatherUrl(loc)),
      fetchJson(buildMarineUrl(loc)).catch(() => null),
    ]);

    state.data = {
      wind: parseWindResponse(windJson),
      weather: parseWeatherResponse(weatherJson),
      marine: marineJson ? parseMarineResponse(marineJson) : null,
    };

    const now = new Date();
    document.getElementById("last-updated").textContent =
      "Updated " + now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

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
    loading.textContent = "Loading forecast data…";
    loading.hidden = true;
    const error = document.getElementById("error");
    error.querySelector("p").textContent =
      "Location access denied. Please allow location access and try again.";
    error.hidden = false;
  }
}

async function init() {
  bindEvents();
  if (window.innerWidth <= 600) {
    state.viewMode = "summary";
    updateViewToggle();
  }
  const saved = getSavedLocation();
  if (saved) {
    state.location = saved;
    updateLocationDisplay();
    loadForecast();
  } else {
    await detectAndSetLocation();
    loadForecast();
  }
}

init();
