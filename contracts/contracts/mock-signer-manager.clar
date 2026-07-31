;; title: mock-signer-manager summary: Test double implementing
;; reward-claim-signer-manager-trait. Its claim / settle behavior is fully
;; driven by setters so tests can exercise the reward-claim-registry's ok,
;; empty-cycle, and error branches without a real signer-manager or pox-5.

(impl-trait .reward-claim-traits.reward-claim-signer-manager-trait)

(define-data-var should-err bool false)
(define-data-var err-code uint u1001) ;; SM_ERR_NO_CLAIMABLE_REWARDS by default
(define-data-var earned-amount uint u1000)
(define-data-var withdrawal-id (optional uint) none)

;; #[allow(unnecessary_public)]
(define-public (claim-staker-rewards
    ;; #[allow(unused_binding)]
    (staker principal)
    ;; #[allow(unused_binding)]
    (reward-cycle uint)
    ;; #[allow(unused_binding)]
    (bond-index (optional uint))
  )
  (if (var-get should-err)
    (err (var-get err-code))
    (ok {
      earned: (var-get earned-amount),
      withdrawal-request: (var-get withdrawal-id),
    })
  )
)

;; Stub to satisfy the trait; the reward-claim-registry ignores the return.
;; Returns one dummy bond-rewards element so the list element type is explicit.
;; #[allow(unnecessary_public)]
(define-public (claim-rewards
    ;; #[allow(unused_binding)]
    (bond-periods (list 6 uint))
    ;; #[allow(unused_binding)]
    (reward-cycle uint)
  )
  (ok {
    stx-rewards: { earned: u0, rewards-per-token: u0 },
    bond-rewards: (list { earned: u0, bond-index: u0, rewards-per-token: u0 }),
    bond-totals: u0,
    total-rewards: u0,
  })
)

;; #[allow(unnecessary_public)]
(define-public (settle-accepted-withdrawal
  ;; #[allow(unused_binding)]
  (request-id uint)
)
  (ok true)
)

;; #[allow(unnecessary_public)]
(define-public (reclaim-failed-withdrawal
  ;; #[allow(unused_binding)]
  (request-id uint)
)
  (ok true)
)

;; --- test setter ---
;; Drive the next claim-staker-rewards result: return (err code) when
;; should-error, else (ok { earned, withdrawal-request: wid }).
(define-public (set-claim-result
    (should-error bool)
    (code uint)
    (earned uint)
    (wid (optional uint))
  )
  (begin
    (var-set should-err should-error)
    ;; #[allow(unchecked_data)]
    (var-set err-code code)
    ;; #[allow(unchecked_data)]
    (var-set earned-amount earned)
    ;; #[allow(unchecked_data)]
    (var-set withdrawal-id wid)
    (ok true)
  )
)
