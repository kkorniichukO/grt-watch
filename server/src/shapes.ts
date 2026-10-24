import fs, { read } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";

const DIR = path.join(process.cwd(), "data", "gtfs");

function readCsv(name: string): Record<string, string>[] {
    const raw = fs.readFileSync(path.join(DIR, name), "utf8");
    return parse(raw, {
        columns: true,
        skip_empty_lines: true,
        bom: true,
        relax_quotes: true,
    }) as Record<string, string>[];
}

type LatLon = {
    lat: number;
    lon: number;
};

export type RoutePath = {
    routeId: string;
    directionId: string;
    points: LatLon[];
    cum: number[];
    length: number;
};

function distamceM(a: LatLon, b: LatLon) {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLon = toRad(b.lon - a.lon);
    const dLat = toRad(b.lat - a.lat);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;

    return 2 * R * Math.asin(Math.sqrt(h));
}

function bearingDeg(a: LatLon, b: LatLon) {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLon = toRad(b.lon - a.lon);
    const y = Math.sin(dLon) * Math.cos(toRad(b.lat));
    const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLon);
    return Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
}

export function loadRoutePaths() : RoutePath[] {
    // 1. For each route + direction, pick the mosy commonly used shape
    const counts = new Map<string, Map<string, number>>();

    for(const t of readCsv("trips.txt")) {
        const shapeId = t.shape_id ?? "";
        if(!shapeId) continue;
        const key = `${t.route_id ?? ""}|${t.direction_id ?? "0"}`;
        let m = counts.get(key);
        if(!m){
            m = new Map<string, number>();
            counts.set(key, m);
        }
        m.set(shapeId, (m.get(shapeId) ?? 0) + 1);
    }

    const chosen = new Map<string, string>(); // route|dir -> shape_id
    const needed = new Set<string>();

    for(const [key, m] of counts) {
        let best = "";
        let bestN = -1;
        for(const [shapeId, n] of m) {
            if(n > bestN) {
                best = shapeId;
                bestN = n;
            }
        }
        chosen.set(key, best);
        needed.add(best);
    }

    // 2. Read only the shapes we need
    const raw = new Map<string, {seq: number; lat: number; lon: number}[]>();

    for(const r of readCsv("shapes.txt")) {
        const id = r.shape_id ?? "";
        if(!needed.has(id)) continue;

        const lat = parseFloat(r.shape_pt_lat ?? "");
        const lon = parseFloat(r.shape_pt_lon ?? "");
        const seq = parseInt(r.shape_pt_sequence ?? "", 10);

        if(!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(seq)) continue;

        let list = raw.get(id);

        if(!list) {
            list = [];
            raw.set(id, list);
        }

        list.push({seq, lat, lon});
    }

    // 3. Build paths with comulative distances
    const paths: RoutePath[] = [];

    for(const [key, shapeId] of chosen) {
        const pts = raw.get(shapeId);

        if(!pts || pts.length < 2) continue;

        pts.sort((a, b) => a.seq - b.seq);

        const points: LatLon[] = pts.map((p) => ({lat: p.lat, lon: p.lon}));
        const cum: number[] = [0];

        for(let i = 1; i < points.length; i++) {
            const a = points[i - 1];
            const b = points[i];

            cum.push((cum[i - 1] ?? 0) + (a && b ? distamceM(a, b) : 0));
        }
        const [routeId = "", directionId = "0"] = key.split("|");

        paths.push({ routeId, directionId, points, cum, length: cum[cum.length - 1] ?? 0 });
    }

    return paths;
}

function hash(s: string){
    let h = 0;
    for(let i =0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
}

function pointAt(p: RoutePath, d: number) {
    let lo = 0;
    let hi = p.cum.length - 1;

    while(lo < hi - 1){
        const mid = (lo + hi) >> 1;
        if((p.cum[mid ] ?? 0) <= d) lo = mid;
        else hi = mid;
    }

    const a = p.points[lo];
    const b = p.points[hi];

    if(!a || !b) return null;

    const segLen = (p.cum[hi] ?? 0) - (p.cum[lo] ?? 0);
    const f = segLen > 0? (d - (p.cum[lo] ?? 0)) / segLen : 0;

    return {
        lat: a.lat + (b.lat - a.lat) * f,
        lon: a.lon + (b.lon - a.lon) * f,
        bearing: bearingDeg(a,b),
    };
}

const SPEED_MPS = 6; // roughtly 22 km/h

//Fake buses that driving along real routes paths (mock data only)
export function simulateBuses(paths: RoutePath[], nowMs: number) {
    const t = nowMs / 1000;
    const out: {
        id: string;
        routeId: string;
        tripId: null;
        lat: number;
        lon: number;
        bearing: number;
    }[] = [];

    for (const p of paths) {
        if(p.length < 500) continue;

        const n = Math.max(1, Math.min(3, Math.round(p.length / 5000)));
        const offset = hash(`${p.routeId}|${p.directionId}`) % Math.max(1, Math.floor(p.length));

        for(let i = 0; i < n; i++){
            const raw = t * SPEED_MPS + (i * p.length) / n + offset;
            const d = ((raw % p.length) + p.length) % p.length;
            const pos = pointAt(p, d);

            if(!pos) continue;

            out.push({
                id: `${p.routeId}-${p.directionId}-${i}`,
                routeId: p.routeId,
                tripId: null,
                lat: pos.lat,
                lon: pos.lon,
                bearing: pos.bearing,
            });
        }
    }

    return out;
}
