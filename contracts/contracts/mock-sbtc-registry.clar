;; title: sbtc-registry (mock)
;; summary: Minimal test stand-in for the sBTC registry. Only exposes the
;; withdrawal-request status the sweep-registry reads, with a setter so tests
;; can mark a request pending / accepted / rejected.

(define-map withdrawal-requests
  uint
  { status: (optional bool) }
)

;; `status`: none = still pending, (some true) = accepted, (some false) =
;; rejected. Returns none when the request-id is unknown.
(define-read-only (get-withdrawal-request (request-id uint))
  (map-get? withdrawal-requests request-id)
)

;; --- test setter ---

(define-public (set-withdrawal-request
    (request-id uint)
    (status (optional bool))
  )
  ;; #[allow(unchecked_data)]
  (ok (map-set withdrawal-requests request-id { status: status }))
)
