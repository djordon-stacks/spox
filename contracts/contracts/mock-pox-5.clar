;; title: pox-5 (mock)
;; summary: Minimal test stand-in for the pox-5 boot contract. Implements only
;; the read-only views the sweep-registry calls, each backed by a settable
;; var/map so tests can drive cycle numbers, staker positions, and earned
;; amounts. NOT the real pox-5 -- no staking logic lives here.

(define-data-var cur-reward-cycle uint u0)
(define-data-var cur-dist-cycle uint u0)

(define-map staker-info
  principal
  {
    signer: principal,
    first-reward-cycle: uint,
  }
)

(define-map bond-membership
  principal
  {
    bond-index: uint,
    signer: principal,
  }
)

(define-map earned-amounts
  {
    signer: principal,
    reward-cycle: uint,
    bond-index: (optional uint),
  }
  uint
)

;; --- views the sweep-registry consumes ---

(define-read-only (current-pox-reward-cycle)
  (var-get cur-reward-cycle)
)

(define-read-only (current-distribution-cycle)
  (var-get cur-dist-cycle)
)

(define-read-only (get-staker-info (staker principal))
  (map-get? staker-info staker)
)

(define-read-only (get-bond-membership (staker principal))
  (map-get? bond-membership staker)
)

(define-read-only (bond-period-to-reward-cycle (idx uint))
  idx
)

(define-read-only (get-earned
    (signer principal)
    (reward-cycle uint)
    (bond-index (optional uint))
  )
  (default-to u0
    (map-get? earned-amounts {
      signer: signer,
      reward-cycle: reward-cycle,
      bond-index: bond-index,
    })
  )
)

;; --- test setters ---

(define-public (set-reward-cycle (c uint))
  ;; #[allow(unchecked_data)]
  (ok (var-set cur-reward-cycle c))
)

(define-public (set-distribution-cycle (c uint))
  ;; #[allow(unchecked_data)]
  (ok (var-set cur-dist-cycle c))
)

(define-public (set-staker-info
    (staker principal)
    (signer principal)
    (first-reward-cycle uint)
  )
  ;; #[allow(unchecked_data)]
  (ok (map-set staker-info staker {
    signer: signer,
    first-reward-cycle: first-reward-cycle,
  }))
)

(define-public (set-bond-membership
    (staker principal)
    (bond-index uint)
    (signer principal)
  )
  ;; #[allow(unchecked_data)]
  (ok (map-set bond-membership staker {
    bond-index: bond-index,
    signer: signer,
  }))
)

(define-public (set-earned
    (signer principal)
    (reward-cycle uint)
    (bond-index (optional uint))
    (amount uint)
  )
  ;; #[allow(unchecked_data)]
  (ok (map-set earned-amounts {
    signer: signer,
    reward-cycle: reward-cycle,
    bond-index: bond-index,
  } amount))
)
