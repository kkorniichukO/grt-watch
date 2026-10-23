import fs from "node:fs";
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

type Trip = {routeId: string; serviceId: string; headsing: string};
type StopTime = {tripId: string; sec: number};

export type Schedule ={
    routes: Map<string, string>; // route_id -> short name ("7")
    trips: Map<string, Trip>;
    services: Map<string, Set<string>>; // YYYYMMDD -> servis_ids running
    byStop: Map<string, StopTime[]>; // stop_id -> stored departures
    firstDate: string;
    lastDate: string;
};


export function toSeconds(t: string): number {
    const [h = "0", m = "0", s = "0"] = t.trim().split(":");
    return Number(h) * 3600 + Number(m) * 60 + Number(s); 
}

function fromatTime(sec: number): string {
    const h = Math.floor(sec / 3600) % 24;
    const m = Math.floor((sec % 3600) / 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function loadSchedule(): Schedule {
    const routes = new Map<string, string>();
    for (const r of readCsv("routes.txt")) {
        const id = r.route_id ?? "";
        routes.set(id, r.route_short_name || r.route_long_name || id);
    }

    const trips = new Map<string, Trip>();
    for(const t of readCsv("trips.txt")) {
        trips.set(t.trip_id ?? "", {
            routeId: t.route_id ?? "",
            serviceId: t.service_id ?? "",
            headsing: t.trip_headsign ?? "",
        });
    }

    const services = new Map<string, Set<string>>();
    let firstDate = "99999999";
    let lastDate = "00000000";

    for(const c of readCsv("calendar_dates.txt")) {
        const date = c.date ?? "";
        const serviceId = c.service_id ?? "";

        if(!date) continue;
        if(date < firstDate) firstDate = date;
        if(date > lastDate) lastDate = date;
        
        let set = services.get(date);

        if(!set) {
            set = new Set<string>();
            services.set(date, set);
        }

        if(c.exception_type === "1") set.add(serviceId); // service added
        if (c.exception_type === "2") set.delete(serviceId); // service removed
    }
    
    const byStop = new Map<string, StopTime[]>();
    for(const st of readCsv("stop_times.txt")) {
        const stopId = st.stop_id ?? "";
        const time = st.departure_time || st.arrival_time || "";
        
        if(!stopId || !time) continue;
        let list = byStop.get(stopId);

        if(!list) {
            list = [];
            byStop.set(stopId, list);
        }

        list.push({
            tripId: st.trip_id ?? "",
            sec: toSeconds(time),
        });
    }

    for(const list of byStop.values()) {
        list.sort((a, b) => a.sec - b.sec);
    }

    return {
        routes,
        trips,
        services,
        byStop,
        firstDate,
        lastDate,
    };
}

export function departuresAt(
    schedule: Schedule,
    stopId: string,
    date: string,
    nowSec: number,
    limit = 8
) {
    const active = schedule.services.get(date);
    const list = schedule.byStop.get(stopId) ?? [];
    const out: {route: string; headsign: string; time: string, inMinutes: number}[] = [];

    for(const st of list) {
        if(st.sec < nowSec) continue;
        const trip = schedule.trips.get(st.tripId);
        if(!trip || !active?.has(trip.serviceId)) continue;

        out.push({
            route: schedule.routes.get(trip.routeId) ?? trip.routeId,
            headsign: trip.headsing,
            time: fromatTime(st.sec),
            inMinutes: Math.floor((st.sec - nowSec) / 60),
        });

        if(out.length >= limit) break;
    }

    return out;
}