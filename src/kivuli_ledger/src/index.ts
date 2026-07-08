import { IDL, query, update, msgCaller, Principal } from "azle";

// A minimal ICRC-1 ledger standing in for the ckTESTBTC ledger, so Kivuli can
// settle fares with a real on-chain token transfer entirely on the local
// replica. Balances are keyed by owner principal (default subaccount only).

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

type AccountT = { owner: Principal; subaccount: [] | [Uint8Array | number[]] };
type TransferArgsT = {
  to: AccountT;
  fee: [] | [bigint];
  memo: [] | [Uint8Array | number[]];
  from_subaccount: [] | [Uint8Array | number[]];
  created_at_time: [] | [bigint];
  amount: bigint;
};
type TransferResultT = { Ok: bigint } | { Err: unknown };

const FEE = 10n;

export default class {
  balances: Map<string, bigint> = new Map();
  block: bigint = 0n;

  @query([], IDL.Text)
  icrc1_name(): string {
    return "Chain-key Testnet Bitcoin";
  }

  @query([], IDL.Text)
  icrc1_symbol(): string {
    return "ckTESTBTC";
  }

  @query([], IDL.Nat8)
  icrc1_decimals(): number {
    return 8;
  }

  @query([], IDL.Nat)
  icrc1_fee(): bigint {
    return FEE;
  }

  @query([], IDL.Nat)
  icrc1_total_supply(): bigint {
    let sum = 0n;
    for (const v of this.balances.values()) sum += v;
    return sum;
  }

  @query([Account], IDL.Nat)
  icrc1_balance_of(account: AccountT): bigint {
    return this.balances.get(account.owner.toText()) ?? 0n;
  }

  // Demo faucet: mint tokens to an account (no auth — testnet-style).
  @update([IDL.Principal, IDL.Nat], IDL.Nat)
  faucet(owner: Principal, amount: bigint): bigint {
    const key = owner.toText();
    this.balances.set(key, (this.balances.get(key) ?? 0n) + amount);
    this.block += 1n;
    return this.block;
  }

  @update([TransferArgs], TransferResult)
  icrc1_transfer(args: TransferArgsT): TransferResultT {
    const from = msgCaller().toText();
    const fee = args.fee.length ? args.fee[0] : FEE;
    const total = args.amount + fee;
    const bal = this.balances.get(from) ?? 0n;
    if (bal < total) {
      return { Err: { InsufficientFunds: { balance: bal } } };
    }
    this.balances.set(from, bal - total);
    const toKey = args.to.owner.toText();
    this.balances.set(toKey, (this.balances.get(toKey) ?? 0n) + args.amount);
    this.block += 1n;
    return { Ok: this.block };
  }
}
