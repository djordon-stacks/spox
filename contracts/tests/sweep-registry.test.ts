import { Cl } from "@stacks/transactions";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ERR_ALREADY_REGISTERED,
  ERR_ALREADY_SWEPT,
  ERR_INSUFFICIENT_FEE,
  ERR_NO_CURRENT_POSITION,
  ERR_NOT_ADMIN,
  ERR_NOT_REGISTERED,
  ERR_UNKNOWN_PENDING_WITHDRAWAL,
  ERR_ZERO_FEE,
  FEE_PER_SWEEP,
  SIGNER_MANAGER,
  acceptWithdrawal,
  deployer,
  fundAndClaimSignerRewards,
  getDueSettlements,
  getDueSweeps,
  initPox5,
  performSweep,
  registerForSweep,
  registerSignerManager,
  rejectWithdrawal,
  sbtcBalance,
  stakeFor,
  stakeWithPoxAddr,
  stxBalance,
  wallet1,
  wallet2,
  wallet3,
} from "./pox-5-fixtures";

function settlePendingWithdrawal(staker: string, requestId: bigint, sender: string) {
  return simnet.callPublicFn(
    "sweep-registry",
    "settle-pending-withdrawal",
    [Cl.principal(staker), Cl.principal(SIGNER_MANAGER), Cl.uint(requestId)],
    sender,
  );
}

// Integration tests for sweep-registry against the REAL pox-5, signer-manager,
// and sBTC contracts. A staker must have a genuine pox-5 position under the
// signer-manager to be registerable, so registrations here are all real.

function registered(staker: string) {
  return Cl.tuple({
    "signer-manager": Cl.principal(SIGNER_MANAGER),
    staker: Cl.principal(staker),
    "bond-index": Cl.none(),
    "reward-cycle": Cl.uint(1),
  });
}

describe("get-page-size", () => {
  it("returns the pagination cap", () => {
    const { result } = simnet.callReadOnlyFn(
      "sweep-registry",
      "get-page-size",
      [],
      deployer,
    );
    expect(result).toBeUint(100);
  });
});

describe("admin", () => {
  it("deployer starts as admin", () => {
    expect(
      simnet.callReadOnlyFn("sweep-registry", "is-admin", [Cl.principal(deployer)], deployer)
        .result,
    ).toBeBool(true);
  });

  it("admin can grant and revoke other admins", () => {
    expect(
      simnet.callPublicFn(
        "sweep-registry",
        "update-admin",
        [Cl.principal(wallet1), Cl.bool(true)],
        deployer,
      ).result,
    ).toBeOk(Cl.principal(wallet1));
    expect(
      simnet.callReadOnlyFn("sweep-registry", "is-admin", [Cl.principal(wallet1)], deployer)
        .result,
    ).toBeBool(true);

    // the new admin can revoke
    simnet.callPublicFn(
      "sweep-registry",
      "update-admin",
      [Cl.principal(wallet1), Cl.bool(false)],
      wallet1,
    );
    expect(
      simnet.callReadOnlyFn("sweep-registry", "is-admin", [Cl.principal(wallet1)], deployer)
        .result,
    ).toBeBool(false);
  });

  it("non-admin cannot update admins", () => {
    expect(
      simnet.callPublicFn(
        "sweep-registry",
        "update-admin",
        [Cl.principal(wallet2), Cl.bool(true)],
        wallet1,
      ).result,
    ).toBeErr(Cl.uint(ERR_NOT_ADMIN));
  });

  // Documents the self-lockout footgun: the sole admin can remove itself,
  // permanently bricking set-fee-per-sweep and update-admin. If a last-admin
  // guard is added, flip this expectation.
  it("the sole admin CAN lock itself out (no last-admin guard)", () => {
    simnet.callPublicFn(
      "sweep-registry",
      "update-admin",
      [Cl.principal(deployer), Cl.bool(false)],
      deployer,
    );
    expect(
      simnet.callPublicFn("sweep-registry", "set-fee-per-sweep", [Cl.uint(1)], deployer).result,
    ).toBeErr(Cl.uint(ERR_NOT_ADMIN));
  });
});

describe("set-fee-per-sweep", () => {
  it("admin can change the fee", () => {
    expect(
      simnet.callPublicFn("sweep-registry", "set-fee-per-sweep", [Cl.uint(250000)], deployer)
        .result,
    ).toBeOk(Cl.bool(true));
  });
  it("rejects a non-admin", () => {
    expect(
      simnet.callPublicFn("sweep-registry", "set-fee-per-sweep", [Cl.uint(250000)], wallet1)
        .result,
    ).toBeErr(Cl.uint(ERR_NOT_ADMIN));
  });
  it("rejects a zero fee", () => {
    expect(
      simnet.callPublicFn("sweep-registry", "set-fee-per-sweep", [Cl.uint(0)], deployer).result,
    ).toBeErr(Cl.uint(ERR_ZERO_FEE));
  });
});

describe("register-for-sweep", () => {
  beforeEach(() => {
    initPox5();
    registerSignerManager();
    stakeFor(wallet1);
  });

  it("registers a real staking position and returns sweeps bought", () => {
    const { result } = registerForSweep(wallet1, 3n * FEE_PER_SWEEP);
    expect(result).toBeOk(Cl.uint(3));
  });

  it("burns exactly the used portion of the fee", () => {
    const before = stxBalance(wallet1);
    // 3.5 sweeps' worth -> only 3 whole sweeps bought and burned
    registerForSweep(wallet1, 3n * FEE_PER_SWEEP + FEE_PER_SWEEP / 2n);
    expect(before - stxBalance(wallet1)).toBe(3n * FEE_PER_SWEEP);
  });

  it("caps sweeps bought at MAX_SWEEP_DISTRIBUTION_CYCLES (192)", () => {
    // pay for 500 sweeps; only 192 are bought/burned
    const before = stxBalance(wallet1);
    const { result } = registerForSweep(wallet1, 500n * FEE_PER_SWEEP);
    expect(result).toBeOk(Cl.uint(192));
    expect(before - stxBalance(wallet1)).toBe(192n * FEE_PER_SWEEP);
  });

  it("rejects a fee too small to buy a single sweep", () => {
    expect(registerForSweep(wallet1, FEE_PER_SWEEP - 1n).result).toBeErr(
      Cl.uint(ERR_INSUFFICIENT_FEE),
    );
  });

  it("rejects a staker with no pox-5 position", () => {
    // wallet3 never staked
    expect(registerForSweep(wallet3, FEE_PER_SWEEP).result).toBeErr(
      Cl.uint(ERR_NO_CURRENT_POSITION),
    );
  });

  it("rejects a duplicate registration", () => {
    registerForSweep(wallet1, FEE_PER_SWEEP);
    expect(registerForSweep(wallet1, FEE_PER_SWEEP).result).toBeErr(
      Cl.uint(ERR_ALREADY_REGISTERED),
    );
  });

  it("is permissionless: a third party can register and pay for a staker", () => {
    const before = stxBalance(wallet2);
    const { result } = registerForSweep(wallet1, FEE_PER_SWEEP, wallet2);
    expect(result).toBeOk(Cl.uint(1));
    expect(before - stxBalance(wallet2)).toBe(FEE_PER_SWEEP); // payer is wallet2
  });
});

describe("get-due-sweeps", () => {
  beforeEach(() => {
    initPox5();
    registerSignerManager();
    stakeFor(wallet1);
  });

  it("is empty when nothing is registered", () => {
    expect(getDueSweeps()).toBeOk(Cl.list([]));
  });

  it("lists a fresh registration as due", () => {
    registerForSweep(wallet1, FEE_PER_SWEEP);
    expect(getDueSweeps()).toBeOk(Cl.list([registered(wallet1)]));
  });

  it("walks multiple registrations", () => {
    stakeFor(wallet2);
    registerForSweep(wallet1, FEE_PER_SWEEP);
    registerForSweep(wallet2, FEE_PER_SWEEP);
    const { value: rows } = getDueSweeps() as unknown as { value: { value: unknown[] } };
    expect(rows.value.length).toBe(2);
  });
});

describe("perform-sweep (direct sBTC payout)", () => {
  beforeEach(() => {
    initPox5();
    registerSignerManager();
    stakeFor(wallet1);
  });

  it("sweeps a claimable staker, pays sBTC, and clears it from the due list", () => {
    fundAndClaimSignerRewards(2000n);
    registerForSweep(wallet1, 3n * FEE_PER_SWEEP);

    const before = sbtcBalance(wallet1);
    const { result } = performSweep(wallet1, wallet2); // permissionless caller
    // no pox-addr -> direct payout -> no withdrawal request
    expect(result).toBeOk(Cl.none());
    expect(sbtcBalance(wallet1)).toBeGreaterThan(before);

    // swept this distribution cycle -> no longer due
    expect(getDueSweeps()).toBeOk(Cl.list([]));
  });

  it("advances past a genuinely empty cycle without stalling", () => {
    // registered, but no rewards were ever funded/claimed:
    // claim errs u1001 AND get-earned == 0 -> advance, returns (ok none)
    registerForSweep(wallet1, 3n * FEE_PER_SWEEP);
    const { result } = performSweep(wallet1);
    expect(result).toBeOk(Cl.none());
    // consumed a sweep for this cycle -> not due again this cycle
    expect(getDueSweeps()).toBeOk(Cl.list([]));
  });

  it("errors for a staker with no registration", () => {
    expect(performSweep(wallet1).result).toBeErr(Cl.uint(ERR_NOT_REGISTERED));
  });

  it("errors when already swept this distribution cycle", () => {
    registerForSweep(wallet1, 3n * FEE_PER_SWEEP);
    performSweep(wallet1); // empty-cycle advance, marks swept
    expect(performSweep(wallet1).result).toBeErr(Cl.uint(ERR_ALREADY_SWEPT));
  });
});

describe("perform-sweeps (batch)", () => {
  beforeEach(() => {
    initPox5();
    registerSignerManager();
    stakeFor(wallet1);
    stakeFor(wallet2);
  });

  it("sweeps multiple stakers and returns the count", () => {
    fundAndClaimSignerRewards(2000n);
    registerForSweep(wallet1, FEE_PER_SWEEP);
    registerForSweep(wallet2, FEE_PER_SWEEP);
    const { result } = simnet.callPublicFn(
      "sweep-registry",
      "perform-sweeps",
      [Cl.principal(SIGNER_MANAGER), Cl.list([Cl.principal(wallet1), Cl.principal(wallet2)])],
      wallet3,
    );
    expect(result).toBeOk(Cl.uint(2));
  });

  it("skips unregistered stakers without aborting the batch", () => {
    registerForSweep(wallet1, FEE_PER_SWEEP);
    const { result } = simnet.callPublicFn(
      "sweep-registry",
      "perform-sweeps",
      // wallet2 is staked but NOT registered -> skipped
      [Cl.principal(SIGNER_MANAGER), Cl.list([Cl.principal(wallet1), Cl.principal(wallet2)])],
      wallet3,
    );
    expect(result).toBeOk(Cl.uint(1));
  });
});

describe("update-registration", () => {
  it("carries sweeps to a new signer-manager the caller now stakes under", () => {
    // Only one real signer-manager is deployed, so we can at least prove the
    // old registration is required and the carry path validates the new signer.
    initPox5();
    registerSignerManager();
    stakeFor(wallet1);
    registerForSweep(wallet1, 3n * FEE_PER_SWEEP);
    // moving to a signer-manager the staker has no position under fails on the
    // create side (ERR_NO_CURRENT_POSITION), after destroying nothing (atomic).
    const { result } = simnet.callPublicFn(
      "sweep-registry",
      "update-registration",
      [Cl.principal(SIGNER_MANAGER), Cl.principal(wallet2), Cl.none()],
      wallet1,
    );
    expect(result).toBeErr(Cl.uint(ERR_NO_CURRENT_POSITION));
    // original registration still intact
    expect(getDueSweeps()).toBeOk(Cl.list([registered(wallet1)]));
  });
});

describe("L1 withdrawal path + settlements", () => {
  beforeEach(() => {
    initPox5();
    registerSignerManager();
    stakeWithPoxAddr(wallet1); // pox-addr present -> rewards route to L1
    fundAndClaimSignerRewards(2000n);
    registerForSweep(wallet1, 3n * FEE_PER_SWEEP);
  });

  it("records a withdrawal request-id and lists it as a due settlement", () => {
    const { result } = performSweep(wallet1);
    // pox-addr present -> the first L1 withdrawal request-id (1) is returned
    expect(result).toBeOk(Cl.some(Cl.uint(1)));

    const settlements = getDueSettlements() as unknown as {
      value: { value: unknown[] };
    };
    expect(settlements.value.value.length).toBe(1);
  });

  it("settles an ACCEPTED withdrawal and clears it from the settlement list", () => {
    performSweep(wallet1);
    // sBTC signers accept request 1, then anyone settles it
    acceptWithdrawal(1n);
    const { result } = settlePendingWithdrawal(wallet1, 1n, wallet2);
    expect(result).toBeOk(Cl.bool(true));
    expect(getDueSettlements()).toBeOk(Cl.list([]));
  });

  it("settles a REJECTED withdrawal (reclaims to the staker) and clears it", () => {
    performSweep(wallet1);
    rejectWithdrawal(1n);
    const { result } = settlePendingWithdrawal(wallet1, 1n, wallet2);
    expect(result).toBeOk(Cl.bool(true));
    expect(getDueSettlements()).toBeOk(Cl.list([]));
  });

  it("is a no-op while the withdrawal is still pending", () => {
    performSweep(wallet1);
    // status not set -> still pending -> ok false, stays listed
    expect(settlePendingWithdrawal(wallet1, 1n, wallet2).result).toBeOk(Cl.bool(false));
    const settlements = getDueSettlements() as unknown as { value: { value: unknown[] } };
    expect(settlements.value.value.length).toBe(1);
  });

  it("errors on an unknown pending withdrawal", () => {
    performSweep(wallet1);
    expect(settlePendingWithdrawal(wallet1, 9999n, wallet2).result).toBeErr(
      Cl.uint(ERR_UNKNOWN_PENDING_WITHDRAWAL),
    );
  });

  it("batch settle-pending-withdrawals resolves accepted items and counts them", () => {
    performSweep(wallet1);
    acceptWithdrawal(1n);
    const { result } = simnet.callPublicFn(
      "sweep-registry",
      "settle-pending-withdrawals",
      [
        Cl.principal(SIGNER_MANAGER),
        Cl.list([
          Cl.tuple({ staker: Cl.principal(wallet1), "request-id": Cl.uint(1) }),
          // an unknown item is skipped, not fatal
          Cl.tuple({ staker: Cl.principal(wallet1), "request-id": Cl.uint(9999) }),
        ]),
      ],
      wallet2,
    );
    expect(result).toBeOk(Cl.uint(1));
    expect(getDueSettlements()).toBeOk(Cl.list([]));
  });
});
