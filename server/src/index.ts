import express from "express";
import cors from "cors";
import * as GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { loadStops, nearbyStops, type Stop } from "./stops";

const VEHICLES_URL =
  "http://webapps.regionofwaterloo.ca/api/grt-routes/api/vehiclepositions";
const USE_MOCK = true; // set to false to use the real GRT feed
const POLL_MS = USE_MOCK ? 3_000 : 15_000;
const PORT = 3001;

type Vehicle = {
  id: string;
  routeId: string | null;
  tripId: string | null;
  lat: number;
  lon: number;
  bearing: number | null;
};

let vehicles: Vehicle[] = [];
let lastUpdated: number | null = null;

async function refreshVehicles() {
  if (USE_MOCK) {
    vehicles = mockVehicles();
    lastUpdated = Date.now();
    return;
  }

  try {
    const res = await fetch(VEHICLES_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const buffer = new Uint8Array(await res.arrayBuffer());
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(buffer);

    vehicles = feed.entity.flatMap((e) => {
      const v = e.vehicle;
      if (!v?.position) return [];
      return [
        {
          id: v.vehicle?.id ?? e.id,
          routeId: v.trip?.routeId ?? null,
          tripId: v.trip?.tripId ?? null,
          lat: v.position.latitude,
          lon: v.position.longitude,
          bearing: v.position.bearing ?? null,
        },
      ];
    });
    lastUpdated = Date.now();
    console.log(`Updated: ${vehicles.length} vehicles`);
  } catch (err) {
    console.error("Failed to refresh vehicles:", err);
  }
}

function mockVehicles(): Vehicle[] {
    const t = Date.now() / 1000;
    const loops = [
      { routeId: "7", lat: 43.4723, lon: -80.5449, radius: 0.012, speed: 0.02 },
      { routeId: "8", lat: 43.4643, lon: -80.5204, radius: 0.015, speed: 0.015 },
      { routeId: "301", lat: 43.4516, lon: -80.4925, radius: 0.02, speed: 0.01 },
    ];

    return loops.flatMap((r) =>
      [0, 1, 2].map((i) => {
        const angle = t * r.speed + (i * 2 * Math.PI) / 3;
        return {
          id: `${r.routeId}-${i}`,
          routeId: r.routeId,
          tripId: null,
          lat: r.lat + Math.sin(angle) * r.radius,
          lon: r.lon + Math.cos(angle) * r.radius * 1.4,
          bearing: Math.round(((angle * 180) / Math.PI + 90) % 360),
        };
      })
    );
}
        


let stops: Stop[] = [];
try {
    stops = loadStops();
    console.log(`Loaded ${stops.length} stops`);
} catch (err) {
    console.error("Could not load stops.txt. Did you download the GTFS data?", err);
}

const app = express();
app.use(cors());

app.get("/api/vehicles", (req, res) => {
  const route = req.query.route as string | undefined;
  const data = route ? vehicles.filter((v) => v.routeId === route) : vehicles;
  res.json({ lastUpdated, count: data.length, vehicles: data });
});

app.get("/api/stops/nearby", (req, res) =>{
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);
    const radius = Math.min(parseFloat((req.query.radius as string) ?? "500") || 500, 2000);

    if(!Number.isFinite(lat) || !Number.isFinite(lon)) {
        res.status(400).json({ erro: "Lat and lon are required numbers"});
        return;
    }

    res.json({ stops: nearbyStops(stops, lat, lon, radius) });
});

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
  refreshVehicles();
  setInterval(refreshVehicles, POLL_MS);
});