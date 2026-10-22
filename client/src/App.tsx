import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type Vehicle = {
  id: string;
  routeId: string | null;
  lat: number;
  lon: number;
  bearing: number | null;
};

const API_URL = "http://localhost:3001/api/vehicles";
const POLL_MS = 5000;
const WATERLOO: [number, number] = [-80.5204, 43.4643]; // [lon, lat]

export default function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [route, setRoute] = useState("all");
  const [error, setError] = useState<string | null>(null);

  // 1. Create the map once
  useEffect(() => {
    if (!mapContainer.current) return;
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: WATERLOO,
      zoom: 12,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
    };
  }, []);

  // 2. Fetch buses every few seconds
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(API_URL);
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

  // 3. Draw/update markers whenever buses or the filter change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const visible = vehicles.filter(
      (v) => route === "all" || v.routeId === route
    );
    const visibleIds = new Set(visible.map((v) => v.id));

    // remove markers for buses that are gone or filtered out
    for (const [id, marker] of markersRef.current) {
      if (!visibleIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    // add new markers or move existing ones
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
        {error && <div style={{ color: "#b00020", marginTop: 6 }}>{error}</div>}
      </div>
      <div ref={mapContainer} style={{ height: "100%" }} />
    </div>
  );
}