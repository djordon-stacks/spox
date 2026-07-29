;; title: sweeper-traits
;; summary: Trait the sweep-registry dispatches on to claim and settle rewards
;; for a staker via their signer-manager.

(define-trait sweeper-signer-manager-trait
  (
    ;; Claim a staker's rewards for a reward cycle (and optional bond index).
    ;; Returns the net `earned` credited to the staker and, when the payout was
    ;; routed to an L1 sBTC withdrawal, the `withdrawal-request` (`none` for a
    ;; direct sBTC payout).
    (claim-staker-rewards
      (principal uint (optional uint))
      (response { earned: uint, withdrawal-request: (optional uint) } uint)
    )
    ;; Settle an accepted L1 withdrawal by its sbtc-registry request-id.
    (settle-accepted-withdrawal (uint) (response bool uint))
    ;; Reclaim a rejected L1 withdrawal back to the staker who earned it.
    (reclaim-failed-withdrawal (uint) (response bool uint))
  )
)
