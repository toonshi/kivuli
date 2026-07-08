import { IDL, query, update, call, Principal } from "azle";

// --- Candid types --------------------------------------------------------

const Coord = IDL.Record({
  lat: IDL.Float64,
  lng: IDL.Float64,
});

const Ride = IDL.Record({
  id: IDL.Text,
  pickup: Coord,
  dropoff: Coord,
  driverId: IDL.Text,
  driverLat: IDL.Float64,
  driverLng: IDL.Float64,
  hasDriver: IDL.Bool,
  // status: requested | accepted | enroute | arrived | intrip | completed | paid
  status: IDL.Text,
  fareE8s: IDL.Nat,
  seq: IDL.Nat,
});

// ICRC-1 ledger types, for the inter-canister settlement call.
const Subaccount = IDL.Vec(IDL.Nat8);
const Account = IDL.Record({
  owner: IDL.Principal,
  subaccount: IDL.Opt(Subaccount),
});
const TransferArgs = IDL.Record({
  to: Account,
  fee: IDL.Opt(IDL.Nat),
  memo: IDL.Opt(IDL.Vec(IDL.Nat8)),
  from_subaccount: IDL.Opt(Subaccount),
  created_at_time: IDL.Opt(IDL.Nat64),
  amount: IDL.Nat,
});
const TransferError = IDL.Variant({
  GenericError: IDL.Record({ message: IDL.Text, error_code: IDL.Nat }),
  InsufficientFunds: IDL.Record({ balance: IDL.Nat }),
  BadFee: IDL.Record({ expected_fee: IDL.Nat }),
});
const TransferResult = IDL.Variant({ Ok: IDL.Nat, Err: TransferError });

// --- TS mirrors of the candid records ------------------------------------

type CoordT = { lat: number; lng: number };

type RideT = {
  id: string;
  pickup: CoordT;
  dropoff: CoordT;
  driverId: string;
  driverLat: number;
  driverLng: number;
  hasDriver: boolean;
  status: string;
  fareE8s: bigint;
  seq: bigint;
};

type TransferResultT = { Ok: bigint } | { Err: unknown };

// --- Canister ------------------------------------------------------------
// Ride state lives on-chain. The frontend drives a simulated driver by
// pushing positions here via updateDriver(); riders poll getRide(). Fares
// settle in ckBTC via a real inter-canister transfer (payRide()).

export default class {
  rides: Map<string, RideT> = new Map();
  counter: bigint = 0n;
  ledgerId: string = "";
  driverWallet: string = "";

  @update([Coord, Coord, IDL.Nat], IDL.Text)
  requestRide(pickup: CoordT, dropoff: CoordT, fareE8s: bigint): string {
    this.counter += 1n;
    const id = `ride_${this.counter}`;
    this.rides.set(id, {
      id,
      pickup,
      dropoff,
      driverId: "",
      driverLat: 0,
      driverLng: 0,
      hasDriver: false,
      status: "requested",
      fareE8s,
      seq: this.counter,
    });
    return id;
  }

  @update([IDL.Text, IDL.Text, IDL.Float64, IDL.Float64], IDL.Bool)
  acceptRide(id: string, driverId: string, lat: number, lng: number): boolean {
    const ride = this.rides.get(id);
    if (ride === undefined) return false;
    ride.hasDriver = true;
    ride.driverId = driverId;
    ride.driverLat = lat;
    ride.driverLng = lng;
    ride.status = "accepted";
    return true;
  }

  @update([IDL.Text, IDL.Float64, IDL.Float64, IDL.Text], IDL.Bool)
  updateDriver(id: string, lat: number, lng: number, status: string): boolean {
    const ride = this.rides.get(id);
    if (ride === undefined) return false;
    ride.driverLat = lat;
    ride.driverLng = lng;
    ride.status = status;
    return true;
  }

  @update([IDL.Text], IDL.Bool)
  completeRide(id: string): boolean {
    const ride = this.rides.get(id);
    if (ride === undefined) return false;
    ride.status = "completed";
    return true;
  }

  @query([IDL.Text], IDL.Opt(Ride))
  getRide(id: string): [RideT] | [] {
    const ride = this.rides.get(id);
    return ride === undefined ? [] : [ride];
  }

  @query([], IDL.Vec(Ride))
  listRides(): RideT[] {
    return Array.from(this.rides.values());
  }

  // Point the canister at the ckTESTBTC ledger and the driver's wallet.
  @update([IDL.Text, IDL.Text], IDL.Bool)
  config(ledgerId: string, driverWallet: string): boolean {
    this.ledgerId = ledgerId;
    this.driverWallet = driverWallet;
    return true;
  }

  // Settle the fare in ckBTC via a real inter-canister transfer to the driver.
  // Returns the ledger block index.
  @update([IDL.Text], IDL.Nat)
  async payRide(id: string): Promise<bigint> {
    const ride = this.rides.get(id);
    if (ride === undefined) throw new Error("ride not found");
    if (ride.status === "paid") throw new Error("already paid");
    if (this.ledgerId === "" || this.driverWallet === "") {
      throw new Error("ledger not configured");
    }

    const result = await call<[unknown], TransferResultT>(
      this.ledgerId,
      "icrc1_transfer",
      {
        paramIdlTypes: [TransferArgs],
        returnIdlType: TransferResult,
        args: [
          {
            to: {
              owner: Principal.fromText(this.driverWallet),
              subaccount: [],
            },
            fee: [],
            memo: [],
            from_subaccount: [],
            created_at_time: [],
            amount: ride.fareE8s,
          },
        ],
      },
    );

    if ("Err" in result) {
      throw new Error("ckBTC transfer failed");
    }
    ride.status = "paid";
    return result.Ok;
  }
}
