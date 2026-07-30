import { Cl } from "@stacks/transactions";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ERR_ALREADY_REGISTERED,
  ERR_ALREADY_CLAIMED,
  ERR_INSUFFICIENT_FEE,
  ERR_NO_CURRENT_POSITION,
  ERR_NOT_ADMIN,
  ERR_NOT_REGISTERED,
  ERR_UNKNOWN_PENDING_WITHDRAWAL,
  ERR_ZERO_FEE,
  FEE_PER_CLAIM,
  SIGNER_MANAGER,
  acceptWithdrawal,
  bondPeriodToRewardCycle,
  currentDistributionCycle,
  deployer,
  fundAndClaimSignerRewards,
  getDueSettlements,
  getDueSweeps,
  getRegistration,
  initPox5,
  performSweep,
  registerForBond,
  registerForSweep,
  registerSignerManager,
  rejectWithdrawal,
  sbtcBalance,
  setupBond,
  stakeFor,
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
    registerSignerManager();
    stakeFor(wallet1);
  });

  it("registers a real staking position and returns sweeps bought", () => {
    const { result } = registerForSweep(wallet1, 3n * FEE_PER_CLAIM);
    expect(result).toBeOk(Cl.uint(3));
  });

  it("burns exactly the used portion of the fee", () => {
    const before = stxBalance(wallet1);
    // 3.5 sweeps' worth -> only 3 whole sweeps bought and burned
    registerForSweep(wallet1, 3n * FEE_PER_CLAIM + FEE_PER_CLAIM / 2n);
    expect(before - stxBalance(wallet1)).toBe(3n * FEE_PER_CLAIM);
  });

  it("burns nothing when an admin registers", () => {
    // deployer is the default admin
    const before = stxBalance(deployer);
    const { result } = registerForSweep(wallet1, 3n * FEE_PER_CLAIM, deployer);
    expect(result).toBeOk(Cl.uint(3)); // still buys 3 sweeps
    expect(stxBalance(deployer)).toBe(before); // but nothing is burned
    expect(getRegistration(wallet1)).toBeSome(
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
    const { result } = registerForSweep(wallet1, 500n * FEE_PER_CLAIM);
    expect(result).toBeOk(Cl.uint(192));
    expect(before - stxBalance(wallet1)).toBe(192n * FEE_PER_CLAIM);
  });

  it("rejects a fee too small to buy a single sweep", () => {
    expect(registerForSweep(wallet1, FEE_PER_CLAIM - 1n).result).toBeErr(
      Cl.uint(ERR_INSUFFICIENT_FEE),
    );
  });

  it("rejects a staker with no pox-5 position", () => {
    // wallet3 never staked
    expect(registerForSweep(wallet3, FEE_PER_CLAIM).result).toBeErr(
      Cl.uint(ERR_NO_CURRENT_POSITION),
    );

    // Now we stake and registration succeeds
    stakeFor(wallet3);
    const { result } = registerForSweep(wallet3, FEE_PER_CLAIM);
    expect(result).toBeOk(Cl.uint(1));
  });

  it("rejects a duplicate registration", () => {
    const { result } = registerForSweep(wallet1, FEE_PER_CLAIM);
    expect(result).toBeOk(Cl.uint(1));

    expect(registerForSweep(wallet1, FEE_PER_CLAIM).result).toBeErr(
      Cl.uint(ERR_ALREADY_REGISTERED),
    );
  });

  it("is permissionless: a third party can register and pay for a staker", () => {
    // Wallet 2 is registering wallet 1, so it pays.
    const before = stxBalance(wallet2);
    const { result } = registerForSweep(wallet1, FEE_PER_CLAIM, wallet2);
    expect(result).toBeOk(Cl.uint(1));
    expect(before - stxBalance(wallet2)).toBe(FEE_PER_CLAIM); // payer is wallet2

    // The registration belongs to the staker (wallet1), not the payer (wallet2).
    expect(getRegistration(wallet1)).toBeSome(
      Cl.tuple({
        "bond-index": Cl.none(),
        "remaining-cycles": Cl.uint(1),
        "next-reward-cycle": Cl.uint(1),
        "last-claim-dist-cycle": Cl.none(),
      }),
    );
    expect(getRegistration(wallet2)).toBeNone();
  });
});

describe("get-due-claims", () => {
  beforeEach(() => {
    initPox5();
    registerSignerManager();
    stakeFor(wallet1);
  });

  it("is empty when nothing is registered", () => {
    expect(getDueSweeps()).toBeOk(Cl.list([]));
  });

  it("lists a fresh registration as due", () => {
    registerForSweep(wallet1, FEE_PER_CLAIM);
    expect(getDueSweeps()).toBeOk(Cl.list([registered(wallet1)]));
  });

  it("walks multiple registrations in insertion order", () => {
    stakeFor(wallet2);
    registerForSweep(wallet1, FEE_PER_CLAIM);
    registerForSweep(wallet2, FEE_PER_CLAIM);
    // the linked list appends at the tail, so the walk is wallet1 then wallet2
    expect(getDueSweeps()).toBeOk(
      Cl.list([registered(wallet1), registered(wallet2)]),
    );
  });

  it("drops a registration from the due list once it is swept this cycle", () => {
    stakeFor(wallet2);
    registerForSweep(wallet1, 3n * FEE_PER_CLAIM);
    registerForSweep(wallet2, 3n * FEE_PER_CLAIM);

    // both are due to start
    expect(getDueSweeps()).toBeOk(
      Cl.list([registered(wallet1), registered(wallet2)]),
    );

    // sweep only wallet1 (empty-cycle advance: no rewards funded)
    const distCycle = currentDistributionCycle();
    expect(performSweep(wallet1).result).toBeOk(Cl.none());

    // wallet1 was swept this distribution cycle, so only wallet2 stays due
    expect(getDueSweeps()).toBeOk(Cl.list([registered(wallet2)]));

    // wallet1's registration still exists (not deleted) -- just not due
    expect(getRegistration(wallet1)).toBeSome(
      Cl.tuple({
        "bond-index": Cl.none(),
        "remaining-cycles": Cl.uint(2), // 3 -> 2
        "next-reward-cycle": Cl.uint(1),
        "last-claim-dist-cycle": Cl.some(Cl.uint(distCycle)),
      }),
    );

    expect(getRegistration(wallet2)).toBeSome(
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
    registerSignerManager();
    stakeFor(wallet1);
  });

  it("pays the staker its earned sBTC and decrements the registration", () => {
    fundAndClaimSignerRewards(2000n);
    registerForSweep(wallet1, 3n * FEE_PER_CLAIM);

    // The registration exists and a sweep is now due
    expect(getDueSweeps()).toBeOk(Cl.list([registered(wallet1)]));

    expect(getRegistration(wallet1)).toBeSome(
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
    const { result } = performSweep(wallet1, wallet2); // permissionless caller
    // no pox-addr -> direct payout -> no withdrawal request
    expect(result).toBeOk(Cl.none());

    // sBTC moved from the signer-manager to the stake:
    // the staker's gain equals the signer-manager's loss, and it is positive
    const paid = sbtcBalance(wallet1) - stakerBefore;
    expect(paid).toBeGreaterThan(0n);
    expect(managerBefore - sbtcBalance(SIGNER_MANAGER)).toBe(paid);

    // registration decremented: one sweep consumed, marked swept this cycle
    expect(getRegistration(wallet1)).toBeSome(
      Cl.tuple({
        "bond-index": Cl.none(),
        "remaining-cycles": Cl.uint(2), // 3 -> 2
        "next-reward-cycle": Cl.uint(1),
        "last-claim-dist-cycle": Cl.some(Cl.uint(distCycle)),
      }),
    );

    // The staker was swept this distribution cycle so they are no longer due
    expect(getDueSweeps()).toBeOk(Cl.list([]));
  });

  it("advances past a genuinely empty cycle without stalling", () => {
    // registered, but no rewards were ever funded/claimed:
    // claim errs u1001 AND get-earned == 0 -> advance, returns (ok none)
    registerForSweep(wallet1, 3n * FEE_PER_CLAIM);

    expect(getRegistration(wallet1)).toBeSome(
      Cl.tuple({
        "bond-index": Cl.none(),
        "remaining-cycles": Cl.uint(3),
        "next-reward-cycle": Cl.uint(1),
        "last-claim-dist-cycle": Cl.none(),
      }),
    );

    const distCycle = currentDistributionCycle();
    const { result } = performSweep(wallet1);
    expect(result).toBeOk(Cl.none());

    // the empty-cycle path still consumes a sweep and marks it swept, without
    // moving any sBTC
    expect(getRegistration(wallet1)).toBeSome(
      Cl.tuple({
        "bond-index": Cl.none(),
        "remaining-cycles": Cl.uint(2), // 3 -> 2
        "next-reward-cycle": Cl.uint(1),
        "last-claim-dist-cycle": Cl.some(Cl.uint(distCycle)),
      }),
    );
    // consumed a sweep for this cycle -> not due again this cycle
    expect(getDueSweeps()).toBeOk(Cl.list([]));
  });

  it("errors for a staker with no registration", () => {
    expect(performSweep(wallet1).result).toBeErr(Cl.uint(ERR_NOT_REGISTERED));
  });

  it("errors when already swept this distribution cycle", () => {
    registerForSweep(wallet1, 3n * FEE_PER_CLAIM);
    performSweep(wallet1); // empty-cycle advance, marks swept
    expect(performSweep(wallet1).result).toBeErr(Cl.uint(ERR_ALREADY_CLAIMED));
  });
});

describe("process-reward-claims (batch)", () => {
  beforeEach(() => {
    initPox5();
    registerSignerManager();
    stakeFor(wallet1);
    stakeFor(wallet2);
  });

  it("sweeps multiple stakers and returns the count", () => {
    fundAndClaimSignerRewards(2000n);
    registerForSweep(wallet1, FEE_PER_CLAIM);
    registerForSweep(wallet2, FEE_PER_CLAIM);

    // both are due to start
    expect(getDueSweeps()).toBeOk(
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
    expect(getDueSweeps()).toBeOk(Cl.list([]));
  });

  it("skips unregistered stakers without aborting the batch", () => {
    registerForSweep(wallet1, FEE_PER_CLAIM);

    // wallet2 is skipped, so only wallet1 is due
    expect(getDueSweeps()).toBeOk(Cl.list([registered(wallet1)]));

    const { result } = simnet.callPublicFn(
      "reward-claim-registry",
      "process-reward-claims",
      // wallet2 is staked but NOT registered -> skipped
      [Cl.principal(SIGNER_MANAGER), Cl.list([Cl.principal(wallet1), Cl.principal(wallet2)])],
      wallet3,
    );
    expect(result).toBeOk(Cl.uint(1));

    // wallet2 is skipped, so only wallet1 is due
    expect(getDueSweeps()).toBeOk(Cl.list([]));
  });
});

describe("update-registration", () => {
  it("carries sweeps to a new signer-manager the caller now stakes under", () => {
    // Only one real signer-manager is deployed, so we can at least prove the
    // old registration is required and the carry path validates the new signer.
    initPox5();
    registerSignerManager();
    stakeFor(wallet1);
    registerForSweep(wallet1, 3n * FEE_PER_CLAIM);
    // moving to a signer-manager the staker has no position under fails on the
    // create side with error ERR_NO_CURRENT_POSITION.
    const { result } = simnet.callPublicFn(
      "reward-claim-registry",
      "update-registration",
      [Cl.principal(SIGNER_MANAGER), Cl.principal(wallet2), Cl.none()],
      wallet1,
    );
    expect(result).toBeErr(Cl.uint(ERR_NO_CURRENT_POSITION));
    // original registration still intact
    expect(getDueSweeps()).toBeOk(Cl.list([registered(wallet1)]));
  });
});

describe("bond path", () => {
  const BOND_INDEX = 0n;

  beforeEach(() => {
    initPox5();
    registerSignerManager();
    setupBond(BOND_INDEX, [wallet1]);
    registerForBond(wallet1, BOND_INDEX);
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
    const { result } = registerForSweep(
      wallet1,
      3n * FEE_PER_CLAIM,
      wallet1,
      SIGNER_MANAGER,
      Cl.some(Cl.uint(BOND_INDEX)),
    );
    expect(result).toBeOk(Cl.uint(3));

    expect(getDueSweeps()).toBeOk(
      Cl.list([
        Cl.tuple({
          "signer-manager": Cl.principal(SIGNER_MANAGER),
          staker: Cl.principal(wallet1),
          "bond-index": Cl.some(Cl.uint(BOND_INDEX)),
          "reward-cycle": Cl.uint(bondPeriodToRewardCycle(BOND_INDEX)),
        }),
      ]),
    );
  });

  it("process-reward-claim drives the bond claim path (empty-cycle advance)", () => {
    registerForSweep(
      wallet1,
      3n * FEE_PER_CLAIM,
      wallet1,
      SIGNER_MANAGER,
      Cl.some(Cl.uint(BOND_INDEX)),
    );
    // no bond rewards funded: claim errs u1001 and get-earned(signer, cycle,
    // (some 0)) == 0 -> advance past the cycle via the bond-index path
    expect(performSweep(wallet1).result).toBeOk(Cl.none());
    expect(getDueSweeps()).toBeOk(Cl.list([]));
  });

  it("a bond staker cannot also register the STX-stake position (none)", () => {
    // wallet1 bonded but never STX-staked, so the none-bond position is absent
    expect(registerForSweep(wallet1, FEE_PER_CLAIM).result).toBeErr(
      Cl.uint(ERR_NO_CURRENT_POSITION),
    );
  });
});

describe("L1 withdrawal path + settlements", () => {
  beforeEach(() => {
    initPox5();
    registerSignerManager();
    stakeWithPoxAddr(wallet1); // pox-addr present -> rewards route to L1
    fundAndClaimSignerRewards(2000n);
    registerForSweep(wallet1, 3n * FEE_PER_CLAIM);
  });

  it("records a withdrawal request-id and lists it as a due settlement", () => {
    const { result } = performSweep(wallet1);
    // pox-addr present -> the first L1 withdrawal request-id (1) is returned
    expect(result).toBeOk(Cl.some(Cl.uint(1)));

    expect(getDueSettlements()).toBeOk(Cl.list([settlement(wallet1, [1n])]));
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
    // still listed as awaiting settlement
    expect(getDueSettlements()).toBeOk(Cl.list([settlement(wallet1, [1n])]));
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
