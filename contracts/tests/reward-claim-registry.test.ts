import { Cl } from "@stacks/transactions";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ERR_ALREADY_CLAIMED,
  ERR_INSUFFICIENT_FEE,
  ERR_NO_CURRENT_POSITION,
  ERR_NOT_ADMIN,
  ERR_NOT_REGISTERED,
  ERR_UNKNOWN_PENDING_WITHDRAWAL,
  ERR_ZERO_FEE,
  FEE_PER_CLAIM,
  MOCK_SIGNER_MANAGER,
  MOCK_SIGNER_PRIVATE_KEY,
  SIGNER_MANAGER,
  SIGNER_PRIVATE_KEY,
  SIGNER_SET_MIN_USTX,
  acceptWithdrawal,
  bondPeriodToRewardCycle,
  currentDistributionCycle,
  deployer,
  fundAndClaimSignerRewards,
  getDueSettlements,
  getDueClaims,
  getRegistration,
  initPox5,
  processRewardClaim,
  registerForBond,
  registerForClaims,
  registerMockSignerManager,
  registerSignerManager,
  rejectWithdrawal,
  sbtcBalance,
  setupBond,
  stakeFor,
  stakeUpdate,
  stakeWithPoxAddr,
  stxBalance,
  wallet1,
  wallet2,
  wallet3,
} from "./pox-5-fixtures";

function settlePendingWithdrawal(staker: string, requestId: bigint, sender: string) {
  return simnet.callPublicFn(
    "reward-claim-registry",
    "settle-pending-withdrawal",
    [Cl.principal(staker), Cl.principal(SIGNER_MANAGER), Cl.uint(requestId)],
    sender,
  );
}

// Integration tests for reward-claim-registry against the REAL pox-5, signer-manager,
// and sBTC contracts. A staker must have a genuine pox-5 position under the
// signer-manager to be registerable, so registrations here are all real.

function registered(staker: string) {
  return Cl.tuple({
    "signer-manager": Cl.principal(SIGNER_MANAGER),
    "staker": Cl.principal(staker),
    "bond-index": Cl.none(),
    "reward-cycle": Cl.uint(1),
  });
}

// A get-due-settlements row: {staker, signer-manager, request-ids}.
function settlement(staker: string, requestIds: bigint[]) {
  return Cl.tuple({
    "staker": Cl.principal(staker),
    "signer-manager": Cl.principal(SIGNER_MANAGER),
    "request-ids": Cl.list(requestIds.map((id) => Cl.uint(id))),
  });
}

describe("get-page-size", () => {
  it("returns the pagination cap", () => {
    const { result } = simnet.callReadOnlyFn(
      "reward-claim-registry",
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
      simnet.callReadOnlyFn("reward-claim-registry", "is-admin", [Cl.principal(deployer)], deployer)
        .result,
    ).toBeBool(true);
  });

  it("admin can grant and revoke other admins", () => {
    expect(
      simnet.callPublicFn(
        "reward-claim-registry",
        "update-admin",
        [Cl.principal(wallet1), Cl.bool(true)],
        deployer,
      ).result,
    ).toBeOk(Cl.principal(wallet1));
    expect(
      simnet.callReadOnlyFn("reward-claim-registry", "is-admin", [Cl.principal(wallet1)], deployer)
        .result,
    ).toBeBool(true);

    // the new admin can revoke
    simnet.callPublicFn(
      "reward-claim-registry",
      "update-admin",
      [Cl.principal(wallet1), Cl.bool(false)],
      wallet1,
    );
    expect(
      simnet.callReadOnlyFn("reward-claim-registry", "is-admin", [Cl.principal(wallet1)], deployer)
        .result,
    ).toBeBool(false);
  });

  it("non-admin cannot update admins", () => {
    expect(
      simnet.callPublicFn(
        "reward-claim-registry",
        "update-admin",
        [Cl.principal(wallet2), Cl.bool(true)],
        wallet1,
      ).result,
    ).toBeErr(Cl.uint(ERR_NOT_ADMIN));
  });

  // Documents the self-lockout footgun: the sole admin can remove itself,
  // permanently bricking set-fee-per-cycle and update-admin. If a last-admin
  // guard is added, flip this expectation.
  it("the sole admin CAN lock itself out (no last-admin guard)", () => {
    simnet.callPublicFn(
      "reward-claim-registry",
      "update-admin",
      [Cl.principal(deployer), Cl.bool(false)],
      deployer,
    );
    expect(
      simnet.callPublicFn("reward-claim-registry", "set-fee-per-cycle", [Cl.uint(1)], deployer).result,
    ).toBeErr(Cl.uint(ERR_NOT_ADMIN));
  });
});

describe("set-fee-per-cycle", () => {
  it("admin can change the fee", () => {
    expect(
      simnet.callPublicFn("reward-claim-registry", "set-fee-per-cycle", [Cl.uint(250000)], deployer)
        .result,
    ).toBeOk(Cl.bool(true));
  });
  it("rejects a non-admin", () => {
    expect(
      simnet.callPublicFn("reward-claim-registry", "set-fee-per-cycle", [Cl.uint(250000)], wallet1)
        .result,
    ).toBeErr(Cl.uint(ERR_NOT_ADMIN));
  });
  it("rejects a zero fee", () => {
    expect(
      simnet.callPublicFn("reward-claim-registry", "set-fee-per-cycle", [Cl.uint(0)], deployer).result,
    ).toBeErr(Cl.uint(ERR_ZERO_FEE));
  });
});

describe("register-for-claims", () => {
  beforeEach(() => {
    initPox5();
    registerSignerManager(SIGNER_PRIVATE_KEY);
    stakeFor(wallet1, SIGNER_SET_MIN_USTX, 2n);
  });

  it("registers a real staking position and returns sweeps bought", () => {
    const { result } = registerForClaims(wallet1, 3n * FEE_PER_CLAIM, wallet1, SIGNER_MANAGER, Cl.none());
    expect(result).toBeOk(Cl.uint(3));
  });

  it("burns exactly the used portion of the fee", () => {
    const before = stxBalance(wallet1);
    // 3.5 sweeps' worth -> only 3 whole sweeps bought and burned
    registerForClaims(wallet1, 3n * FEE_PER_CLAIM + FEE_PER_CLAIM / 2n, wallet1, SIGNER_MANAGER, Cl.none());
    expect(before - stxBalance(wallet1)).toBe(3n * FEE_PER_CLAIM);
  });

  it("burns nothing when an admin registers", () => {
    // deployer is the default admin
    const before = stxBalance(deployer);
    const { result } = registerForClaims(wallet1, 3n * FEE_PER_CLAIM, deployer, SIGNER_MANAGER, Cl.none());
    expect(result).toBeOk(Cl.uint(3)); // still buys 3 sweeps
    expect(stxBalance(deployer)).toBe(before); // but nothing is burned
    expect(getRegistration(wallet1, SIGNER_MANAGER)).toBeSome(
      Cl.tuple({
        "bond-index": Cl.none(),
        "remaining-cycles": Cl.uint(3),
        "next-reward-cycle": Cl.uint(1),
        "last-claim-dist-cycle": Cl.none(),
      }),
    );
  });

  it("caps sweeps bought at MAX_DISTRIBUTION_CYCLES (192)", () => {
    // pay for 500 sweeps; only 192 are bought/burned
    const before = stxBalance(wallet1);
    const { result } = registerForClaims(wallet1, 500n * FEE_PER_CLAIM, wallet1, SIGNER_MANAGER, Cl.none());
    expect(result).toBeOk(Cl.uint(192));
    expect(before - stxBalance(wallet1)).toBe(192n * FEE_PER_CLAIM);
  });

  it("rejects a fee too small to buy a single sweep", () => {
    expect(registerForClaims(wallet1, FEE_PER_CLAIM - 1n, wallet1, SIGNER_MANAGER, Cl.none()).result).toBeErr(
      Cl.uint(ERR_INSUFFICIENT_FEE),
    );
  });

  it("rejects a staker with no pox-5 position", () => {
    // wallet3 never staked
    expect(registerForClaims(wallet3, FEE_PER_CLAIM, wallet3, SIGNER_MANAGER, Cl.none()).result).toBeErr(
      Cl.uint(ERR_NO_CURRENT_POSITION),
    );

    // Now we stake and registration succeeds
    stakeFor(wallet3, SIGNER_SET_MIN_USTX, 2n);
    const { result } = registerForClaims(wallet3, FEE_PER_CLAIM, wallet3, SIGNER_MANAGER, Cl.none());
    expect(result).toBeOk(Cl.uint(1));
  });

  it("tops up an existing registration instead of erroring on a duplicate", () => {
    const first = registerForClaims(wallet1, FEE_PER_CLAIM, wallet1, SIGNER_MANAGER, Cl.none());
    expect(first.result).toBeOk(Cl.uint(1));

    // registering the same {staker, signer-manager} again adds to remaining-cycles
    // rather than failing; the return is the cycles bought on this call.
    const second = registerForClaims(wallet1, 2n * FEE_PER_CLAIM, wallet1, SIGNER_MANAGER, Cl.none());
    expect(second.result).toBeOk(Cl.uint(2));

    expect(getRegistration(wallet1, SIGNER_MANAGER)).toBeSome(
      Cl.tuple({
        "bond-index": Cl.none(),
        "remaining-cycles": Cl.uint(3), // 1 + 2
        "next-reward-cycle": Cl.uint(1),
        "last-claim-dist-cycle": Cl.none(),
      }),
    );
  });

  it("is permissionless: a third party can register and pay for a staker", () => {
    // Wallet 2 is registering wallet 1, so it pays.
    const before = stxBalance(wallet2);
    const { result } = registerForClaims(wallet1, FEE_PER_CLAIM, wallet2, SIGNER_MANAGER, Cl.none());
    expect(result).toBeOk(Cl.uint(1));
    expect(before - stxBalance(wallet2)).toBe(FEE_PER_CLAIM); // payer is wallet2

    // The registration belongs to the staker (wallet1), not the payer (wallet2).
    expect(getRegistration(wallet1, SIGNER_MANAGER)).toBeSome(
      Cl.tuple({
        "bond-index": Cl.none(),
        "remaining-cycles": Cl.uint(1),
        "next-reward-cycle": Cl.uint(1),
        "last-claim-dist-cycle": Cl.none(),
      }),
    );
    expect(getRegistration(wallet2, SIGNER_MANAGER)).toBeNone();
  });
});

describe("get-due-claims", () => {
  beforeEach(() => {
    initPox5();
    registerSignerManager(SIGNER_PRIVATE_KEY);
    stakeFor(wallet1, SIGNER_SET_MIN_USTX, 2n);
  });

  it("is empty when nothing is registered", () => {
    expect(getDueClaims()).toBeOk(Cl.list([]));
  });

  it("lists a fresh registration as due", () => {
    registerForClaims(wallet1, FEE_PER_CLAIM, wallet1, SIGNER_MANAGER, Cl.none());
    expect(getDueClaims()).toBeOk(Cl.list([registered(wallet1)]));
  });

  it("walks multiple registrations in insertion order", () => {
    stakeFor(wallet2, SIGNER_SET_MIN_USTX, 2n);
    registerForClaims(wallet1, FEE_PER_CLAIM, wallet1, SIGNER_MANAGER, Cl.none());
    registerForClaims(wallet2, FEE_PER_CLAIM, wallet2, SIGNER_MANAGER, Cl.none());
    // the linked list appends at the tail, so the walk is wallet1 then wallet2
    expect(getDueClaims()).toBeOk(
      Cl.list([registered(wallet1), registered(wallet2)]),
    );
  });

  it("drops a registration from the due list once it is swept this cycle", () => {
    stakeFor(wallet2, SIGNER_SET_MIN_USTX, 2n);
    registerForClaims(wallet1, 3n * FEE_PER_CLAIM, wallet1, SIGNER_MANAGER, Cl.none());
    registerForClaims(wallet2, 3n * FEE_PER_CLAIM, wallet2, SIGNER_MANAGER, Cl.none());

    // both are due to start
    expect(getDueClaims()).toBeOk(
      Cl.list([registered(wallet1), registered(wallet2)]),
    );

    // sweep only wallet1 (empty-cycle advance: no rewards funded)
    const distCycle = currentDistributionCycle();
    expect(processRewardClaim(wallet1, wallet1, SIGNER_MANAGER).result).toBeOk(Cl.none());

    // wallet1 was swept this distribution cycle, so only wallet2 stays due
    expect(getDueClaims()).toBeOk(Cl.list([registered(wallet2)]));

    // wallet1's registration still exists (not deleted) -- just not due
    expect(getRegistration(wallet1, SIGNER_MANAGER)).toBeSome(
      Cl.tuple({
        "bond-index": Cl.none(),
        "remaining-cycles": Cl.uint(2), // 3 -> 2
        "next-reward-cycle": Cl.uint(1),
        "last-claim-dist-cycle": Cl.some(Cl.uint(distCycle)),
      }),
    );

    expect(getRegistration(wallet2, SIGNER_MANAGER)).toBeSome(
      Cl.tuple({
        "bond-index": Cl.none(),
        "remaining-cycles": Cl.uint(3),
        "next-reward-cycle": Cl.uint(1),
        "last-claim-dist-cycle": Cl.none(),
      }),
    );
  });
});

describe("process-reward-claim (direct sBTC payout)", () => {
  beforeEach(() => {
    initPox5();
    registerSignerManager(SIGNER_PRIVATE_KEY);
    stakeFor(wallet1, SIGNER_SET_MIN_USTX, 2n);
  });

  it("pays the staker its earned sBTC and decrements the registration", () => {
    fundAndClaimSignerRewards(2000n, 1n);
    registerForClaims(wallet1, 3n * FEE_PER_CLAIM, wallet1, SIGNER_MANAGER, Cl.none());

    // The registration exists and a sweep is now due
    expect(getDueClaims()).toBeOk(Cl.list([registered(wallet1)]));

    expect(getRegistration(wallet1, SIGNER_MANAGER)).toBeSome(
      Cl.tuple({
        "bond-index": Cl.none(),
        "remaining-cycles": Cl.uint(3),
        "next-reward-cycle": Cl.uint(1),
        "last-claim-dist-cycle": Cl.none(),
      }),
    );

    const stakerBefore = sbtcBalance(wallet1);
    const managerBefore = sbtcBalance(SIGNER_MANAGER);
    const distCycle = currentDistributionCycle();
    const { result } = processRewardClaim(wallet1, wallet2, SIGNER_MANAGER); // permissionless caller
    // no pox-addr -> direct payout -> no withdrawal request
    expect(result).toBeOk(Cl.none());

    // sBTC moved from the signer-manager to the stake:
    // the staker's gain equals the signer-manager's loss, and it is positive
    const paid = sbtcBalance(wallet1) - stakerBefore;
    expect(paid).toBeGreaterThan(0n);
    expect(managerBefore - sbtcBalance(SIGNER_MANAGER)).toBe(paid);

    // registration decremented: one sweep consumed, marked swept this cycle
    expect(getRegistration(wallet1, SIGNER_MANAGER)).toBeSome(
      Cl.tuple({
        "bond-index": Cl.none(),
        "remaining-cycles": Cl.uint(2), // 3 -> 2
        "next-reward-cycle": Cl.uint(1),
        "last-claim-dist-cycle": Cl.some(Cl.uint(distCycle)),
      }),
    );

    // The staker was swept this distribution cycle so they are no longer due
    expect(getDueClaims()).toBeOk(Cl.list([]));
  });

  it("advances past a genuinely empty cycle without stalling", () => {
    // registered, but no rewards were ever funded/claimed:
    // claim errs u1001 AND get-earned == 0 -> advance, returns (ok none)
    registerForClaims(wallet1, 3n * FEE_PER_CLAIM, wallet1, SIGNER_MANAGER, Cl.none());

    expect(getRegistration(wallet1, SIGNER_MANAGER)).toBeSome(
      Cl.tuple({
        "bond-index": Cl.none(),
        "remaining-cycles": Cl.uint(3),
        "next-reward-cycle": Cl.uint(1),
        "last-claim-dist-cycle": Cl.none(),
      }),
    );

    const distCycle = currentDistributionCycle();
    const { result } = processRewardClaim(wallet1, wallet1, SIGNER_MANAGER);
    expect(result).toBeOk(Cl.none());

    // the empty-cycle path still consumes a sweep and marks it swept, without
    // moving any sBTC
    expect(getRegistration(wallet1, SIGNER_MANAGER)).toBeSome(
      Cl.tuple({
        "bond-index": Cl.none(),
        "remaining-cycles": Cl.uint(2), // 3 -> 2
        "next-reward-cycle": Cl.uint(1),
        "last-claim-dist-cycle": Cl.some(Cl.uint(distCycle)),
      }),
    );
    // consumed a sweep for this cycle -> not due again this cycle
    expect(getDueClaims()).toBeOk(Cl.list([]));
  });

  it("errors for a staker with no registration", () => {
    expect(processRewardClaim(wallet1, wallet1, SIGNER_MANAGER).result).toBeErr(Cl.uint(ERR_NOT_REGISTERED));
  });

  it("errors when already swept this distribution cycle", () => {
    registerForClaims(wallet1, 3n * FEE_PER_CLAIM, wallet1, SIGNER_MANAGER, Cl.none());
    processRewardClaim(wallet1, wallet1, SIGNER_MANAGER); // empty-cycle advance, marks swept
    expect(processRewardClaim(wallet1, wallet1, SIGNER_MANAGER).result).toBeErr(Cl.uint(ERR_ALREADY_CLAIMED));
  });
});

describe("process-reward-claims (batch)", () => {
  beforeEach(() => {
    initPox5();
    registerSignerManager(SIGNER_PRIVATE_KEY);
    stakeFor(wallet1, SIGNER_SET_MIN_USTX, 2n);
    stakeFor(wallet2, SIGNER_SET_MIN_USTX, 2n);
  });

  it("sweeps multiple stakers and returns the count", () => {
    fundAndClaimSignerRewards(2000n, 1n);
    registerForClaims(wallet1, FEE_PER_CLAIM, wallet1, SIGNER_MANAGER, Cl.none());
    registerForClaims(wallet2, FEE_PER_CLAIM, wallet2, SIGNER_MANAGER, Cl.none());

    // both are due to start
    expect(getDueClaims()).toBeOk(
      Cl.list([registered(wallet1), registered(wallet2)]),
    );

    const { result } = simnet.callPublicFn(
      "reward-claim-registry",
      "process-reward-claims",
      [Cl.principal(SIGNER_MANAGER), Cl.list([Cl.principal(wallet1), Cl.principal(wallet2)])],
      wallet3,
    );
    expect(result).toBeOk(Cl.uint(2));

    // both are swept this distribution cycle, so none are due again
    expect(getDueClaims()).toBeOk(Cl.list([]));
  });

  it("skips unregistered stakers without aborting the batch", () => {
    registerForClaims(wallet1, FEE_PER_CLAIM, wallet1, SIGNER_MANAGER, Cl.none());

    // wallet2 is skipped, so only wallet1 is due
    expect(getDueClaims()).toBeOk(Cl.list([registered(wallet1)]));

    const { result } = simnet.callPublicFn(
      "reward-claim-registry",
      "process-reward-claims",
      // wallet2 is staked but NOT registered -> skipped
      [Cl.principal(SIGNER_MANAGER), Cl.list([Cl.principal(wallet1), Cl.principal(wallet2)])],
      wallet3,
    );
    expect(result).toBeOk(Cl.uint(1));

    // wallet2 is skipped, so only wallet1 is due
    expect(getDueClaims()).toBeOk(Cl.list([]));
  });
});

describe("update-registration", () => {
  // A second signer-manager (the mock) is registered with pox-5 so a
  // registration can be genuinely moved between managers. wallet1 stakes under
  // the real signer-manager; the carry path moves both its pox-5 stake (via
  // stake-update) and its registration onto the mock.
  beforeEach(() => {
    initPox5();
    registerSignerManager(SIGNER_PRIVATE_KEY);
    registerMockSignerManager(MOCK_SIGNER_PRIVATE_KEY);
    stakeFor(wallet1, SIGNER_SET_MIN_USTX, 2n);
  });

  it("carries all its sweeps to the mock signer-manager, burning nothing", () => {
    registerForClaims(wallet1, 3n * FEE_PER_CLAIM, wallet1, SIGNER_MANAGER, Cl.none());
    // move wallet1's pox-5 stake to the mock, so it is the signer pox-5 reports
    stakeUpdate(wallet1, MOCK_SIGNER_MANAGER, SIGNER_MANAGER);

    const before = stxBalance(wallet1);
    const { result } = simnet.callPublicFn(
      "reward-claim-registry",
      "update-registration",
      [Cl.principal(SIGNER_MANAGER), Cl.principal(MOCK_SIGNER_MANAGER), Cl.none()],
      wallet1,
    );
    expect(result).toBeOk(Cl.uint(3)); // all 3 sweeps carried across

    // the carry reuses already-bought sweeps, so nothing is burned
    expect(stxBalance(wallet1)).toBe(before);

    // the old key is gone; the mock key now holds the carried sweeps
    expect(getRegistration(wallet1, SIGNER_MANAGER)).toBeNone();
    expect(getRegistration(wallet1, MOCK_SIGNER_MANAGER)).toBeSome(
      Cl.tuple({
        "bond-index": Cl.none(),
        "remaining-cycles": Cl.uint(3),
        "next-reward-cycle": Cl.uint(1),
        "last-claim-dist-cycle": Cl.none(),
      }),
    );
  });

  it("carries only the sweeps left after some were consumed", () => {
    registerForClaims(wallet1, 3n * FEE_PER_CLAIM, wallet1, SIGNER_MANAGER, Cl.none());
    // consume one sweep (empty-cycle advance): 3 -> 2
    processRewardClaim(wallet1, wallet1, SIGNER_MANAGER);
    stakeUpdate(wallet1, MOCK_SIGNER_MANAGER, SIGNER_MANAGER);

    const { result } = simnet.callPublicFn(
      "reward-claim-registry",
      "update-registration",
      [Cl.principal(SIGNER_MANAGER), Cl.principal(MOCK_SIGNER_MANAGER), Cl.none()],
      wallet1,
    );
    expect(result).toBeOk(Cl.uint(2)); // only the 2 remaining sweeps carry over

    // recreating under the mock clears last-claim-dist-cycle
    expect(getRegistration(wallet1, MOCK_SIGNER_MANAGER)).toBeSome(
      Cl.tuple({
        "bond-index": Cl.none(),
        "remaining-cycles": Cl.uint(2),
        "next-reward-cycle": Cl.uint(1),
        "last-claim-dist-cycle": Cl.none(),
      }),
    );
    expect(getRegistration(wallet1, SIGNER_MANAGER)).toBeNone();
  });

  it("rejects when the caller has no registration to carry", () => {
    // wallet1 is staked but never registered -> the destroy side errs
    const { result } = simnet.callPublicFn(
      "reward-claim-registry",
      "update-registration",
      [Cl.principal(SIGNER_MANAGER), Cl.principal(MOCK_SIGNER_MANAGER), Cl.none()],
      wallet1,
    );
    expect(result).toBeErr(Cl.uint(ERR_NOT_REGISTERED));
  });

  it("acts on the caller's own registration, not another staker's", () => {
    registerForClaims(wallet1, 3n * FEE_PER_CLAIM, wallet1, SIGNER_MANAGER, Cl.none());
    // wallet2 has no registration; its update fails even though wallet1 has one
    const { result } = simnet.callPublicFn(
      "reward-claim-registry",
      "update-registration",
      [Cl.principal(SIGNER_MANAGER), Cl.principal(MOCK_SIGNER_MANAGER), Cl.none()],
      wallet2,
    );
    expect(result).toBeErr(Cl.uint(ERR_NOT_REGISTERED));
    // wallet1's registration is untouched
    expect(getDueClaims()).toBeOk(Cl.list([registered(wallet1)]));
  });

  it("is atomic: a failed carry leaves the original registration intact", () => {
    registerForClaims(wallet1, 3n * FEE_PER_CLAIM, wallet1, SIGNER_MANAGER, Cl.none());
    // wallet1 has no position under the mock (its stake is still under the real
    // signer-manager), so the create side fails; the destroy must roll back.
    const { result } = simnet.callPublicFn(
      "reward-claim-registry",
      "update-registration",
      [Cl.principal(SIGNER_MANAGER), Cl.principal(MOCK_SIGNER_MANAGER), Cl.none()],
      wallet1,
    );
    expect(result).toBeErr(Cl.uint(ERR_NO_CURRENT_POSITION));
    // original registration still intact
    expect(getRegistration(wallet1, SIGNER_MANAGER)).toBeSome(
      Cl.tuple({
        "bond-index": Cl.none(),
        "remaining-cycles": Cl.uint(3),
        "next-reward-cycle": Cl.uint(1),
        "last-claim-dist-cycle": Cl.none(),
      }),
    );
    expect(getDueClaims()).toBeOk(Cl.list([registered(wallet1)]));
  });
});

describe("bond path", () => {
  const BOND_INDEX = 0n;

  beforeEach(() => {
    initPox5();
    registerSignerManager(SIGNER_PRIVATE_KEY);
    setupBond(BOND_INDEX, [wallet1], 100_000_000n);
    registerForBond(wallet1, BOND_INDEX, 5_000_000n);
  });

  it("get-position resolves the bond membership under the signer-manager", () => {
    const { result } = simnet.callReadOnlyFn(
      "reward-claim-registry",
      "get-position",
      [Cl.principal(wallet1), Cl.some(Cl.uint(BOND_INDEX))],
      deployer,
    );
    expect(result).toBeSome(
      Cl.tuple({
        signer: Cl.principal(SIGNER_MANAGER),
        "first-reward-cycle": Cl.uint(bondPeriodToRewardCycle(BOND_INDEX)),
      }),
    );
  });

  it("registers a bond position and lists it as due with the bond-index", () => {
    const { result } = registerForClaims(
      wallet1,
      3n * FEE_PER_CLAIM,
      wallet1,
      SIGNER_MANAGER,
      Cl.some(Cl.uint(BOND_INDEX)),
    );
    expect(result).toBeOk(Cl.uint(3));

    expect(getDueClaims()).toBeOk(
      Cl.list([
        Cl.tuple({
          "signer-manager": Cl.principal(SIGNER_MANAGER),
          "staker": Cl.principal(wallet1),
          "bond-index": Cl.some(Cl.uint(BOND_INDEX)),
          "reward-cycle": Cl.uint(bondPeriodToRewardCycle(BOND_INDEX)),
        }),
      ]),
    );
  });

  it("process-reward-claim drives the bond claim path (empty-cycle advance)", () => {
    registerForClaims(
      wallet1,
      3n * FEE_PER_CLAIM,
      wallet1,
      SIGNER_MANAGER,
      Cl.some(Cl.uint(BOND_INDEX)),
    );
    // no bond rewards funded: claim errs u1001 and get-earned(signer, cycle,
    // (some 0)) == 0 -> advance past the cycle via the bond-index path
    expect(processRewardClaim(wallet1, wallet1, SIGNER_MANAGER).result).toBeOk(Cl.none());
    expect(getDueClaims()).toBeOk(Cl.list([]));
  });

  it("a bond staker cannot also register the STX-stake position (none)", () => {
    // wallet1 bonded but never STX-staked, so the none-bond position is absent
    expect(registerForClaims(wallet1, FEE_PER_CLAIM, wallet1, SIGNER_MANAGER, Cl.none()).result).toBeErr(
      Cl.uint(ERR_NO_CURRENT_POSITION),
    );
  });
});

describe("L1 withdrawal path + settlements", () => {
  beforeEach(() => {
    initPox5();
    registerSignerManager(SIGNER_PRIVATE_KEY);
    stakeWithPoxAddr(wallet1, SIGNER_SET_MIN_USTX, 2n, 100n); // pox-addr present -> rewards route to L1
    fundAndClaimSignerRewards(2000n, 1n);
    registerForClaims(wallet1, 3n * FEE_PER_CLAIM, wallet1, SIGNER_MANAGER, Cl.none());
  });

  it("records a withdrawal request-id and lists it as a due settlement", () => {
    const { result } = processRewardClaim(wallet1, wallet1, SIGNER_MANAGER);
    // pox-addr present -> the first L1 withdrawal request-id (1) is returned
    expect(result).toBeOk(Cl.some(Cl.uint(1)));

    expect(getDueSettlements()).toBeOk(Cl.list([settlement(wallet1, [1n])]));
  });

  it("settles an ACCEPTED withdrawal and clears it from the settlement list", () => {
    processRewardClaim(wallet1, wallet1, SIGNER_MANAGER);
    // sBTC signers accept request 1, then anyone settles it
    acceptWithdrawal(1n, 30n);
    const { result } = settlePendingWithdrawal(wallet1, 1n, wallet2);
    expect(result).toBeOk(Cl.bool(true));
    expect(getDueSettlements()).toBeOk(Cl.list([]));
  });

  it("settles a REJECTED withdrawal (reclaims to the staker) and clears it", () => {
    processRewardClaim(wallet1, wallet1, SIGNER_MANAGER);
    rejectWithdrawal(1n);
    const { result } = settlePendingWithdrawal(wallet1, 1n, wallet2);
    expect(result).toBeOk(Cl.bool(true));
    expect(getDueSettlements()).toBeOk(Cl.list([]));
  });

  it("is a no-op while the withdrawal is still pending", () => {
    processRewardClaim(wallet1, wallet1, SIGNER_MANAGER);
    // status not set -> still pending -> ok false, stays listed
    expect(settlePendingWithdrawal(wallet1, 1n, wallet2).result).toBeOk(Cl.bool(false));
    // still listed as awaiting settlement
    expect(getDueSettlements()).toBeOk(Cl.list([settlement(wallet1, [1n])]));
  });

  it("errors on an unknown pending withdrawal", () => {
    processRewardClaim(wallet1, wallet1, SIGNER_MANAGER);
    expect(settlePendingWithdrawal(wallet1, 9999n, wallet2).result).toBeErr(
      Cl.uint(ERR_UNKNOWN_PENDING_WITHDRAWAL),
    );
  });

  it("batch settle-pending-withdrawals resolves accepted items and counts them", () => {
    processRewardClaim(wallet1, wallet1, SIGNER_MANAGER);
    acceptWithdrawal(1n, 30n);
    const { result } = simnet.callPublicFn(
      "reward-claim-registry",
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
