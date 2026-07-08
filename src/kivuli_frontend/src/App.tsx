import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Car } from "lucide-react";
import {
  Map,
  MapMarker,
  MarkerContent,
  MarkerLabel,
  MapRoute,
} from "@/components/map";
import { brand } from "@/lib/brand";
import { estimateFare, type Coord, type Fare } from "@/lib/fare";
import * as canister from "@/lib/canister";
import { fetchRoute, pointAlong, type LngLat } from "@/lib/route";
import { cn } from "@/lib/utils";

type Phase = "idle" | "requesting" | "enroute" | "intrip" | "completed";
type Destination = { name: string; coord: Coord };

const DESTINATIONS: Destination[] = [
  { name: "CBD", coord: { lat: -1.2864, lng: 36.8172 } },
  { name: "Kilimani", coord: { lat: -1.2906, lng: 36.787 } },
  { name: "Karen", coord: { lat: -1.3197, lng: 36.7076 } },
  { name: "JKIA", coord: { lat: -1.3192, lng: 36.9278 } },
];

const GILT = "#c6a353";

export default function App() {
  const [pickup] = useState<Coord>(brand.defaultCenter);
  const [destName, setDestName] = useState<string | null>(null);
  const [dropoff, setDropoff] = useState<Coord | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [rideId, setRideId] = useState<string | null>(null);
  const [driver, setDriver] = useState<Coord | null>(null);
  const [chainStatus, setChainStatus] = useState<string | null>(null);
  const [seq, setSeq] = useState<bigint | null>(null);
  const [paid, setPaid] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payBlock, setPayBlock] = useState<bigint | null>(null);
  const [tripRoute, setTripRoute] = useState<LngLat[] | null>(null);

  const rafRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  const fare: Fare | null = useMemo(
    () => (dropoff ? estimateFare(pickup, dropoff) : null),
    [pickup, dropoff],
  );

  const tripCoords: LngLat[] | null = dropoff
    ? (tripRoute ?? [
        [pickup.lng, pickup.lat],
        [dropoff.lng, dropoff.lat],
      ])
    : null;

  useEffect(() => {
    if (!rideId || phase === "idle") return;
    let active = true;
    const tick = async () => {
      const r = await canister.getRide(rideId);
      if (active && r) {
        setChainStatus(r.status);
        setSeq(r.seq);
      }
    };
    void tick();
    const iv = setInterval(() => void tick(), 1200);
    return () => {
      active = false;
      clearInterval(iv);
    };
  }, [rideId, phase]);

  const animatePath = useCallback(
    (path: LngLat[], ms: number, onTick: (c: Coord) => void) =>
      new Promise<void>((resolve) => {
        const start = performance.now();
        const step = (now: number) => {
          if (cancelledRef.current) return resolve();
          const t = Math.min(1, (now - start) / ms);
          onTick(pointAlong(path, t));
          if (t < 1) rafRef.current = requestAnimationFrame(step);
          else resolve();
        };
        rafRef.current = requestAnimationFrame(step);
      }),
    [],
  );

  const selectDestination = async (d: Destination) => {
    if (phase !== "idle") return;
    setDestName(d.name);
    setDropoff(d.coord);
    setTripRoute(null);
    const route = await fetchRoute(pickup, d.coord);
    setTripRoute(route);
  };

  const handleRequest = async () => {
    if (!dropoff || !fare) return;
    cancelledRef.current = false;
    setPhase("requesting");
    try {
      const id = await canister.requestRide(pickup, dropoff, fare.sats);
      setRideId(id);
      const driverStart: Coord = {
        lat: pickup.lat + 0.014,
        lng: pickup.lng - 0.016,
      };
      await canister.acceptRide(
        id,
        brand.driverId,
        driverStart.lat,
        driverStart.lng,
      );

      // Road-follow the driver: approach route to the rider, then the trip route.
      const approach = await fetchRoute(driverStart, pickup);
      const trip = tripRoute ?? (await fetchRoute(pickup, dropoff));
      setDriver({ lng: approach[0][0], lat: approach[0][1] });
      setPhase("enroute");
      await animatePath(approach, 6500, setDriver);
      if (cancelledRef.current) return;
      await canister.updateDriver(id, pickup.lat, pickup.lng, "intrip");
      setPhase("intrip");
      await animatePath(trip, 9000, setDriver);
      if (cancelledRef.current) return;
      await canister.completeRide(id);
      setDriver(dropoff);
      setPhase("completed");
    } catch (err) {
      console.error(err);
      setPhase("idle");
    }
  };

  const handlePay = async () => {
    if (!rideId) return;
    setPaying(true);
    try {
      const block = await canister.payRide(rideId);
      setPayBlock(block);
      setPaid(true);
    } catch (err) {
      console.error(err);
    } finally {
      setPaying(false);
    }
  };

  const handleReset = () => {
    cancelledRef.current = true;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setPhase("idle");
    setRideId(null);
    setDriver(null);
    setDropoff(null);
    setDestName(null);
    setChainStatus(null);
    setSeq(null);
    setPaid(false);
    setPaying(false);
    setPayBlock(null);
    setTripRoute(null);
  };

  return (
    <div className="grain relative h-screen w-screen overflow-hidden bg-background">
      <Map
        theme="dark"
        center={brand.mapCenter}
        zoom={brand.mapZoom}
        className="absolute inset-0 [filter:brightness(0.9)_contrast(1.06)_saturate(0.68)]"
      >
        {tripCoords && (
          <>
            <MapRoute
              id="trip-glow"
              coordinates={tripCoords}
              color={GILT}
              width={10}
              opacity={0.12}
            />
            <MapRoute
              id="trip-line"
              coordinates={tripCoords}
              color={GILT}
              width={1.5}
              opacity={0.9}
            />
          </>
        )}

        <MapMarker longitude={pickup.lng} latitude={pickup.lat}>
          <MarkerContent>
            <div className="relative flex size-2.5 items-center justify-center">
              <span className="absolute inset-0 rounded-full border border-bone/40" />
              <span className="size-1.5 rounded-full bg-bone" />
            </div>
            <MarkerLabel className="font-mono text-[9px] tracking-[0.2em] text-bone/70">
              PICKUP
            </MarkerLabel>
          </MarkerContent>
        </MapMarker>

        {dropoff && (
          <MapMarker longitude={dropoff.lng} latitude={dropoff.lat}>
            <MarkerContent>
              <span className="block size-2.5 rotate-45 border border-gilt bg-gilt/30" />
              <MarkerLabel className="font-mono text-[9px] tracking-[0.2em] text-gilt uppercase">
                {destName}
              </MarkerLabel>
            </MarkerContent>
          </MapMarker>
        )}

        {driver && (
          <MapMarker longitude={driver.lng} latitude={driver.lat}>
            <MarkerContent>
              <div className="relative flex size-7 items-center justify-center rounded-full bg-[#0a0a0b] text-gilt shadow-lg shadow-black/60 ring-1 ring-gilt/50">
                <span className="kv-breathe absolute -inset-1 rounded-full ring-1 ring-gilt/40" />
                <Car className="relative size-3.5" />
              </div>
            </MarkerContent>
          </MapMarker>
        )}
      </Map>

      {/* Depth grade */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{
          background:
            "radial-gradient(130% 100% at 50% 12%, transparent 45%, rgba(0,0,0,0.5) 76%, rgba(0,0,0,0.86) 100%)",
        }}
      />

      {/* Wordmark */}
      <div className="pointer-events-none absolute top-6 left-7 z-20 flex select-none items-center gap-3">
        <EclipseMark />
        <div className="leading-none">
          <div className="font-display text-[27px] font-semibold tracking-[0.02em] text-bone">
            Kivuli
          </div>
          <div className="mt-1.5 font-mono text-[9px] tracking-[0.32em] text-mist uppercase">
            {brand.tagline}
          </div>
        </div>
      </div>

      {/* The black card */}
      <div className="absolute inset-x-0 bottom-0 z-20 p-4 sm:inset-x-auto sm:bottom-7 sm:left-7 sm:w-[384px] sm:p-0">
        <div
          className="kv-up relative overflow-hidden rounded-[22px] border border-white/8 bg-[#111113]/85 backdrop-blur-2xl"
          style={{
            boxShadow:
              "0 40px 90px -24px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.05)",
          }}
        >
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gilt/60 to-transparent" />
          <div className="p-5">
            <Panel
              phase={phase}
              destName={destName}
              dropoff={dropoff}
              fare={fare}
              seq={seq}
              chainStatus={chainStatus}
              paid={paid}
              paying={paying}
              payBlock={payBlock}
              onSelect={selectDestination}
              onRequest={() => void handleRequest()}
              onPay={() => void handlePay()}
              onReset={handleReset}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

type PanelProps = {
  phase: Phase;
  destName: string | null;
  dropoff: Coord | null;
  fare: Fare | null;
  seq: bigint | null;
  chainStatus: string | null;
  paid: boolean;
  paying: boolean;
  payBlock: bigint | null;
  onSelect: (d: Destination) => void;
  onRequest: () => void;
  onPay: () => void;
  onReset: () => void;
};

function Panel({
  phase,
  destName,
  dropoff,
  fare,
  seq,
  chainStatus,
  paid,
  paying,
  payBlock,
  onSelect,
  onRequest,
  onPay,
  onReset,
}: PanelProps) {
  if (phase === "idle") {
    return (
      <div className="space-y-5">
        <Header eyebrow="Destination" title="Where to?" trailing="Westlands" />
        <div className="flex flex-wrap gap-x-5 gap-y-2.5">
          {DESTINATIONS.map((d) => (
            <button
              key={d.name}
              onClick={() => onSelect(d)}
              className={cn(
                "font-display relative pb-1 text-lg transition-colors",
                destName === d.name
                  ? "text-bone"
                  : "text-mist hover:text-bone",
              )}
            >
              {d.name}
              {destName === d.name && (
                <span className="absolute inset-x-0 -bottom-px h-px bg-gilt" />
              )}
            </button>
          ))}
        </div>
        {fare && <FareBlock fare={fare} />}
        {dropoff ? (
          <BoneButton onClick={onRequest}>Request ride</BoneButton>
        ) : (
          <div className="rounded-xl border border-white/10 px-4 py-3.5 text-center font-mono text-[11px] tracking-[0.2em] text-mist uppercase">
            Choose a destination
          </div>
        )}
      </div>
    );
  }

  if (phase === "requesting") {
    return (
      <Header
        eyebrow="On-chain"
        title="Summoning a driver"
        trailing="…"
        breathe
      />
    );
  }

  if (phase === "enroute" || phase === "intrip") {
    const trip = phase === "intrip";
    return (
      <div className="space-y-4">
        <Header
          eyebrow={trip ? "In transit" : "Driver en route"}
          title={trip ? `To ${destName}` : "Arriving now"}
          trailingNode={<DriverChip />}
        />
        <OnChainRow seq={seq} status={chainStatus} />
        {fare && <FareBlock fare={fare} />}
      </div>
    );
  }

  // completed
  return (
    <div className="space-y-4">
      <Header eyebrow="Arrived" title={destName ?? "Trip complete"} />
      {!paid ? (
        <>
          {fare && <FareBlock fare={fare} />}
          <GiltButton onClick={onPay} loading={paying}>
            {paying
              ? "Settling on-chain…"
              : `Pay ${fare?.sats.toLocaleString()} sats · ckBTC`}
          </GiltButton>
        </>
      ) : (
        <div className="space-y-3">
          <div className="relative rounded-2xl border border-gilt/25 bg-gilt/[0.06] px-4 py-5 text-center">
            <div className="kv-stamp mx-auto mb-2 flex size-9 items-center justify-center rounded-full border border-gilt/50 text-gilt">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 12.5l4.5 4.5L19 7.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="font-display text-xl text-bone">Paid in ckBTC</div>
            <div className="mt-1 font-mono text-[10px] tracking-[0.18em] text-mist uppercase">
              {fare?.sats.toLocaleString()} sats
              {payBlock != null ? ` · block #${payBlock.toString()}` : ""}
            </div>
          </div>
          <button
            onClick={onReset}
            className="w-full py-1 text-center font-mono text-[10px] tracking-[0.3em] text-mist uppercase transition-colors hover:text-bone"
          >
            New ride
          </button>
        </div>
      )}
    </div>
  );
}

function Header({
  eyebrow,
  title,
  trailing,
  trailingNode,
  breathe,
}: {
  eyebrow: string;
  title: string;
  trailing?: string;
  trailingNode?: React.ReactNode;
  breathe?: boolean;
}) {
  return (
    <div className="flex items-start justify-between">
      <div>
        <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.3em] text-mist uppercase">
          {breathe && (
            <span className="kv-breathe size-1.5 rounded-full bg-gilt" />
          )}
          {eyebrow}
        </div>
        <div className="font-display mt-1 text-[26px] leading-none text-bone">
          {title}
        </div>
      </div>
      {trailingNode ??
        (trailing && (
          <div className="font-mono text-[10px] tracking-[0.2em] text-mist uppercase">
            {trailing}
          </div>
        ))}
    </div>
  );
}

function FareBlock({ fare }: { fare: Fare }) {
  return (
    <div className="flex items-end justify-between border-t border-white/8 pt-4">
      <div>
        <div className="font-mono text-[10px] tracking-[0.3em] text-mist uppercase">
          Fare · {fare.km.toFixed(1)} km
        </div>
        <div className="font-display mt-1 text-[34px] leading-none text-bone">
          <span className="mr-1 align-top text-base text-mist">KES</span>
          {fare.kes.toLocaleString()}
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono text-[10px] tracking-[0.3em] text-mist uppercase">
          ckBTC
        </div>
        <div className="mt-1 font-mono text-lg text-gilt">
          {fare.sats.toLocaleString()}
          <span className="ml-1 text-xs text-mist">sats</span>
        </div>
      </div>
    </div>
  );
}

function OnChainRow({
  seq,
  status,
}: {
  seq: bigint | null;
  status: string | null;
}) {
  return (
    <div className="flex items-center justify-between border-t border-white/8 pt-3 font-mono text-[10px] tracking-[0.2em] uppercase">
      <span className="flex items-center gap-2 text-mist">
        <span className="kv-breathe size-1.5 rounded-full bg-gilt" />
        On-chain · ICP
      </span>
      <span className="text-mist">
        {seq != null ? `ride ${seq.toString()}` : "…"}
        {status ? ` · ${status}` : ""}
      </span>
    </div>
  );
}

function DriverChip() {
  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 px-2.5 py-1">
      <Car className="size-3 text-gilt" />
      <span className="font-mono text-[10px] tracking-[0.15em] text-bone/80">
        {brand.driverId}
      </span>
    </div>
  );
}

function BoneButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-xl bg-bone px-4 py-3.5 text-sm font-medium text-[#0a0a0b] transition hover:bg-white"
    >
      {children}
    </button>
  );
}

function GiltButton({
  onClick,
  loading,
  children,
}: {
  onClick: () => void;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full rounded-xl bg-gradient-to-b from-[#d8b565] to-[#b48d3a] px-4 py-3.5 text-sm font-medium text-[#0a0a0b] shadow-[0_10px_28px_-10px_rgba(198,163,83,0.55),inset_0_1px_0_rgba(255,255,255,0.35)] transition hover:brightness-105 disabled:opacity-70"
    >
      {children}
    </button>
  );
}

function EclipseMark() {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 28 28"
      aria-hidden
      style={{ filter: "drop-shadow(0 0 9px rgba(198,163,83,0.45))" }}
    >
      <defs>
        <mask id="kv-eclipse">
          <rect width="28" height="28" fill="#fff" />
          <circle cx="19" cy="11.5" r="10.5" fill="#000" />
        </mask>
      </defs>
      <circle
        cx="14"
        cy="14"
        r="12"
        fill="var(--gilt)"
        mask="url(#kv-eclipse)"
      />
    </svg>
  );
}
