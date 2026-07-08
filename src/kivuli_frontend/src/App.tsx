import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Car, Loader2, MapPin, ShieldCheck, Zap } from "lucide-react";
import {
  Map,
  MapMarker,
  MarkerContent,
  MarkerLabel,
  MapRoute,
  MapControls,
} from "@/components/map";
import { brand } from "@/lib/brand";
import { estimateFare, type Coord, type Fare } from "@/lib/fare";
import * as canister from "@/lib/canister";
import { cn } from "@/lib/utils";

type Phase = "idle" | "requesting" | "enroute" | "intrip" | "completed";
type Destination = { name: string; coord: Coord };

const DESTINATIONS: Destination[] = [
  { name: "CBD", coord: { lat: -1.2864, lng: 36.8172 } },
  { name: "Kilimani", coord: { lat: -1.2906, lng: 36.787 } },
  { name: "Karen", coord: { lat: -1.3197, lng: 36.7076 } },
  { name: "JKIA", coord: { lat: -1.3192, lng: 36.9278 } },
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export default function App() {
  const [pickup, setPickup] = useState<Coord>(brand.defaultCenter);
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

  const rafRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  const fare: Fare | null = useMemo(
    () => (dropoff ? estimateFare(pickup, dropoff) : null),
    [pickup, dropoff],
  );

  // Poll on-chain ride state while a ride is live — proves it's really on-chain.
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

  const animateSegment = useCallback(
    (from: Coord, to: Coord, ms: number, onTick: (c: Coord) => void) =>
      new Promise<void>((resolve) => {
        const start = performance.now();
        const step = (now: number) => {
          if (cancelledRef.current) return resolve();
          const t = Math.min(1, (now - start) / ms);
          onTick({
            lat: lerp(from.lat, to.lat, t),
            lng: lerp(from.lng, to.lng, t),
          });
          if (t < 1) rafRef.current = requestAnimationFrame(step);
          else resolve();
        };
        rafRef.current = requestAnimationFrame(step);
      }),
    [],
  );

  const selectDestination = (d: Destination) => {
    if (phase !== "idle") return;
    setDestName(d.name);
    setDropoff(d.coord);
  };

  const handleRequest = async () => {
    if (!dropoff || !fare) return;
    cancelledRef.current = false;
    setPhase("requesting");
    try {
      const id = await canister.requestRide(pickup, dropoff, fare.sats);
      setRideId(id);

      // A nearby driver accepts.
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
      setDriver(driverStart);
      setPhase("enroute");

      // Drive to the rider.
      await animateSegment(driverStart, pickup, 6500, setDriver);
      if (cancelledRef.current) return;
      await canister.updateDriver(id, pickup.lat, pickup.lng, "intrip");
      setPhase("intrip");

      // Drive the rider to the destination.
      await animateSegment(pickup, dropoff, 9000, setDriver);
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
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background">
      <Map
        theme="dark"
        center={brand.mapCenter}
        zoom={brand.mapZoom}
        className="absolute inset-0"
      >
        {dropoff && (
          <>
            <MapRoute
              id="trip-glow"
              coordinates={[
                [pickup.lng, pickup.lat],
                [dropoff.lng, dropoff.lat],
              ]}
              color="#e6b450"
              width={11}
              opacity={0.14}
            />
            <MapRoute
              id="trip-line"
              coordinates={[
                [pickup.lng, pickup.lat],
                [dropoff.lng, dropoff.lat],
              ]}
              color="#f0c463"
              width={2.5}
              opacity={0.95}
            />
          </>
        )}

        <MapMarker longitude={pickup.lng} latitude={pickup.lat}>
          <MarkerContent>
            <div className="relative flex size-3 items-center justify-center">
              <span className="kv-ping absolute inset-0 rounded-full bg-emerald-400" />
              <span className="relative size-3 rounded-full bg-emerald-400 ring-4 ring-emerald-400/20" />
            </div>
            <MarkerLabel className="text-emerald-300">Pickup</MarkerLabel>
          </MarkerContent>
        </MapMarker>

        {dropoff && (
          <MapMarker longitude={dropoff.lng} latitude={dropoff.lat}>
            <MarkerContent>
              <MapPin
                className="size-6 fill-[var(--brand)] text-black"
                strokeWidth={1.5}
              />
              <MarkerLabel className="text-[var(--brand)]">
                {destName}
              </MarkerLabel>
            </MarkerContent>
          </MapMarker>
        )}

        {driver && (
          <MapMarker longitude={driver.lng} latitude={driver.lat}>
            <MarkerContent>
              <div className="relative flex size-8 items-center justify-center rounded-full bg-[var(--brand)] text-black shadow-lg shadow-black/50">
                <span className="kv-ping absolute inset-0 rounded-full bg-[var(--brand)]" />
                <Car className="relative size-4" />
              </div>
            </MarkerContent>
          </MapMarker>
        )}

        <MapControls
          showLocate
          onLocate={(c) =>
            phase === "idle" && setPickup({ lat: c.latitude, lng: c.longitude })
          }
        />
      </Map>

      <div
        className="pointer-events-none absolute inset-0 z-[5]"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 18%, transparent 52%, rgba(0,0,0,0.62) 100%)",
        }}
      />

      <div className="pointer-events-none absolute top-5 left-5 z-10 flex select-none items-center gap-3">
        <EclipseMark />
        <div>
          <div className="kv-wordmark text-2xl leading-none font-semibold tracking-[0.28em] text-foreground [text-shadow:0_0_22px_rgba(230,180,80,0.28)]">
            {brand.name.toUpperCase()}
          </div>
          <div className="mt-1 text-[10px] tracking-[0.22em] text-muted-foreground">
            {brand.tagline.toUpperCase()}
          </div>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-10 p-4 sm:inset-x-auto sm:bottom-6 sm:left-6 sm:w-[360px] sm:p-0">
        <div className="kv-up rounded-2xl border border-border bg-popover/80 p-4 shadow-2xl shadow-black/60 ring-1 ring-white/5 backdrop-blur-xl">
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
      <div className="space-y-3">
        <div>
          <div className="text-sm font-medium text-foreground">Where to?</div>
          <div className="text-xs text-muted-foreground">
            Pickup: Westlands · settle in Bitcoin
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {DESTINATIONS.map((d) => (
            <button
              key={d.name}
              onClick={() => onSelect(d)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm transition",
                destName === d.name
                  ? "border-[var(--brand)] bg-[color:var(--brand)]/15 text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {d.name}
            </button>
          ))}
        </div>
        {fare && <FareRow fare={fare} />}
        <button
          disabled={!dropoff}
          onClick={onRequest}
          className="w-full rounded-xl bg-[var(--brand)] px-4 py-3 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-40"
        >
          {dropoff ? `Request ride to ${destName}` : "Choose a destination"}
        </button>
      </div>
    );
  }

  if (phase === "requesting") {
    return (
      <Status
        icon={<Loader2 className="size-4 animate-spin" />}
        title="Summoning a driver"
        sub="Broadcasting your request on-chain…"
      />
    );
  }

  if (phase === "enroute" || phase === "intrip") {
    const isTrip = phase === "intrip";
    return (
      <div className="space-y-3">
        <Status
          icon={isTrip ? <Zap className="size-4" /> : <Car className="size-4" />}
          title={
            isTrip ? `En route to ${destName}` : `${brand.driverId} is approaching`
          }
          sub={isTrip ? "Enjoy the ride" : "Your driver is on the way"}
        />
        <OnChainBadge seq={seq} status={chainStatus} />
        {fare && <FareRow fare={fare} />}
      </div>
    );
  }

  // completed
  return (
    <div className="space-y-3">
      <Status
        icon={<ShieldCheck className="size-4 text-emerald-400" />}
        title="You've arrived"
        sub={`Trip to ${destName} complete`}
      />
      <OnChainBadge seq={seq} status={chainStatus} />
      {!paid ? (
        <button
          onClick={onPay}
          disabled={paying}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-3 text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-60"
        >
          {paying ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Settling on-chain…
            </>
          ) : (
            <>Pay ₿ {fare?.sats.toLocaleString()} sats · ckBTC</>
          )}
        </button>
      ) : (
        <div className="space-y-2">
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-center text-sm font-medium text-emerald-300">
            Paid {fare?.sats.toLocaleString()} sats · ckBTC ✓
            {payBlock != null && (
              <div className="mt-0.5 font-mono text-[11px] text-emerald-400/80">
                ledger block #{payBlock.toString()}
              </div>
            )}
          </div>
          <button
            onClick={onReset}
            className="w-full rounded-xl border border-border px-4 py-2.5 text-sm text-muted-foreground transition hover:text-foreground"
          >
            New ride
          </button>
        </div>
      )}
    </div>
  );
}

function FareRow({ fare }: { fare: Fare }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-background/40 px-3 py-2 text-sm">
      <span className="text-muted-foreground">{fare.km.toFixed(1)} km</span>
      <span className="font-medium text-foreground">
        ≈ KES {fare.kes.toLocaleString()}
      </span>
      <span className="font-mono text-[var(--brand)]">
        ₿ {fare.sats.toLocaleString()}
      </span>
    </div>
  );
}

function Status({
  icon,
  title,
  sub,
}: {
  icon: React.ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-9 items-center justify-center rounded-full bg-muted text-foreground">
        {icon}
      </div>
      <div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </div>
    </div>
  );
}

function OnChainBadge({
  seq,
  status,
}: {
  seq: bigint | null;
  status: string | null;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-1.5 text-[11px]">
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
        on-chain · ICP
      </span>
      <span className="font-mono text-muted-foreground">
        {seq != null ? `ride #${seq.toString()}` : "…"}
        {status ? ` · ${status}` : ""}
      </span>
    </div>
  );
}

function EclipseMark() {
  return (
    <svg
      width="30"
      height="30"
      viewBox="0 0 28 28"
      aria-hidden
      style={{ filter: "drop-shadow(0 0 8px rgba(230,180,80,0.4))" }}
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
        fill="var(--brand)"
        mask="url(#kv-eclipse)"
      />
    </svg>
  );
}
