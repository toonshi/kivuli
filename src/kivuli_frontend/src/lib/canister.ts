import { Actor, HttpAgent } from "@dfinity/agent";

// Injected at build time by vite.config.ts (from the dfx-generated .env).
declare const __KIVULI_BACKEND_ID__: string;
declare const __DFX_NETWORK__: string;

export type Coord = { lat: number; lng: number };

export type Ride = {
  id: string;
  pickup: Coord;
  dropoff: Coord;
  driverId: string;
  driverLat: number;
  driverLng: number;
  hasDriver: boolean;
  status: string;
  fareE8s: bigint;
  seq: bigint;
};

const idlFactory = ({
  IDL,
}: {
  IDL: typeof import("@dfinity/candid").IDL;
}) => {
  const Coord = IDL.Record({ lat: IDL.Float64, lng: IDL.Float64 });
  const Ride = IDL.Record({
    id: IDL.Text,
    pickup: Coord,
    dropoff: Coord,
    driverId: IDL.Text,
    driverLat: IDL.Float64,
    driverLng: IDL.Float64,
    hasDriver: IDL.Bool,
    status: IDL.Text,
    fareE8s: IDL.Nat,
    seq: IDL.Nat,
  });
  return IDL.Service({
    requestRide: IDL.Func([Coord, Coord, IDL.Nat], [IDL.Text], []),
    acceptRide: IDL.Func(
      [IDL.Text, IDL.Text, IDL.Float64, IDL.Float64],
      [IDL.Bool],
      [],
    ),
    updateDriver: IDL.Func(
      [IDL.Text, IDL.Float64, IDL.Float64, IDL.Text],
      [IDL.Bool],
      [],
    ),
    completeRide: IDL.Func([IDL.Text], [IDL.Bool], []),
    getRide: IDL.Func([IDL.Text], [IDL.Opt(Ride)], ["query"]),
    listRides: IDL.Func([], [IDL.Vec(Ride)], ["query"]),
    payRide: IDL.Func([IDL.Text], [IDL.Nat], []),
  });
};

type Backend = {
  requestRide: (p: Coord, d: Coord, fare: bigint) => Promise<string>;
  acceptRide: (
    id: string,
    driverId: string,
    lat: number,
    lng: number,
  ) => Promise<boolean>;
  updateDriver: (
    id: string,
    lat: number,
    lng: number,
    status: string,
  ) => Promise<boolean>;
  completeRide: (id: string) => Promise<boolean>;
  getRide: (id: string) => Promise<[] | [Ride]>;
  listRides: () => Promise<Ride[]>;
  payRide: (id: string) => Promise<bigint>;
};

let actorPromise: Promise<Backend> | null = null;

async function getActor(): Promise<Backend> {
  if (!actorPromise) {
    actorPromise = (async () => {
      const host =
        __DFX_NETWORK__ === "ic"
          ? "https://icp-api.io"
          : "http://127.0.0.1:4943";
      const agent = await HttpAgent.create({ host });
      if (__DFX_NETWORK__ !== "ic") {
        await agent.fetchRootKey();
      }
      return Actor.createActor<Backend>(idlFactory, {
        agent,
        canisterId: __KIVULI_BACKEND_ID__,
      });
    })();
  }
  return actorPromise;
}

export async function requestRide(
  pickup: Coord,
  dropoff: Coord,
  fareSats: number,
): Promise<string> {
  return (await getActor()).requestRide(pickup, dropoff, BigInt(fareSats));
}

export async function getRide(id: string): Promise<Ride | null> {
  const res = await (await getActor()).getRide(id);
  return res.length ? res[0] : null;
}

export async function acceptRide(
  id: string,
  driverId: string,
  lat: number,
  lng: number,
): Promise<boolean> {
  return (await getActor()).acceptRide(id, driverId, lat, lng);
}

export async function updateDriver(
  id: string,
  lat: number,
  lng: number,
  status: string,
): Promise<boolean> {
  return (await getActor()).updateDriver(id, lat, lng, status);
}

export async function completeRide(id: string): Promise<boolean> {
  return (await getActor()).completeRide(id);
}

export async function payRide(id: string): Promise<bigint> {
  return (await getActor()).payRide(id);
}
