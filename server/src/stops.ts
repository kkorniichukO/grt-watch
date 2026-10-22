import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";

export type Stop = {
    id: string;
    code :string;
    name: string;
    lat: number;
    lon: number;
};

const STOPS_FILE = path.join(process.cwd(), "data", "gtfs", "stops.txt");

export function loadStops(): Stop[] {
    const raw = fs.readFileSync(STOPS_FILE, "utf8");
    const rows = parse(raw, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      relax_quotes: true,
    }) as Record<string, string>[];
  
    return rows
      .map((r) => ({
        id: r.stop_id ?? "",
        code: r.stop_code ?? "",
        name: r.stop_name ?? "",
        lat: parseFloat(r.stop_lat ?? ""),
        lon: parseFloat(r.stop_lon ?? ""),
      }))
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
}

// Distance between 2 point in meteres
function distanceM(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat/ 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    
      return 2 * R * Math.asin(Math.sqrt(a));
}

export function nearbyStops (
    stops: Stop[],
    lat: number,
    lon: number,
    radiusM: number,
    limit = 50
) {
    return stops
        .map((s) => ({ ...s, distance: Math.round(distanceM(lat, lon, s.lat, s.lon)) }))
        .filter((s) => s.distance <= radiusM)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, limit);
}
