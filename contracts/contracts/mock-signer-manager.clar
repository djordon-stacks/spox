;; title: mock-signer-manager
;; summary: Test double implementing sweeper-signer-manager-trait. Its claim /
;; settle behavior is fully driven by setters so tests can exercise the
;; sweep-registry's ok, empty-cycle, and error branches without a real
;; signer-manager or pox-5.

(impl-trait .sweeper-traits.sweeper-signer-manager-trait)

(define-data-var should-err bool false)
(define-data-var err-code uint u1001) ;; SM_ERR_NO_CLAIMABLE_REWARDS by default
(define-data-var earned-amount uint u1000)
(define-data-var withdrawal-id (optional uint) none)

(define-public (claim-staker-rewards
    (staker principal)
    (reward-cycle uint)
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

(define-public (settle-accepted-withdrawal (request-id uint))
  (ok true)
)

(define-public (reclaim-failed-withdrawal (request-id uint))
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
