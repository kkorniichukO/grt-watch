# GRT Watch

A live bus map for Grand River Transit (GRT) in Waterloo Region, Ontario. Built as a personal project because the existing options for tracking GRT buses weren't great.

> **Status:** work in progress. Stops, scheduled departures and route lines work on real GRT data. Live bus positions are wired up to GRT's real-time feed, but the feed has been stale at times, so the app ignores old positions and can fall back to simulated "demo" buses.
>
> This is an independent student project. It is **not affiliated with or endorsed by** Grand River Transit or the Region of Waterloo.

## Features

- Interactive map of buses, labelled by route, with a route filter
- Draws the selected route's full path on the map
- Bus stops load automatically for the part of the map you're viewing (zoom in to see them)
- Click a stop to see its upcoming scheduled departures
- Clean, street-names-only basemap
- Freshness check: positions older than 5 minutes are hidden, and the toolbar shows whether the feed is live, stale, or in demo mode
- Demo mode: simulated buses that follow real route paths, for development when the live feed is down

## Repository layout

```
grt-watch/
├── README.md        <- you are here (project overview + setup)
├── server/          Express API (Node + TypeScript)
│   ├── data/gtfs/   GRT static GTFS files (not committed, see setup)
│   └── src/
│       ├── index.ts      API routes, live-feed polling, demo-mode switch
│       ├── stops.ts      Loads stops.txt, stop search
│       ├── schedule.ts   Loads timetables, computes departures
│       ├── shapes.ts     Loads route paths, simulates demo buses
│       └── grtFetch.ts   HTTPS helper for GRT's server (see notes)
└── client/          React + Vite frontend (see client/README.md)
```

## Tech stack

| Part | Tools |
|---|---|
| Frontend | React, TypeScript, Vite, MapLibre GL JS |
| Backend | Node.js, Express, TypeScript (run with `tsx`) |
| Data | GRT's GTFS (static schedule) and GTFS-Realtime (vehicle positions) feeds |
| Map tiles | OpenFreeMap (Positron style), data from OpenStreetMap |

## Getting started

### Prerequisites

- Node.js 20.19 or newer (24 LTS works), which includes npm
- Git

### 1. Clone and install

```bash
git clone https://github.com/kkorniichukO/grt-watch.git
cd grt-watch

cd server && npm install && cd ..
cd client && npm install && cd ..
```

### 2. Download the GRT schedule data

The schedule files aren't stored in this repo (they're large and change every few weeks).

1. Open https://webapps.regionofwaterloo.ca/api/grt-routes/
2. Under **Bus → Static Feed**, download `GTFS.zip`
3. Unzip it into `server/data/gtfs`:

```bash
cd server
mkdir -p data/gtfs
unzip -o ~/Downloads/GTFS.zip -d data/gtfs
ls data/gtfs      # should list stops.txt, routes.txt, trips.txt, stop_times.txt, ...
```

Check that the schedule covers today:

```bash
tail -n +2 data/gtfs/calendar_dates.txt | cut -d, -f2 | sort -u | sed -n '1p;$p'
```

Re-download whenever GRT publishes a new schedule, then restart the server.

### 3. Run it

Use two terminal tabs:

```bash
# Tab 1: API on http://localhost:3001
cd server
npm run dev

# Tab 2: frontend on http://localhost:5173
cd client
npm run dev
```

Open http://localhost:5173. Frontend details are in [client/README.md](client/README.md).

## Server configuration

Settings at the top of `server/src/index.ts`:

| Setting | Default | What it does |
|---|---|---|
| `USE_MOCK` | `true` or `false` | `true` shows simulated buses on real route paths. `false` reads GRT's live feed. |
| `VEHICLES_URL` | `.../api/vehiclepositions/2` | GRT's bus vehicle-positions feed |
| `MAX_AGE_S` | `300` | Positions older than this many seconds are hidden |
| `POLL_MS` | `15000` (live) | How often the server polls GRT |
| `PORT` | `3001` | API port |

## API

| Endpoint | Description |
|---|---|
| `GET /api/vehicles?route=7` | Current buses, optionally filtered by route. Includes `feedTimestamp` and a `mock` flag. |
| `GET /api/stops/bbox?west=&south=&east=&north=` | Stops inside a map area (max 400) |
| `GET /api/stops/nearby?lat=&lon=&radius=` | Stops within a radius in metres (max 2000) |
| `GET /api/stops/:id/departures?date=YYYYMMDD&time=HH:MM` | Upcoming scheduled departures. `date` and `time` are optional and default to now in Toronto time. |
| `GET /api/routes/:id/shapes` | Route path(s) as `[lon, lat]` coordinate lists |

## Notes and known issues

- **GRT's server uses a weak TLS setting.** Its HTTPS connection uses a small Diffie-Hellman key, which Node rejects by default (`ERR_SSL_DH_KEY_TOO_SMALL`). `server/src/grtFetch.ts` lowers the security level (`DEFAULT@SECLEVEL=1`) for GRT requests only. This is a known compromise, acceptable for public read-only transit data; the real fix is on GRT's side.
- **The live feed can go stale.** Positions older than 5 minutes are dropped so you never see "ghost" buses frozen where they were hours ago.
- **Departures are scheduled times, not live predictions.** Live arrival times (trip-updates feed) aren't built yet.
- **Demo buses are fake.** Their timing and spacing are simulated. Only the roads and route paths are real.
- **Route IDs.** The route dropdown shows route IDs as they appear in the feed, which may not always match public route numbers.
- Trips that started the previous day and run past midnight aren't included in departures yet.

## Roadmap

- [ ] Live arrival predictions (GTFS-Realtime trip updates)
- [ ] Service alerts
- [ ] Favourite stops
- [ ] Stop search by name or number
- [ ] Route names in the dropdown ("7 Mill/Kingsway")
- [ ] Mobile-friendly layout
- [ ] ION light rail
- [ ] Snap live buses to their route path
- [ ] Deploy online

## Data and attribution

- Transit data: [Grand River Transit open data](https://www.grt.ca/about-grt/open-data/), published by the Region of Waterloo under its Open Data Licence. Read the licence before publishing or redistributing anything built on it.
- Map data: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors
- Map tiles and style: [OpenFreeMap](https://openfreemap.org/) (free public service, no uptime guarantee)
- Map rendering: [MapLibre GL JS](https://maplibre.org/)

## License

Add a license for your own code here (for example MIT) before making the repository public.
