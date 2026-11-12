# GRT Watch: Client

The React frontend for [GRT Watch](../README.md): a live bus map for Grand River Transit in Waterloo Region. It talks to the Express API in `../server`.

## Stack

- React + TypeScript
- Vite (dev server and build)
- MapLibre GL JS 6 for the map
- OpenFreeMap "Positron" vector style as the basemap

## Requirements

- Node.js 20.19 or newer
- The API running on `http://localhost:3001` (start it with `npm run dev` in `../server`)

## Scripts

Run these from the `client` folder:

| Command | What it does |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Start the dev server at http://localhost:5173 |
| `npm run build` | Type-check and build for production into `dist/` |
| `npm run preview` | Serve the production build locally |

If the dev server acts strangely after dependency changes, restart it with a clean cache: `npx vite --force`.

## Files

```
client/
├── index.html
├── package.json
├── vite.config.ts
└── src/
    ├── main.tsx      App entry point
    ├── App.tsx       Everything: map, markers, popups, toolbar
    └── index.css     Page, marker, popup and toolbar styles
```

## How it works

`src/App.tsx` is a single component with a few effects:

1. **Map setup.** Creates the MapLibre map once, hides every label layer except road names (so the basemap shows only street names), and listens for `moveend` events.
2. **Stops in view.** After the map stops moving (300 ms debounce) and you're zoomed in to `MIN_STOP_ZOOM` or closer, it asks `GET /api/stops/bbox` for stops inside the visible area. Existing markers are reused, stops that left the view are removed, and stale responses are ignored.
3. **Bus polling.** Every 5 seconds it fetches `GET /api/vehicles` and updates the toolbar note (live, stale, or demo mode).
4. **Bus markers.** Moves existing markers and adds or removes the rest, filtered by the selected route.
5. **Route line.** When a route is selected, it fetches `GET /api/routes/:id/shapes` and draws the path as a GeoJSON line layer.
6. **Stop popups.** Clicking a stop fetches `GET /api/stops/:id/departures` and lists the next scheduled departures.

## Configuration

Constants at the top of `src/App.tsx`:

| Constant | Default | Purpose |
|---|---|---|
| `API` | `http://localhost:3001/api` | Base URL of the API |
| `POLL_MS` | `5000` | How often to refresh bus positions |
| `MIN_STOP_ZOOM` | `14` | Minimum zoom before stops load |
| `DEPARTURES_QUERY` | `""` | Extra query string for departures, e.g. `"?time=08:00"` to test at odd hours |

The marker and toolbar styles (`.bus-marker`, `.stop-marker`, `.toolbar`) are in `src/index.css`.

## Things to know

- **MapLibre 6 needs its worker URL set under Vite.** `App.tsx` imports `maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url` and calls `maplibregl.setWorkerUrl(...)`. Without it the map fails with "Worker failed to load". If TypeScript complains about the `?worker&url` import, add `src/vite-env-extra.d.ts`:
  ```ts
  declare module "*?worker&url" {
    const url: string;
    export default url;
  }
  ```
- **`import * as maplibregl`** is used because the package has no default export in v6.
- **Route dropdown.** It only lists routes that currently have buses on the map, so it's empty when the live feed is stale. Turn on demo mode in the server (`USE_MOCK = true`) to test it.
- **Basemap tiles** come from OpenFreeMap, a free public service with no uptime guarantee.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Blank map, console says `Worker failed to load` | The `setWorkerUrl` lines are missing or wrong (see above) |
| Toolbar says "Can't reach the API" | The server isn't running on port 3001 |
| No stops appear | Zoom in to level 14 or closer, and check the server loaded `stops.txt` |
| Popup says "No schedule data for today" | The GTFS files in `server/data/gtfs` don't cover today's date |
| No buses, toolbar says the feed is hours old | GRT's live feed is stale; use demo mode for development |
