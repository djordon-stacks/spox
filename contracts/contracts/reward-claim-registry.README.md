# reward-claim-registry

Permissionless keeper contract that registers PoX-5 stakers for automated reward claims via their signer-manager. A staker (or an admin on their behalf) buys claim installments by escrowing STX, choosing a `start-reward-cycle` and whether to claim at most once or twice per reward cycle (`one-claim-per-reward-cycle`). Keepers later call `process-reward-claim(s)` to pull rewards from pox-5 when needed, claim for the staker, and advance the schedule. Each advance burns one installment from escrow. L1 sBTC withdrawals are tracked and settled separately.

Schedule is keyed by **distribution cycle** (two per reward cycle). A claim is pending when `next-claim-distribution < current-distribution-cycle`. The pox-5 reward cycle claimed is `next-claim-distribution / 2`.

## Invariants

- **Pending gate.** No claim runs unless `remaining-cycles > 0` and `next-claim-distribution < current-distribution-cycle`.
- **Cadence is chosen at registration.** `one-claim-per-reward-cycle = true` seeds on the second half and steps by 2; `false` seeds on the first half, steps by 1, and on catch-up jumps to the next reward cycle's first half when the claimed cycle is fully past.
- **Start cycle is explicit.** `start-reward-cycle` must be `>=` the position's `first-reward-cycle`; the schedule always uses that value (no silent `max` with current).
- **Catch-up is immediate.** When many distributions are already past, keepers may call `process-reward-claim` repeatedly.
- **Always advance.** A failed `claim-rewards` or `claim-staker-rewards` still decrements `remaining-cycles`, burns one installment from escrow, and advances the schedule.
- **Self-heal pull.** If pox-5 `get-earned > 0` for the scope, the registry calls `claim-rewards` before `claim-staker-rewards`.
- **Escrow then burn.** Fee STX is held as `prepaid-ustx` and burned one installment at a time on advance. Admins escrow nothing.
- **Self-register (or admin).** Only the staker or an admin may `register-for-claims` / `add-claims`. Cancel is staker-only, including when an admin created the registration; remaining escrow is refunded to the staker.
- **add-claims preserves schedule.** Buying more installments for `{staker, signer-manager}` only increases `remaining-cycles` and `prepaid-ustx`. Re-registering the same key fails with `ERR_ALREADY_REGISTERED`.

## Gotchas

- Registration requires a **live** pox-5 position under that signer-manager; bond-index is looked up, not passed.
- Empty / failed claims still burn a claim installment from escrow.
- Only the staker may `cancel-registration` (admins cannot cancel for them). Remaining `prepaid-ustx` is refunded to the staker; pending L1 withdrawals remain settleable.
- Pending L1 withdrawals are capped at 192 per registration; settlement is a separate permissionless step after sBTC accept/reject.
