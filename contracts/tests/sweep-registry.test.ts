import { Cl } from "@stacks/transactions";
import { beforeEach, describe, expect, it } from "vitest";

// Smoke tests for the sweep-registry. They lean on the in-project mocks
// (pox-5, sbtc-registry, mock-signer-manager) to drive the registry's paths
// without a real signer-manager / pox-5. Deeper behavioral coverage
// (pagination, multi-staker batches, empty-cycle advance) is left for later.

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = accounts.get("wallet_1")!;
const wallet2 = accounts.get("wallet_2")!;

// The signer-manager the registry keys against is the mock contract.
const signerManager = `${deployer}.mock-signer-manager`;

const FEE_PER_SWEEP = 100000n; // contract default

// error codes (see sweep-registry.clar)
const ERR_ALREADY_REGISTERED = 601n;
const ERR_INSUFFICIENT_FEE = 602n;
const ERR_NOT_ADMIN = 603n;
const ERR_NO_CURRENT_POSITION = 605n;
const ERR_ZERO_FEE = 606n;

// Give `staker` an STX-only pox-5 position under the mock signer-manager,
// starting at reward cycle `firstRewardCycle`, and set the current cycles.
function seedStxPosition(
  staker: string,
  firstRewardCycle: number,
  rewardCycle: number,
  distCycle: number,
) {
  simnet.callPublicFn("pox-5", "set-reward-cycle", [Cl.uint(rewardCycle)], deployer);
  simnet.callPublicFn("pox-5", "set-distribution-cycle", [Cl.uint(distCycle)], deployer);
  simnet.callPublicFn(
    "pox-5",
    "set-staker-info",
    [Cl.principal(staker), Cl.principal(signerManager), Cl.uint(firstRewardCycle)],
    deployer,
  );
}

function register(staker: string, fee: bigint, sender: string) {
  return simnet.callPublicFn(
    "sweep-registry",
    "register-for-sweep",
    [Cl.principal(staker), Cl.principal(signerManager), Cl.none(), Cl.uint(fee)],
    sender,
  );
}

function stxBalance(who: string): bigint {
  return simnet.getAssetsMap().get("STX")!.get(who)!;
}

describe("set-fee-per-sweep", () => {
  it("lets the admin (deployer) change the fee", () => {
    const { result } = simnet.callPublicFn(
      "sweep-registry",
      "set-fee-per-sweep",
      [Cl.uint(250000)],
      deployer,
    );
    expect(result).toBeOk(Cl.bool(true));
  });

  it("rejects a non-admin", () => {
    const { result } = simnet.callPublicFn(
      "sweep-registry",
      "set-fee-per-sweep",
      [Cl.uint(250000)],
      wallet1,
    );
    expect(result).toBeErr(Cl.uint(ERR_NOT_ADMIN));
  });

  it("rejects a zero fee", () => {
    const { result } = simnet.callPublicFn(
      "sweep-registry",
      "set-fee-per-sweep",
      [Cl.uint(0)],
      deployer,
    );
    expect(result).toBeErr(Cl.uint(ERR_ZERO_FEE));
  });
});

describe("register-for-sweep", () => {
  beforeEach(() => {
    seedStxPosition(wallet1, 5, 5, 10);
  });

  it("registers a staking position and returns the sweeps bought", () => {
    // 3 * fee-per-sweep buys exactly 3 sweeps
    const { result } = register(wallet1, 3n * FEE_PER_SWEEP, wallet1);
    expect(result).toBeOk(Cl.uint(3));
  });

  it("burns exactly the used portion of the fee", () => {
    const before = stxBalance(wallet1);
    // 3.5 sweeps' worth: only 3 whole sweeps are bought and burned
    register(wallet1, 3n * FEE_PER_SWEEP + FEE_PER_SWEEP / 2n, wallet1);
    const after = stxBalance(wallet1);
    expect(before - after).toBe(3n * FEE_PER_SWEEP);
  });

  it("rejects a fee too small to buy a single sweep", () => {
    const { result } = register(wallet1, FEE_PER_SWEEP - 1n, wallet1);
    expect(result).toBeErr(Cl.uint(ERR_INSUFFICIENT_FEE));
  });

  it("rejects a staker with no current pox-5 position", () => {
    // wallet2 has no staker-info seeded
    const { result } = register(wallet2, FEE_PER_SWEEP, wallet1);
    expect(result).toBeErr(Cl.uint(ERR_NO_CURRENT_POSITION));
  });

  it("rejects a duplicate registration for the same staker + signer-manager", () => {
    register(wallet1, FEE_PER_SWEEP, wallet1);
    const { result } = register(wallet1, FEE_PER_SWEEP, wallet1);
    expect(result).toBeErr(Cl.uint(ERR_ALREADY_REGISTERED));
  });
});

describe("get-due-sweeps", () => {
  beforeEach(() => {
    seedStxPosition(wallet1, 5, 5, 10);
  });

  it("lists a fresh registration as due", () => {
    register(wallet1, FEE_PER_SWEEP, wallet1);
    const { result } = simnet.callReadOnlyFn(
      "sweep-registry",
      "get-due-sweeps",
      [Cl.none()],
      wallet1,
    );
    expect(result).toBeOk(
      Cl.list([
        Cl.tuple({
          "signer-manager": Cl.principal(signerManager),
          staker: Cl.principal(wallet1),
          "bond-index": Cl.none(),
          "reward-cycle": Cl.uint(5),
        }),
      ]),
    );
  });

  it("is empty when nothing is registered", () => {
    const { result } = simnet.callReadOnlyFn(
      "sweep-registry",
      "get-due-sweeps",
      [Cl.none()],
      wallet1,
    );
    expect(result).toBeOk(Cl.list([]));
  });
});

describe("perform-sweep", () => {
  beforeEach(() => {
    seedStxPosition(wallet1, 5, 5, 10);
    register(wallet1, 3n * FEE_PER_SWEEP, wallet1);
  });

  it("sweeps a direct sBTC payout (no withdrawal) and clears it from the due list", () => {
    // mock signer-manager pays directly: ok, no withdrawal request-id
    simnet.callPublicFn(
      "mock-signer-manager",
      "set-claim-result",
      [Cl.bool(false), Cl.uint(0), Cl.uint(1000), Cl.none()],
      deployer,
    );

    const { result } = simnet.callPublicFn(
      "sweep-registry",
      "perform-sweep",
      [Cl.principal(wallet1), Cl.principal(signerManager)],
      wallet2, // permissionless: anyone can trigger
    );
    expect(result).toBeOk(Cl.none());

    // already swept this distribution cycle -> no longer due
    const { result: due } = simnet.callReadOnlyFn(
      "sweep-registry",
      "get-due-sweeps",
      [Cl.none()],
      wallet1,
    );
    expect(due).toBeOk(Cl.list([]));
  });

  it("records an L1 withdrawal request-id for later settlement", () => {
    // mock signer-manager routes to L1: ok with withdrawal request-id 7
    simnet.callPublicFn(
      "mock-signer-manager",
      "set-claim-result",
      [Cl.bool(false), Cl.uint(0), Cl.uint(1000), Cl.some(Cl.uint(7))],
      deployer,
    );

    const { result } = simnet.callPublicFn(
      "sweep-registry",
      "perform-sweep",
      [Cl.principal(wallet1), Cl.principal(signerManager)],
      wallet2,
    );
    expect(result).toBeOk(Cl.some(Cl.uint(7)));

    const { result: settlements } = simnet.callReadOnlyFn(
      "sweep-registry",
      "get-due-settlements",
      [Cl.none()],
      wallet1,
    );
    expect(settlements).toBeOk(
      Cl.list([
        Cl.tuple({
          staker: Cl.principal(wallet1),
          "signer-manager": Cl.principal(signerManager),
          "request-ids": Cl.list([Cl.uint(7)]),
        }),
      ]),
    );
  });
});

describe("settle-pending-withdrawal", () => {
  beforeEach(() => {
    seedStxPosition(wallet1, 5, 5, 10);
    register(wallet1, 3n * FEE_PER_SWEEP, wallet1);
    // sweep once, producing pending withdrawal request-id 7
    simnet.callPublicFn(
      "mock-signer-manager",
      "set-claim-result",
      [Cl.bool(false), Cl.uint(0), Cl.uint(1000), Cl.some(Cl.uint(7))],
      deployer,
    );
    simnet.callPublicFn(
      "sweep-registry",
      "perform-sweep",
      [Cl.principal(wallet1), Cl.principal(signerManager)],
      wallet2,
    );
  });

  it("resolves an accepted withdrawal and drops it from the settlement list", () => {
    // mark request 7 accepted in the sbtc-registry mock
    simnet.callPublicFn(
      "sbtc-registry",
      "set-withdrawal-request",
      [Cl.uint(7), Cl.some(Cl.bool(true))],
      deployer,
    );

    const { result } = simnet.callPublicFn(
      "sweep-registry",
      "settle-pending-withdrawal",
      [Cl.principal(wallet1), Cl.principal(signerManager), Cl.uint(7)],
      wallet2,
    );
    expect(result).toBeOk(Cl.bool(true));

    const { result: settlements } = simnet.callReadOnlyFn(
      "sweep-registry",
      "get-due-settlements",
      [Cl.none()],
      wallet1,
    );
    expect(settlements).toBeOk(Cl.list([]));
  });

  it("is a no-op while the withdrawal is still pending", () => {
    // status left unset -> get-withdrawal-request returns none -> pending
    simnet.callPublicFn(
      "sbtc-registry",
      "set-withdrawal-request",
      [Cl.uint(7), Cl.none()],
      deployer,
    );

    const { result } = simnet.callPublicFn(
      "sweep-registry",
      "settle-pending-withdrawal",
      [Cl.principal(wallet1), Cl.principal(signerManager), Cl.uint(7)],
      wallet2,
    );
    expect(result).toBeOk(Cl.bool(false));

    // still listed as awaiting settlement
    const { result: settlements } = simnet.callReadOnlyFn(
      "sweep-registry",
      "get-due-settlements",
      [Cl.none()],
      wallet1,
    );
    expect(settlements).toBeOk(
      Cl.list([
        Cl.tuple({
          staker: Cl.principal(wallet1),
          "signer-manager": Cl.principal(signerManager),
          "request-ids": Cl.list([Cl.uint(7)]),
        }),
      ]),
    );
  });
});
