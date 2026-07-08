// Single source of brand config. Rename here to rebrand everywhere.
export const brand = {
  name: "Kivuli",
  // Swahili for "shadow" — dark, private, premium.
  tagline: "Move in the shadows",
  // Westlands, Nairobi
  defaultCenter: { lat: -1.2686, lng: 36.8115 },
  // A wider Nairobi view so all demo destinations are visible.
  mapCenter: [36.82, -1.3] as [number, number],
  mapZoom: 11,
  driverId: "KV-DRV-07",
} as const;
