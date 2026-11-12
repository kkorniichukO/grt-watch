import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";

// MapLibre 6 needs to be told where its tile-parsing worker lives
maplibregl.setWorkerUrl(maplibreWorkerUrl);

type Vehicle = {
  id: string;
  routeId: string | null;
  lat: number;
  lon: number;
  bearing: number | null;
};

type Stop = {
  id: string;
  code: string;
  name: string;
  lat: number;
  lon: number;
};

type Departure = {
  route: string;
  headsign: string;
  time: string;
  inMinutes: number;
};

type DeparturesResponse = {
  noService: boolean;
  coverage: { first: string; last: string };
  departures: Departure[];
};

const API = "http://localhost:3001/api";
const POLL_MS = 5000;
const WATERLOO: [number, number] = [-80.5204, 43.4643]; // [lon, lat]
const MIN_STOP_ZOOM = 14; // stops only load when zoomed in this far

// Leave empty to use today's date and time.
// For testing at odd hours, use: "?time=08:00"
const DEPARTURES_QUERY = "";

async function fillPopup(stop: Stop, box: HTMLElement) {
  box.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = `${stop.name} (#${stop.id})`;
  const body = document.createElement("div");
  body.style.marginTop = "6px";
  body.textContent = "Loading departures...";
  box.append(title, body);

  try {
    const res = await fetch(
      `${API}/stops/${encodeURIComponent(stop.id)}/departures${DEPARTURES_QUERY}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: DeparturesResponse = await res.json();
    body.replaceChildren();

    if (data.departures.length === 0) {
      body.textContent = data.noService
        ? `No schedule data for today (the loaded data covers ${data.coverage.first} to ${data.coverage.last}).`
        : "No more scheduled departures today.";
      return;
    }
    for (const d of data.departures) {
      const row = document.createElement("div");
      row.textContent = `${d.time}  ·  ${d.route} ${d.headsign}  (${d.inMinutes} min)`;
      body.appendChild(row);
    }
    const note = document.createElement("div");
    note.style.cssText = "margin-top:6px;font-size:11px;color:#666";
    note.textContent = "Scheduled times, not live";
    body.appendChild(note);
  } catch {
    body.textContent = "Couldn't load departures.";
  }
}

export default function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const stopMarkersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const youMarkerRef = useRef<maplibregl.Marker | null>(null);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [route, setRoute] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [feedNote, setFeedNote] = useState<string | null>(null);

  // 1. Create the map once, and load stops whenever the view changes
  useEffect(() => {
    if (!mapContainer.current) return;
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: "https://tiles.openfreemap.org/styles/positron",
      center: WATERLOO,
      zoom: 12,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    // Keep only road-name labels; hide shops, parks, churches, towns, etc.
    map.on("load", () => {
      const layers = map.getStyle().layers ?? [];
      const keep =
        /(road|highway|street).*(name|label)|(name|label).*(road|highway|street)/i;
      for (const layer of layers) {
        if (layer.type === "symbol" && !keep.test(layer.id)) {
          map.setLayoutProperty(layer.id, "visibility", "none");
        }
      }
    });

    // Load the stops inside the current view (only when zoomed in)
    let requestId = 0;
    async function loadStopsInView() {
      const stopMarkers = stopMarkersRef.current;

      if (map.getZoom() < MIN_STOP_ZOOM) {
        stopMarkers.forEach((m) => m.remove());
        stopMarkers.clear();
        setStatus("Zoom in to see stops");
        return;
      }

      const b = map.getBounds();
      const params = new URLSearchParams({
        west: String(b.getWest()),
        south: String(b.getSouth()),
        east: String(b.getEast()),
        north: String(b.getNorth()),
      });
      const myRequest = ++requestId;

      try {
        const res = await fetch(`${API}/stops/bbox?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: { stops: Stop[]; truncated: boolean } = await res.json();
        if (myRequest !== requestId) return; // a newer request replaced this one

        const keepIds = new Set(data.stops.map((s) => s.id));

        // remove markers that left the view
        for (const [id, marker] of stopMarkers) {
          if (!keepIds.has(id)) {
            marker.remove();
            stopMarkers.delete(id);
          }
        }

        // add markers for new stops
        for (const s of data.stops) {
          if (stopMarkers.has(s.id)) continue;
          const el = document.createElement("div");
          el.className = "stop-marker";
          const box = document.createElement("div");
          const popup = new maplibregl.Popup({
            offset: 12,
            maxWidth: "280px",
          }).setDOMContent(box);
          popup.on("open", () => fillPopup(s, box));
          const marker = new maplibregl.Marker({ element: el })
            .setLngLat([s.lon, s.lat])
            .setPopup(popup)
            .addTo(map);
          stopMarkers.set(s.id, marker);
        }

        setStatus(
          data.truncated
            ? "Showing the first 400 stops. Zoom in for more."
            : `${data.stops.length} stops in view`
        );
      } catch {
        if (myRequest === requestId) {
          setStatus("Couldn't load stops. Is the server running?");
        }
      }
    }

    // Wait a moment after the map stops moving, so we don't spam the server
    let timer: number | undefined;
    const scheduleLoad = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(loadStopsInView, 300);
    };
    map.on("moveend", scheduleLoad);
    map.on("load", scheduleLoad);

    mapRef.current = map;
    return () => {
      window.clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      stopMarkersRef.current.clear();
    };
  }, []);

  // 2. Fetch buses every few seconds
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API}/vehicles`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setVehicles(data.vehicles);

        if (data.mock) {
          setFeedNote("Demo mode: simulated buses");
        } else if (!data.feedTimestamp) {
          setFeedNote("Waiting for live data...");
        } else {
          const ageMin = Math.round(
            (Date.now() / 1000 - data.feedTimestamp) / 60
          );
          setFeedNote(
            ageMin > 5
              ? `Live feed is ${
                  ageMin >= 120
                    ? Math.round(ageMin / 60) + " hours"
                    : ageMin + " min"
                } old, so no buses are shown`
              : "Live"
          );
        }
        setError(null);
      } catch {
        setError("Can't reach the API. Is the server running?");
      }
    }
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, []);

  // 3. Draw/update bus markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const visible = vehicles.filter(
      (v) => route === "all" || v.routeId === route
    );
    const visibleIds = new Set(visible.map((v) => v.id));

    for (const [id, marker] of markersRef.current) {
      if (!visibleIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    for (const v of visible) {
      const existing = markersRef.current.get(v.id);
      if (existing) {
        existing.setLngLat([v.lon, v.lat]);
      } else {
        const el = document.createElement("div");
        el.className = "bus-marker";
        el.textContent = v.routeId ?? "?";
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([v.lon, v.lat])
          .addTo(map);
        markersRef.current.set(v.id, marker);
      }
    }
  }, [vehicles, route]);

  // 3b. Draw the selected route's path as a line
  useEffect(() => {
    const found = mapRef.current;
    if (!found) return;
    const map: maplibregl.Map = found;
    let cancelled = false;

    async function draw() {
      let shapes: number[][][] = [];
      if (route !== "all") {
        try {
          const res = await fetch(
            `${API}/routes/${encodeURIComponent(route)}/shapes`
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data: { shapes: number[][][] } = await res.json();
          shapes = data.shapes;
        } catch (err) {
          console.error("Route shape request failed:", err);
        }
      }
      if (cancelled) return;

      const collection = {
        type: "FeatureCollection" as const,
        features: shapes.map((coordinates) => ({
          type: "Feature" as const,
          properties: {},
          geometry: { type: "LineString" as const, coordinates },
        })),
      };

      const apply = () => {
        const src = map.getSource("route-line") as
          | maplibregl.GeoJSONSource
          | undefined;
        if (src) {
          src.setData(collection);
          return;
        }
        map.addSource("route-line", { type: "geojson", data: collection });
        map.addLayer({
          id: "route-line",
          type: "line",
          source: "route-line",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#d62828",
            "line-width": 4,
            "line-opacity": 0.7,
          },
        });
      };

      try {
        apply();
      } catch {
        // style not ready yet: try again when the map is idle
        map.once("idle", () => {
          if (!cancelled) apply();
        });
      }
    }

    draw();
    return () => {
      cancelled = true;
    };
  }, [route]);

  // Move the map to the user's location. Stops load by themselves afterwards.
  function findNearMe() {
    setStatus("Finding your location...");
    if (!navigator.geolocation) {
      setStatus("Geolocation isn't supported in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const map = mapRef.current;
        if (!map) return;
        const lngLat: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        youMarkerRef.current?.remove();
        youMarkerRef.current = new maplibregl.Marker({ color: "#16a34a" })
          .setLngLat(lngLat)
          .addTo(map);
        map.flyTo({ center: lngLat, zoom: 16 });
      },
      () => setStatus("Location denied. Zoom in on the map to see stops.")
    );
  }

  const routes = (
    [...new Set(vehicles.map((v) => v.routeId).filter(Boolean))] as string[]
  ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return (
    <div style={{ position: "relative", height: "100%" }}>
      <div className="toolbar">
        <label>
          Route:{" "}
          <select value={route} onChange={(e) => setRoute(e.target.value)}>
            <option value="all">All routes</option>
            {routes.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <div>
          <button onClick={findNearMe}>Go to my location</button>
        </div>
        {status && <div style={{ marginTop: 6 }}>{status}</div>}
        {feedNote && (
          <div style={{ marginTop: 6, fontSize: 12, color: "#555" }}>
            {feedNote}
          </div>
        )}
        {error && <div style={{ color: "#b00020", marginTop: 6 }}>{error}</div>}
      </div>
      <div ref={mapContainer} style={{ height: "100%" }} />
    </div>
  );
}