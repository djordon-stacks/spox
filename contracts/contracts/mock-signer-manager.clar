;; title: mock-signer-manager summary: Test double implementing
;; reward-claim-signer-manager-trait AND pox-5's signer-manager-trait. The claim
;; / settle behavior is fully driven by setters so tests can exercise the
;; reward-claim-registry's ok, empty-cycle, and error branches. Implementing
;; pox-5's signer-manager-trait (a permissive validate-stake! plus register-self)
;; lets the mock be registered with pox-5 as a real signer, so it can stand in as
;; a second signer-manager in update-registration tests.

(use-trait signer-manager-trait 'ST000000000000000000002AMW42H.pox-5.signer-manager-trait)

(impl-trait .reward-claim-traits.reward-claim-signer-manager-trait)
(impl-trait 'ST000000000000000000002AMW42H.pox-5.signer-manager-trait)

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

;; --- pox-5 signer-manager-trait ---

;; Permissive stake validation: accept every stake so a test wallet can hold a
;; genuine pox-5 position under this mock. pox-5 is the only caller.
;; #[allow(unnecessary_public)]
(define-public (validate-stake!
    ;; #[allow(unused_binding)]
    (staker principal)
    ;; #[allow(unused_binding)]
    (first-index uint)
    ;; #[allow(unused_binding)]
    (num-indexes uint)
    ;; #[allow(unused_binding)]
    (amount-ustx uint)
    ;; #[allow(unused_binding)]
    (amount-sats uint)
    ;; #[allow(unused_binding)]
    (is-bond bool)
    ;; #[allow(unused_binding)]
    (signer-calldata (optional (buff 500)))
  )
  (ok true)
)

;; Register this mock as a pox-5 signer: grant its signer key, then register.
;; Mirrors signer-manager.register-self (minus the admin gate); pox-5's
;; register-signer requires the signer contract itself to be the caller, so this
;; must live on the mock rather than be driven directly from a test.
;; #[allow(unchecked_data)]
(define-public (register-self
    (signer-manager <signer-manager-trait>)
    (signer-key (buff 33))
    (auth-id uint)
    (signer-sig (buff 65))
  )
  (begin
    (try! (contract-call? 'ST000000000000000000002AMW42H.pox-5 grant-signer-key
      signer-key current-contract auth-id signer-sig
    ))
    (contract-call? 'ST000000000000000000002AMW42H.pox-5 register-signer
      signer-manager signer-key
    )
  )
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
