# MyWeather

A personal weather forecast comparison tool for surf session planning. Compares wind, temperature, swell, and tide forecasts from multiple weather models in a side-by-side grid.

**Live:** [natefox.github.io/myweather](https://natefox.github.io/myweather)

## What It Does

Fetches forecast data from multiple weather models and displays them in a color-coded comparison grid, so you can see where models agree and where they diverge. Built for planning surf sessions, but useful for anyone who wants multi-model weather data without paywalls.

### Data Sections

| Section | Models | Source |
|---------|--------|--------|
| **Conditions** | GFS (best-match) | Open-Meteo Forecast API |
| **Rain %** | GFS ensemble | Open-Meteo Forecast API |
| **Rain in** | GFS (best-match) | Open-Meteo Forecast API |
| **Humidity %** | GFS (best-match) | Open-Meteo Forecast API |
| **Temp °F** | HRRR 3km, NAM 12km, ICON 11km, GFS 25km, ECMWF 25km | Open-Meteo Forecast API |
| **Wind mph** | HRRR 3km, NAM 12km, ICON 11km, GFS 25km, ECMWF 25km | Open-Meteo Forecast API |
| **Swell ft** | GFS Wave 25km, ECMWF WAM 25km, MeteoFrance 10km | Open-Meteo Marine API |
| **Tide ft** | Nearest NOAA station (auto-detected) | NOAA CO-OPS API |

### Weather Models

| Model | Resolution | Forecast Range | Best For |
|-------|-----------|----------------|----------|
| HRRR | 3 km | ~48 hrs | Short-range detail |
| NAM | 12 km | 3.5 days | Regional mid-range |
| ICON | 11 km | 7.5 days | Independent European model |
| GFS | 25 km | 16 days | Longest range |
| ECMWF IFS | 25 km | 15 days | Most accurate global model |

## Features

- **Two view modes:** Detailed (hourly) and Summary (3-hour intervals), toggleable and bookmarkable via URL hash (`#detailed` / `#summary`)
- **Color-coded cells:** Wind speed (calm→strong), temperature (cold→hot), swell height (flat→XL), tide level (low→high), rain probability (opacity-scaled)
- **Current hour highlight:** Column glow indicates wind conditions — green for offshore, white for onshore/cross-shore, purple for epic conditions (offshore 5+ mph with 4+ ft swell)
- **Offshore detection:** Compares wind direction to shore normal angle (default 225° for west-facing SoCal coast). Configurable via `localStorage` key `myweather-shore-normal`
- **Auto-scroll** to current hour on page load
- **Sticky headers:** Model names column and day/hour header rows stay visible while scrolling
- **Geolocation:** Detects location via browser API, persists in `localStorage`. No hardcoded coordinates
- **NOAA tide station auto-discovery:** Finds nearest station with prediction data, validates it works, caches the result
- **Surfer loading animation:** Because why not
- **Hourly cache busting** on CSS/JS for GitHub Pages freshness
- **Mobile responsive:** Narrower cells and summary view default on small screens

## Architecture

Pure static SPA — no framework, no build step, no npm, no backend.

```
myweather/
  index.html    — page shell (header, view toggle, grid container)
  style.css     — dark theme, grid layout, color scales, animations
  app.js        — data fetching, parsing, rendering (~780 lines)
  docs/         — design specs and implementation plans
```

### APIs Used (all free, no keys required)

| API | Purpose | Rate Limits |
|-----|---------|-------------|
| [Open-Meteo Forecast](https://open-meteo.com/en/docs) | Wind, temp, weather, rain, humidity | 600/min, 10k/day |
| [Open-Meteo Marine](https://open-meteo.com/en/docs/marine-weather-api) | Swell/wave height, period, direction | Same as above |
| [NOAA CO-OPS](https://api.tidesandcurrents.noaa.gov/api/prod/) | Tide predictions | No published limits |
| [NOAA Stations Metadata](https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/) | Find nearest tide station | No published limits |

### Data Flow

```
Page load
  → Browser geolocation (or cached lat/lon from localStorage)
  → 3 parallel API calls:
      1. Open-Meteo Forecast (wind + temp + weather + rain + humidity, 5 models)
      2. Open-Meteo Marine (swell/wave, 3 models) — fails gracefully
      3. NOAA Tide predictions (nearest validated station) — fails gracefully
  → Parse responses, map marine times to forecast grid
  → Render table with all sections
  → Compute offshore/onshore/epic status for current hour
  → Auto-scroll to current column
```

### localStorage Keys

| Key | Purpose |
|-----|---------|
| `myweather-location` | Cached `{lat, lon, tz}` from geolocation |
| `myweather-view-mode` | Last selected view (`"detailed"` or `"summary"`) |
| `myweather-shore-normal` | Shore angle in degrees for offshore detection (default: 225) |
| `myweather-tide-station` | Cached `{key, id, name}` of nearest NOAA station |

## Deployment

Hosted on GitHub Pages from the `main` branch root. Push to `main` and it deploys automatically.

## Development

Open `index.html` directly in a browser, or serve locally:

```bash
python3 -m http.server 8888
# then open http://localhost:8888
```

No build step. Edit files, refresh browser.

## Color Scales

**Wind (mph):** 0-5 calm (blue-green) → 6-10 light (green) → 11-15 moderate (yellow) → 16-20 strong (orange) → 21+ very strong (red)

**Temperature (°F):** ≤50 cold (blue) → ≤60 cool (teal) → ≤70 mild (green) → ≤80 warm (orange) → 80+ hot (red)

**Swell (ft):** ≤1 flat (steel blue) → ≤3 small (teal) → ≤5 medium (green) → ≤8 large (orange) → 8+ XL (red)

**Tide (ft):** Very low (dark navy) → Low (dark blue) → Mid (medium blue) → High (light blue) → Very high (cyan)

## Customization

**Shore angle:** Set `localStorage.setItem('myweather-shore-normal', '180')` for a south-facing coast. The angle is the direction perpendicular to the coastline pointing out to sea, in degrees.

**Tide station:** Clear `localStorage.removeItem('myweather-tide-station')` to re-detect. The finder tries the 5 nearest NOAA stations and picks the first with valid prediction data.
