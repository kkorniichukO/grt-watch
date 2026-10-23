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
  distance: number;
};

const API = "http://localhost:3001/api";
const POLL_MS = 5000;
const WATERLOO: [number, number] = [-80.5204, 43.4643]; // [lon, lat]

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

async function fillPopup(stop: Stop, box: HTMLElement) {
  box.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = `${stop.name} (#${stop.id})`;
  const body = document.createElement("div");
  body.style.marginTop = "6px";
  body.textContent = "Loading departures...";
  box.append(title, body);

  try {
    const res = await fetch(`${API}/stops/${encodeURIComponent(stop.id)}/departures?date=20260218&time=08:00`);
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: DeparturesResponse = await res.json();
    body.replaceChildren();

    if(data.departures.length === 0){
      body.textContent = data.noService 
      ? `No schedule data for todate (the loaded data covers ${data.coverage.first} to ${data.coverage.last})`
      : "No more scheduled departures today";

      return;
    }

    for(const d of data.departures) {
      const row = document.createElement("div");
      row.textContent = `${d.time}  ·  ${d.route} ${d.headsign}  (${d.inMinutes} min)`;
      body.appendChild(row);
    }

    const note = document.createElement("div");
    note.style.cssText = "margine-top:6px;font-size:11px;colore:#666";
    note.textContent = "Schedule time, not live";
    body.appendChild(note);
  } catch {
    body.textContent = "Couldn't load departures";
  }
}

export default function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const stopMarkersRef = useRef<maplibregl.Marker[]>([]);
  const youMarkerRef = useRef<maplibregl.Marker | null>(null);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [route, setRoute] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // 1. Create the map once
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
      console.log(
        "Symbol layers:",
        layers.filter((l) => l.type === "symbol").map((l) => l.id)
      );
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
      stopMarkersRef.current = [];
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

  // 4. Find stops near a point and draw them
  async function showStopsNear(lat: number, lon: number, isYou: boolean) {
    const map = mapRef.current;
    if (!map) return;

    try {
      const res = await fetch(
        `${API}/stops/nearby?lat=${lat}&lon=${lon}&radius=600`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { stops: Stop[] } = await res.json();

      stopMarkersRef.current.forEach((m) => m.remove());
      stopMarkersRef.current = [];

      for (const s of data.stops) {
        const el = document.createElement("div");
        el.className = "stop-marker";
        const box = document.createElement("div");
        const popup = new maplibregl.Popup({ offset: 12, maxWidth: "280px" })
          .setDOMContent(box);
        popup.on("open", () => fillPopup(s, box));
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([s.lon, s.lat])
          .setPopup(popup)
          .addTo(map);
        stopMarkersRef.current.push(marker);
      }

      if (isYou) {
        youMarkerRef.current?.remove();
        youMarkerRef.current = new maplibregl.Marker({ color: "#16a34a" })
          .setLngLat([lon, lat])
          .addTo(map);
      }

      map.flyTo({ center: [lon, lat], zoom: 15 });
      setStatus(`${data.stops.length} stops within 600 m`);
    } catch {
      setStatus("Couldn't load stops. Is the server running with GTFS data?");
    }
  }

  function findNearMe() {
    setStatus("Finding your location...");
    if (!navigator.geolocation) {
      setStatus("Geolocation isn't supported in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => showStopsNear(pos.coords.latitude, pos.coords.longitude, true),
      () => {
        // fall back to the centre of the map if location is denied
        const c = mapRef.current?.getCenter();
        if (c) {
          setStatus("Location denied, using map centre...");
          showStopsNear(c.lat, c.lng, false);
        }
      }
    );
  }

  const routes = [
    ...new Set(vehicles.map((v) => v.routeId).filter(Boolean)),
  ] as string[];

  return (
    <div style={{ position: "relative", height: "100%" }}>
      <div className="toolbar">
        <label>
          Route:{" "}
          <select value={route} onChange={(e) => setRoute(e.target.value)}>
            <option value="all">All routes</option>
            {routes.sort().map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <div>
          <button onClick={findNearMe}>Stops near me</button>
        </div>
        {status && <div style={{ marginTop: 6 }}>{status}</div>}
        {error && <div style={{ color: "#b00020", marginTop: 6 }}>{error}</div>}
      </div>
      <div ref={mapContainer} style={{ height: "100%" }} />
    </div>
  );
}