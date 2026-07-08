import { haversineKm, type Coord } from "@/lib/fare";

export type LngLat = [number, number];

export type Route = {
  /** Road geometry as [lng, lat] pairs. */
  coords: LngLat[];
  /** Estimated driving time in seconds (OSRM), used for ETAs. */
  durationSec: number;
  /** Route length in km. */
  distanceKm: number;
};

/**
 * Fetch a road-following driving route between two points via the public OSRM
 * demo server. Returns the geometry plus OSRM's own duration/distance so the UI
 * can show a real ETA. Falls back to a straight line + a ~26 km/h city estimate
 * on any failure, so the demo never breaks.
 */
export async function fetchRoute(from: Coord, to: Coord): Promise<Route> {
  const km = haversineKm(from, to);
  const straight: Route = {
    coords: [
      [from.lng, from.lat],
      [to.lng, to.lat],
    ],
    durationSec: (km / 26) * 3600,
    distanceKm: km,
  };
  try {
    const url =
      `https://router.project-osrm.org/route/v1/driving/` +
      `${from.lng},${from.lat};${to.lng},${to.lat}` +
      `?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return straight;
    const data = await res.json();
    const route = data?.routes?.[0];
    const coords = route?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return straight;
    return {
      coords: coords as LngLat[],
      durationSec:
        typeof route.duration === "number"
          ? route.duration
          : straight.durationSec,
      distanceKm:
        typeof route.distance === "number" ? route.distance / 1000 : km,
    };
  } catch {
    return straight;
  }
}

/** Position at fraction f in [0,1] along a polyline, measured by real distance. */
export function pointAlong(path: LngLat[], f: number): Coord {
  if (path.length === 0) return { lat: 0, lng: 0 };
  if (path.length === 1 || f <= 0) return { lng: path[0][0], lat: path[0][1] };

  const segLen: number[] = [];
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const d = haversineKm(
      { lat: path[i][1], lng: path[i][0] },
      { lat: path[i + 1][1], lng: path[i + 1][0] },
    );
    segLen.push(d);
    total += d;
  }

  if (total === 0 || f >= 1) {
    const last = path[path.length - 1];
    return { lng: last[0], lat: last[1] };
  }

  let target = f * total;
  let i = 0;
  while (i < segLen.length && target > segLen[i]) {
    target -= segLen[i];
    i++;
  }
  const a = path[i];
  const b = path[i + 1] ?? path[i];
  const sf = segLen[i] ? target / segLen[i] : 0;
  return {
    lng: a[0] + (b[0] - a[0]) * sf,
    lat: a[1] + (b[1] - a[1]) * sf,
  };
}
