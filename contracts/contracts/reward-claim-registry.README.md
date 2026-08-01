# reward-claim-registry

Permissionless keeper contract that registers PoX-5 stakers for automated reward claims via their signer-manager. Callers buy claim installments by burning STX burned at registration. An application later calls `process-reward-claim(s)` to pull rewards from pox-5 when needed, claim for the staker, and advance the schedule. L1 sBTC withdrawals are tracked and settled separately.

Schedule is keyed by **distribution cycle**, and there are two distribution cycles per reward cycle. A claim is pending when `next-claim-distribution < current-distribution-cycle`. The pox-5 reward cycle claimed is `next-claim-distribution / 2`.

## Invariants

- **Pending gate.** No claim runs unless `remaining-cycles > 0` and `next-claim-distribution < current-distribution-cycle`.
- **STX: once per reward cycle.** For STX-only stakers, process-claims can only pull rewards for a signer-manager at most once for a reward cycle, and only after the reward cycle has finished.
- **Bond: once per distribution.** For BTC stakers rewards can be claimed at most two claims per reward cycle.
- **Catch-up is immediate.** When many distributions are already past, keepers may call `process-reward-claim` repeatedly.
- **Always advance.** A failed `claim-rewards` or `claim-staker-rewards` still decrements `remaining-cycles` and advances the schedule so a hostile/broken signer-manager cannot stall a registration.
- **Self-heal pull.** If pox-5 `get-earned > 0` for the scope, the registry calls `claim-rewards` before `claim-staker-rewards`.
- **No STX custody.** The fee is burned during registration. Admins register for free.
- **Top-up preserves schedule.** Re-registering the same `{staker, signer-manager}` adds to `remaining-cycles`.

## Gotchas

- Registration requires a **live** pox-5 position under that signer-manager.
- Empty / failed claims still burns a claim.
- Pending L1 withdrawals are capped at 192 per registration; settlement is a separate permissionless step after sBTC accept/reject.
