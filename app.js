"use strict";

const MODELS = [
  { id: "ncep_hrrr_conus", label: "HRRR", res: "3km" },
  { id: "ncep_nam_conus", label: "NAM", res: "12km" },
  { id: "icon_global", label: "ICON", res: "11km" },
  { id: "gfs_seamless", label: "GFS", res: "25km" },
  { id: "ecmwf_ifs025", label: "ECMWF", res: "25km" },
];

const API_BASE = "https://api.open-meteo.com/v1/forecast";
const STORAGE_KEY = "myweather-location";

let state = {
  location: null, // { lat, lon, tz }
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

function buildApiUrl(loc) {
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

async function fetchForecast(loc) {
  const url = buildApiUrl(loc);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// --------------- Data Parsing ---------------

function parseResponse(json) {
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

// --------------- Wind Helpers ---------------

function windColor(speed) {
  if (speed == null) return "";
  if (speed <= 5) return "var(--wind-calm)";
  if (speed <= 10) return "var(--wind-light)";
  if (speed <= 15) return "var(--wind-moderate)";
  if (speed <= 20) return "var(--wind-strong)";
  return "var(--wind-very-strong)";
}

function dirArrow(deg) {
  return deg != null ? "↓" : "";
}

function dirRotation(deg) {
  return deg != null ? `rotate(${deg}deg)` : "";
}

// --------------- Render ---------------

function render() {
  const container = document.getElementById("grid-container");
  const existing = container.querySelector(".forecast-table");
  if (existing) existing.remove();

  if (!state.data) return;

  const { times, models } = state.data;
  const isSummary = state.viewMode === "summary";

  const indices = [];
  for (let i = 0; i < times.length; i++) {
    if (isSummary && times[i].getHours() % 3 !== 0) continue;
    indices.push(i);
  }

  const dayGroups = [];
  let currentDayLabel = null;
  for (const idx of indices) {
    const label = times[idx].toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    if (label !== currentDayLabel) {
      currentDayLabel = label;
      dayGroups.push({ label, indices: [idx] });
    } else {
      dayGroups[dayGroups.length - 1].indices.push(idx);
    }
  }

  const now = new Date();
  let currentHourIdx = indices[0];
  let minDiff = Math.abs(times[indices[0]] - now);
  for (const idx of indices) {
    const diff = Math.abs(times[idx] - now);
    if (diff < minDiff) {
      minDiff = diff;
      currentHourIdx = idx;
    }
  }

  const table = document.createElement("table");
  table.className = "forecast-table";

  const dayRow = document.createElement("tr");
  const dayCorner = document.createElement("th");
  dayCorner.className = "day-header model-cell";
  dayRow.appendChild(dayCorner);

  for (const group of dayGroups) {
    const th = document.createElement("th");
    th.className = "day-header";
    th.colSpan = group.indices.length;
    th.textContent = group.label;
    if (group.indices.includes(currentHourIdx)) {
      th.classList.add("day-header--now");
    }
    dayRow.appendChild(th);
  }
  table.appendChild(dayRow);

  const hourRow = document.createElement("tr");
  const hourCorner = document.createElement("th");
  hourCorner.className = "hour-header model-cell";
  hourCorner.textContent = "mph";
  hourRow.appendChild(hourCorner);

  for (const idx of indices) {
    const th = document.createElement("th");
    th.className = "hour-header";
    const h = times[idx].getHours();
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const suffix = h < 12 ? "a" : "p";
    th.textContent = `${h12}${suffix}`;
    if (idx === currentHourIdx) {
      th.classList.add("hour-header--now");
    }
    hourRow.appendChild(th);
  }
  table.appendChild(hourRow);

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

      if (idx === currentHourIdx) {
        td.classList.add("wind-cell--now");
      }

      tr.appendChild(td);
    }

    table.appendChild(tr);
  }

  container.appendChild(table);

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
  error.hidden = true;
  const existing = container.querySelector(".forecast-table");
  if (existing) existing.remove();

  try {
    const json = await fetchForecast(state.location);
    state.data = parseResponse(json);

    const now = new Date();
    document.getElementById("last-updated").textContent =
      "Updated " +
      now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

    loading.hidden = true;
    render();
  } catch (err) {
    console.error("Forecast fetch failed:", err);
    loading.hidden = true;
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
