export type Coord = { lat: number; lng: number };

/** Great-circle distance in kilometres. */
export function haversineKm(a: Coord, b: Coord): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type Fare = { km: number; kes: number; sats: number };

/** Demo fare: a KES figure for realism + a small ckBTC sat amount to settle. */
export function estimateFare(pickup: Coord, dropoff: Coord): Fare {
  const km = haversineKm(pickup, dropoff);
  const kes = Math.round(150 + km * 75); // base 150 + 75/km
  const sats = Math.max(300, Math.round(km * 350)); // ckTESTBTC amount (e8s)
  return { km, kes, sats };
}
