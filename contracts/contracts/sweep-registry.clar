(use-trait sweeper-signer-manager-trait .sweeper-traits.sweeper-signer-manager-trait)

;; The longest STX lock in PoX-5 is 96 reward cycles, which equals 192 distribution cycles
(define-constant MAX_SWEEP_DISTRIBUTION_CYCLES u192) 
;; The number of max rows returned per get-due-sweeps / get-due-settlements call
(define-constant DUE_PAGE_SIZE u100) 

;; No registration for this staker and signer-manager combination
(define-constant ERR_NOT_REGISTERED (err u600))
;; This staker and signer-manager combination is already registered
(define-constant ERR_ALREADY_REGISTERED (err u601))
;; The registration fee is  too small to buy even one sweep
(define-constant ERR_INSUFFICIENT_FEE (err u602))
;; The caller is not an admin to an admin only function
(define-constant ERR_NOT_ADMIN (err u603))
;; The staker has no active pox-5 position under this signer
(define-constant ERR_NO_CURRENT_POSITION (err u604))
;; The registration fee must be greater than zero
(define-constant ERR_ZERO_FEE (err u605))
;; The registration was already swept this distribution cycle
(define-constant ERR_ALREADY_SWEPT (err u606))
;; This should be unreachable: a registration buys at most 192 sweeps and each sweep
;; adds at most one pending withdrawal, so the 192-slot list can never overflow
(define-constant ERR_TOO_MANY_PENDING (err u607))
;; The request-id is not a tracked pending withdrawal for this key
(define-constant ERR_UNKNOWN_PENDING_WITHDRAWAL (err u608))
;; signer-manager's ERR_NO_CLAIMABLE_REWARDS, matched (not propagated) in
;; perform-sweep-impl so a genuinely empty cycle advances instead of stalling.
(define-constant SM_ERR_NO_CLAIMABLE_REWARDS u1001)

;; A (list 100 uint) whose only job is to bound the get-due-sweeps /
;; get-due-settlements folds to at most DUE_PAGE_SIZE (100) node visits per
;; call. The element values are never read (the fold step ignores `tick`).
(define-constant DUE_TICKS (list
    u0 u0 u0 u0 u0 u0 u0 u0 u0 u0
    u0 u0 u0 u0 u0 u0 u0 u0 u0 u0
    u0 u0 u0 u0 u0 u0 u0 u0 u0 u0
    u0 u0 u0 u0 u0 u0 u0 u0 u0 u0
    u0 u0 u0 u0 u0 u0 u0 u0 u0 u0
    u0 u0 u0 u0 u0 u0 u0 u0 u0 u0
    u0 u0 u0 u0 u0 u0 u0 u0 u0 u0
    u0 u0 u0 u0 u0 u0 u0 u0 u0 u0
    u0 u0 u0 u0 u0 u0 u0 u0 u0 u0
    u0 u0 u0 u0 u0 u0 u0 u0 u0 u0
))

;; The max rows a single get-due-sweeps / get-due-settlements call returns.
;; Off-chain pagination compares a page's length to this to know if more remain.
(define-read-only (get-page-size)
    DUE_PAGE_SIZE
)

;; default to allowing deployer to register as a pool
(define-map admins
    principal
    bool
)
(map-set admins tx-sender true)

(define-data-var fee-per-sweep uint u100000) ;; 0.1 STX, burned per sweep bought at registration
(define-data-var registration-ll-head (optional {
    staker: principal,
    signer-manager: principal,
}) none)
(define-data-var registration-ll-tail (optional {
    staker: principal,
    signer-manager: principal,
}) none)

(define-map registrations
    {
        staker: principal,
        signer-manager: principal,
    }
    {
        bond-index: (optional uint),
        remaining-sweeps: uint,
        next-reward-cycle: uint,
        last-swept-dist-cycle: (optional uint),
    }
)

;; The registration for {staker, signer-manager}, or none if not registered.
(define-read-only (get-registration
        (staker principal)
        (signer-manager principal)
    )
    (map-get? registrations {
        staker: staker,
        signer-manager: signer-manager,
    })
)

(define-map registration-ll
    {
        staker: principal,
        signer-manager: principal,
    }
    {
        prev: (optional {
            staker: principal,
            signer-manager: principal,
        }),
        next: (optional {
            staker: principal,
            signer-manager: principal,
        }),
    }
)

(define-map pending-withdrawals
    {
        staker: principal,
        signer-manager: principal,
    }
    (list 192 uint)
)

(define-map pending-withdrawal-ll
    {
        staker: principal,
        signer-manager: principal,
    }
    {
        prev: (optional {
            staker: principal,
            signer-manager: principal,
        }),
        next: (optional {
            staker: principal,
            signer-manager: principal,
        }),
    }
)
(define-data-var pending-withdrawal-ll-head (optional {
    staker: principal,
    signer-manager: principal,
}) none)
(define-data-var pending-withdrawal-ll-tail (optional {
    staker: principal,
    signer-manager: principal,
}) none)

(define-private (min-uint
        (left uint)
        (right uint)
    )
    (if (<= left right)
        left
        right
    )
)
(define-private (max-uint
        (left uint)
        (right uint)
    )
    (if (>= left right)
        left
        right
    )
)

;; --- Doubly-linked-list maintenance over registration-ll ---
;; The list lets get-due-sweeps walk every live registration without a global
;; index. `registration-ll-head`/`-tail` bound the walk; each node stores its
;; prev/next key. Append is O(1) at the tail; remove splices in O(1). Both are
;; infallible and return bool.

;; Append `key` at the tail (it must not already be in the list). The nested
;; match on the neighbor read avoids a runtime panic: the entry is always
;; present (it is the current tail), and the false arm is unreachable.
;; #[allow(unchecked_data)]
(define-private (ll-append (key {
    staker: principal,
    signer-manager: principal,
}))
    (let ((old-tail (var-get registration-ll-tail)))
        (map-set registration-ll key {
            prev: old-tail,
            next: none,
        })
        (match old-tail
            tail-key
            (match (map-get? registration-ll tail-key)
                tail-links (map-set registration-ll tail-key (merge tail-links { next: (some key) }))
                false
            )
            ;; empty list: this node is also the head
            (var-set registration-ll-head (some key))
        )
        (var-set registration-ll-tail (some key))
    )
)

;; Splice `key` out of the list, fixing up its neighbors' links and the
;; head/tail vars. No-op if `key` isn't in the list.
;; #[allow(unchecked_data)]
(define-private (ll-remove (key {
    staker: principal,
    signer-manager: principal,
}))
    (match (map-get? registration-ll key)
        links (begin
            (match (get prev links)
                prev-key (match (map-get? registration-ll prev-key)
                    prev-links (map-set registration-ll prev-key (merge prev-links { next: (get next links) }))
                    false
                )
                (var-set registration-ll-head (get next links))
            )
            (match (get next links)
                next-key (match (map-get? registration-ll next-key)
                    next-links (map-set registration-ll next-key (merge next-links { prev: (get prev links) }))
                    false
                )
                (var-set registration-ll-tail (get prev links))
            )
            (map-delete registration-ll key)
        )
        false
    )
)

;; --- Doubly-linked-list maintenance over pending-withdrawal-ll ---
;; Same shape as the registration list, but tracking only keys with at least
;; one outstanding withdrawal so get-due-settlements can walk them directly.

;; Append `key` at the tail of the pending-withdrawal list.
;; #[allow(unchecked_data)]
(define-private (pending-ll-append (key {
    staker: principal,
    signer-manager: principal,
}))
    (let ((old-tail (var-get pending-withdrawal-ll-tail)))
        (map-set pending-withdrawal-ll key {
            prev: old-tail,
            next: none,
        })
        (match old-tail
            tail-key (match (map-get? pending-withdrawal-ll tail-key)
                tail-links (map-set pending-withdrawal-ll tail-key (merge tail-links { next: (some key) }))
                false
            )
            (var-set pending-withdrawal-ll-head (some key))
        )
        (var-set pending-withdrawal-ll-tail (some key))
    )
)

;; Splice `key` out of the pending-withdrawal list.
;; #[allow(unchecked_data)]
(define-private (pending-ll-remove (key {
    staker: principal,
    signer-manager: principal,
}))
    (match (map-get? pending-withdrawal-ll key)
        links (begin
            (match (get prev links)
                prev-key (match (map-get? pending-withdrawal-ll prev-key)
                    prev-links (map-set pending-withdrawal-ll prev-key
                        (merge prev-links { next: (get next links) })
                    )
                    false
                )
                (var-set pending-withdrawal-ll-head (get next links))
            )
            (match (get next links)
                next-key (match (map-get? pending-withdrawal-ll next-key)
                    next-links (map-set pending-withdrawal-ll next-key
                        (merge next-links { prev: (get prev links) })
                    )
                    false
                )
                (var-set pending-withdrawal-ll-tail (get prev links))
            )
            (map-delete pending-withdrawal-ll key)
        )
        false
    )
)

;; True if this registration has a sweep left and wasn't swept in
;; `cur-dist-cycle`. The caller passes `cur-dist-cycle` (read once) rather than
;; having this re-read `current-distribution-cycle` per node during a walk.
;; Used by get-due-sweeps.
(define-private (is-due
        (registration {
            remaining-sweeps: uint,
            last-swept-dist-cycle: (optional uint),
            bond-index: (optional uint),
            next-reward-cycle: uint,
        })
        (cur-dist-cycle uint)
    )
    (and
        (> (get remaining-sweeps registration) u0)
        (not (is-eq (get last-swept-dist-cycle registration) (some cur-dist-cycle)))
    )
)

;; The staker's active pox-5 position for `bond-index` (`none` = STX-only
;; stake, `(some n)` = bond n), or `none` if there is no such active
;; position. A staker has at most one active bond and one active STX stake
;; at a time. Returns:
;;   signer             the signer-manager the position is under.
;;   first-reward-cycle the position's first reward cycle, used to set where
;;                      a new registration starts sweeping.
;; Used only at registration; sweeps key off {staker, signer-manager}.
(define-read-only (get-position
        (staker principal)
        (bond-index (optional uint))
    )
    (match bond-index
        idx (match (contract-call? 'ST000000000000000000002AMW42H.pox-5 get-bond-membership staker)
            membership (if (is-eq (get bond-index membership) idx)
                (some {
                    signer: (get signer membership),
                    first-reward-cycle: (contract-call? 'ST000000000000000000002AMW42H.pox-5 bond-period-to-reward-cycle
                        idx
                    ),
                })
                none
            )
            none
        )
        (match (contract-call? 'ST000000000000000000002AMW42H.pox-5 get-staker-info staker)
            info (some {
                signer: (get signer info),
                first-reward-cycle: (get first-reward-cycle info),
            })
            none
        )
    )
)

;; Fold step for get-due-sweeps. From the current `node` it reads that
;; registration, appends a row when it is due, and advances `node` to the
;; next linked-list entry. Once `node` is none (walked past the tail) it is a
;; no-op for the remaining ticks. `cur-dist-cycle` rides in the accumulator so
;; the due check never re-reads it. `tick` is unused: the tick list only
;; bounds the number of iterations.
(define-private (due-sweeps-step
        (tick_ uint)
        (acc {
            node: (optional {
                staker: principal,
                signer-manager: principal,
            }),
            cur-dist-cycle: uint,
            rows: (list 100
                {
                    signer-manager: principal,
                    staker: principal,
                    bond-index: (optional uint),
                    reward-cycle: uint,
                }
            ),
        })
    )
    (match (get node acc)
        key
        (let ((next-node (match (map-get? registration-ll key)
                links (get next links)
                none
            )))
            (match (map-get? registrations key)
                registration
                (if (is-due registration (get cur-dist-cycle acc))
                    (merge acc {
                        node: next-node,
                        rows: (default-to (get rows acc)
                            (as-max-len?
                                (append (get rows acc) {
                                    signer-manager: (get signer-manager key),
                                    staker: (get staker key),
                                    bond-index: (get bond-index registration),
                                    reward-cycle: (get next-reward-cycle registration),
                                })
                                u100
                            )),
                    })
                    (merge acc { node: next-node })
                )
                ;; A live linked-list node with no registration should never
                ;; happen; skip it defensively rather than aborting the read.
                (merge acc { node: next-node })
            )
        )
        ;; Past the tail: nothing left to visit.
        acc
    )
)

;; The keeper's work list. Walks the registration linked list from `cursor`
;; (or the head if none) and returns up to 100 registrations due this
;; distribution cycle: remaining-sweeps > 0 and not yet swept this
;; distribution cycle. Each row:
;;   signer-manager the registration's signer-manager, a plain principal.
;;   staker         the staker.
;;   bond-index     none for an STX stake, (some n) for bond n.
;;   reward-cycle   the cycle this registration's next claim targets.
;; Paginate by passing the last row's {staker, signer-manager} as the next
;; `cursor`; done when a page comes back short.
(define-read-only (get-due-sweeps (cursor (optional {
    staker: principal,
    signer-manager: principal,
})))
    (let (
            ;; Resume just after `cursor` (the last key the caller handled),
            ;; or start at the head on the first page.
            (start (match cursor
                cursor-key (match (map-get? registration-ll cursor-key)
                    links (get next links)
                    none
                )
                (var-get registration-ll-head)
            ))
        )
        ;; DUE_TICKS is the elided (list 100 uint) that bounds the walk to at
        ;; most DUE_PAGE_SIZE node visits per call. `current-distribution-cycle`
        ;; is read once here and threaded through the fold.
        (ok (get rows
            (fold due-sweeps-step DUE_TICKS {
                node: start,
                cur-dist-cycle: (contract-call? 'ST000000000000000000002AMW42H.pox-5 current-distribution-cycle),
                rows: (list),
            })
        ))
    )
)

;; Admin-only. Set the STX fee burned per sweep bought. Affects only
;; registrations created afterward; existing ones keep the sweeps they bought.
(define-public (set-fee-per-sweep (new-fee uint))
    (begin
        (try! (authorize-admin))
        (asserts! (> new-fee u0) ERR_ZERO_FEE)
        (ok (var-set fee-per-sweep new-fee))
    )
)

;; --- Registration lifecycle helpers ---
;; These touch only the registration map and linked list; no STX moves here.
;; The public register / update functions are thin compositions of them.

;; Bookkeeping only. Remove the registration at `key`, splice out its
;; linked-list node, and return the sweeps it had left.
;; #[allow(unchecked_data)]
(define-private (destroy-registration (key {
    staker: principal,
    signer-manager: principal,
}))
    (let ((registration (unwrap! (map-get? registrations key) ERR_NOT_REGISTERED)))
        (map-delete registrations key)
        (ll-remove key)
        (ok (get remaining-sweeps registration))
    )
)

;; Bookkeeping only. Validate the staker's position and create the registration
;; at {staker, signer} with `num-sweeps` sweeps, starting next-reward-cycle at
;; max(first-reward-cycle, current reward cycle). Moves no STX -- the fee is
;; burned by the caller (`register-for-sweep`), or the sweeps are carried from a
;; destroyed registration (`update-registration`). Fails if already registered
;; or the position isn't under `signer`.
(define-private (create-registration
        (staker principal)
        (signer principal)
        (bond-index (optional uint))
        (num-sweeps uint)
    )
    (let (
            (current-reward (contract-call? 'ST000000000000000000002AMW42H.pox-5 current-pox-reward-cycle))
            (position (unwrap! (get-position staker bond-index) ERR_NO_CURRENT_POSITION))
            (key {
                staker: staker,
                signer-manager: signer,
            })
        )
        (asserts! (is-none (map-get? registrations key)) ERR_ALREADY_REGISTERED)
        (asserts! (is-eq signer (get signer position)) ERR_NO_CURRENT_POSITION)
        (asserts! (> num-sweeps u0) ERR_INSUFFICIENT_FEE)
        (map-set registrations key {
            bond-index: bond-index,
            remaining-sweeps: num-sweeps,
            next-reward-cycle: (max-uint (get first-reward-cycle position) current-reward),
            last-swept-dist-cycle: none,
        })
        (ll-append key)
        (ok true)
    )
)

;; Register a staker to be swept once per distribution cycle.
;; Permissionless: `tx-sender` pays `fee` from their own account and may
;; register any staker; the staker must currently be staking in pox-5.
;; Parameters:
;;   staker         the principal being registered.
;;   signer-manager with `staker`, the registration key; must be the signer
;;                  pox-5 reports for the position, and every sweep claims
;;                  from it.
;;   bond-index     none for an STX stake, (some n) for bond n.
;;   fee            STX paid, buying min(fee / fee-per-sweep, 192) sweeps. Only
;;                  the used portion is burned; any sub-fee remainder stays with
;;                  the caller, so the contract never custodies STX.
;; The first sweep targets max(first-reward-cycle, current reward cycle): an
;; already-earning staker starts this cycle (swept the next distribution
;; boundary), a freshly-staked one starts next cycle. Fails if this {staker,
;; signer-manager} is already registered or `fee` buys no sweeps. Returns
;; sweeps bought.
(define-public (register-for-sweep
        (staker principal)
        (signer-manager <sweeper-signer-manager-trait>)
        (bond-index (optional uint))
        (fee uint)
    )
    (let (
            (caller tx-sender)
            (price (var-get fee-per-sweep))
            (num-sweeps (min-uint (/ fee price) MAX_SWEEP_DISTRIBUTION_CYCLES))
        )
        (asserts! (> num-sweeps u0) ERR_INSUFFICIENT_FEE)
        ;; burn only the used portion; the sub-fee remainder never leaves the
        ;; caller, so the contract never holds STX
        (try! (stx-burn? (* num-sweeps price) caller))
        (try! (create-registration staker (contract-of signer-manager) bond-index num-sweeps))
        (print {
            topic: "register-for-sweep",
            staker: staker,
            registrant: caller,
            signer-manager: (contract-of signer-manager),
            bond-index: bond-index,
            num-sweeps: num-sweeps,
            burned: (* num-sweeps price),
        })
        (ok num-sweeps)
    )
)

;; Move the caller's own registration from `old-signer-manager` to
;; `new-signer-manager` for `new-bond-index`, carrying its remaining sweeps
;; across. `new-signer-manager` must be the caller's current pox-5 signer for
;; the new position. No fee, nothing burned -- the sweeps already bought move
;; with the registration. Atomic: a failed create reverts the destroy.
;;
;; WARNING: this forfeits any cycles the old signer still owes but hasn't been
;; swept for; those were only claimable via the old signer. Use once the old
;; signer is drained. Returns sweeps carried over.
(define-public (update-registration
        (old-signer-manager principal)
        (new-signer-manager principal)
        (new-bond-index (optional uint))
    )
    (let (
            (caller tx-sender)
            (carried (try! (destroy-registration {
                staker: caller,
                signer-manager: old-signer-manager,
            })))
        )
        (try! (create-registration caller new-signer-manager new-bond-index carried))
        (print {
            topic: "update-registration",
            staker: caller,
            old-signer-manager: old-signer-manager,
            new-signer-manager: new-signer-manager,
            num-sweeps: carried,
        })
        (ok carried)
    )
)

;; Bookkeeping only. Advance a registration one distribution cycle: mark it
;; swept in `cur-dist-cycle`, decrement remaining-sweeps (deleting the
;; registration, and its linked-list node, at zero), and advance
;; next-reward-cycle by one once cur-reward-cycle has passed it. Shared by the
;; ok and empty-cycle paths of perform-sweep-impl.
;; #[allow(unchecked_data)]
(define-private (advance-registration
        (key {
            staker: principal,
            signer-manager: principal,
        })
        (registration {
            bond-index: (optional uint),
            remaining-sweeps: uint,
            next-reward-cycle: uint,
            last-swept-dist-cycle: (optional uint),
        })
        (cur-reward-cycle uint)
        (cur-dist-cycle uint)
    )
    (if (<= (get remaining-sweeps registration) u1)
        ;; last sweep: drop the registration entirely
        (begin
            (map-delete registrations key)
            (ll-remove key)
        )
        (begin
            (map-set registrations key
                (merge registration {
                    remaining-sweeps: (- (get remaining-sweeps registration) u1),
                    next-reward-cycle: (if (> cur-reward-cycle (get next-reward-cycle registration))
                        (+ (get next-reward-cycle registration) u1)
                        (get next-reward-cycle registration)
                    ),
                    last-swept-dist-cycle: (some cur-dist-cycle),
                })
            )
            true
        )
    )
)

;; The one-claim primitive behind all three sweep entrypoints. Looks up the
;; registration by {staker, (contract-of signer-manager)} -- a signer with no
;; registration for the staker just yields ERR_NOT_REGISTERED, so there's no
;; separate wrong-signer check. `cur-reward-cycle`/`cur-dist-cycle` are passed
;; in rather than re-read, so a batch reads them once; safe because this is
;; private. Asserts the registration has a remaining sweep and wasn't already
;; swept in `cur-dist-cycle`, then calls `claim-staker-rewards` and branches on
;; the result (see the section 3.2 docstring for the full table):
;;   * ok            -- the staker was paid; advance-registration and record any
;;                     withdrawal-request for later settlement.
;;   * ERR_NO_CLAIMABLE_REWARDS (u1001) with pox-5 get-earned == u0 -- a
;;                     genuinely empty cycle; advance past it (no pending) so the
;;                     registration never stalls.
;;   * ERR_NO_CLAIMABLE_REWARDS with get-earned > u0 -- claim-rewards hasn't run;
;;                     return the error so the keeper runs it and retries.
;;   * any other err -- returned unchanged.
;; No STX moves -- the fee was burned at registration.
;; #[allow(unchecked_data)]
(define-private (perform-sweep-impl
        (staker principal)
        (signer-manager <sweeper-signer-manager-trait>)
        (cur-reward-cycle uint)
        (cur-dist-cycle uint)
    )
    (let (
            (key {
                staker: staker,
                signer-manager: (contract-of signer-manager),
            })
            (registration (unwrap! (map-get? registrations key) ERR_NOT_REGISTERED))
            (reward-cycle (get next-reward-cycle registration))
            (bond-index (get bond-index registration))
        )
        (asserts! (> (get remaining-sweeps registration) u0) ERR_NOT_REGISTERED)
        (asserts! (not (is-eq (get last-swept-dist-cycle registration) (some cur-dist-cycle)))
            ERR_ALREADY_SWEPT
        )
        (match (contract-call? signer-manager claim-staker-rewards staker reward-cycle bond-index)
            claim-result
            ;; paid: advance and record any L1 withdrawal for later settlement
            (let ((withdrawal-request (get withdrawal-request claim-result)))
                (advance-registration key registration cur-reward-cycle cur-dist-cycle)
                (match withdrawal-request
                    id (try! (append-pending-withdrawal key id))
                    true
                )
                (print {
                    topic: "perform-sweep",
                    staker: staker,
                    signer-manager: (contract-of signer-manager),
                    reward-cycle: reward-cycle,
                    bond-index: bond-index,
                    earned: (get earned claim-result),
                    withdrawal-request: withdrawal-request,
                })
                (ok withdrawal-request)
            )
            err-code
            ;; nothing to claim: step past the cycle only if the signer's
            ;; rewards for it are already pulled in (get-earned == u0); otherwise
            ;; claim-rewards must run first, so surface the error unchanged
            (if (and
                    (is-eq err-code SM_ERR_NO_CLAIMABLE_REWARDS)
                    (is-eq
                        (contract-call? 'ST000000000000000000002AMW42H.pox-5 get-earned
                            (contract-of signer-manager) reward-cycle bond-index
                        )
                        u0
                    )
                )
                (begin
                    (advance-registration key registration cur-reward-cycle cur-dist-cycle)
                    (print {
                        topic: "perform-sweep",
                        staker: staker,
                        signer-manager: (contract-of signer-manager),
                        reward-cycle: reward-cycle,
                        bond-index: bond-index,
                        nothing-to-claim: true,
                    })
                    (ok none)
                )
                (err err-code)
            )
        )
    )
)

;; Bookkeeping only. Appends `request-id` to key's pending-withdrawals entry
;; (append + as-max-len? back to 192), erroring ERR_TOO_MANY_PENDING if full.
;; Splices key into pending-withdrawal-ll if this is its first pending item.
;; #[allow(unchecked_data)]
(define-private (append-pending-withdrawal
        (key {
            staker: principal,
            signer-manager: principal,
        })
        (request-id uint)
    )
    (let (
            (current (default-to (list) (map-get? pending-withdrawals key)))
            (was-empty (is-eq current (list)))
            (updated (unwrap! (as-max-len? (append current request-id) u192) ERR_TOO_MANY_PENDING))
        )
        (map-set pending-withdrawals key updated)
        (if was-empty
            (pending-ll-append key)
            true
        )
        (ok true)
    )
)

;; Sweep one staker under `signer-manager`. Permissionless. signer-manager
;; must be passed as a trait (claim-staker-rewards dispatches on it and it
;; can't be pulled from the map); the caller learns which from
;; `get-due-sweeps`. Reads pox-5's current cycles and delegates to
;; perform-sweep-impl. Returns the withdrawal request-id, if one was initiated.
;; #[allow(unchecked_data)]
(define-public (perform-sweep
        (staker principal)
        (signer-manager <sweeper-signer-manager-trait>)
    )
    (perform-sweep-impl staker signer-manager
        (contract-call? 'ST000000000000000000002AMW42H.pox-5 current-pox-reward-cycle)
        (contract-call? 'ST000000000000000000002AMW42H.pox-5 current-distribution-cycle)
    )
)

;; Sweep the given `stakers`, each keyed with `signer-manager`. Reads pox-5's
;; current cycles once and threads them through. Skips, without aborting the
;; batch, any staker with no registration under `signer-manager`, one already
;; swept this distribution cycle, or one whose claim fails. One signer-manager
;; per call, since the trait must be a single top-level argument; the keeper
;; builds `stakers` from one signer-manager's group of `get-due-sweeps` rows.
;; Returns the count swept.
(define-public (perform-sweeps
        (signer-manager <sweeper-signer-manager-trait>)
        (stakers (list 100 principal))
    )
    (ok (get swept
        (fold count-sweep stakers {
            signer-manager: signer-manager,
            cur-reward-cycle: (contract-call? 'ST000000000000000000002AMW42H.pox-5 current-pox-reward-cycle),
            cur-dist-cycle: (contract-call? 'ST000000000000000000002AMW42H.pox-5 current-distribution-cycle),
            swept: u0,
        })
    ))
)

;; Fold step for perform-sweeps: match each perform-sweep-impl result so a
;; skip or failure doesn't abort the batch. Returns the count, not the
;; accumulator, which carries the trait and can't be returned.
;; #[allow(unchecked_data)]
(define-private (count-sweep
        (staker principal)
        (state {
            signer-manager: <sweeper-signer-manager-trait>,
            cur-reward-cycle: uint,
            cur-dist-cycle: uint,
            swept: uint,
        })
    )
    (match (perform-sweep-impl staker (get signer-manager state) (get cur-reward-cycle state)
        (get cur-dist-cycle state)
    )
        ok-val (merge state { swept: (+ (get swept state) u1) })
        err-code state
    )
)

;; Fold step for get-due-settlements. Reads the current node's pending
;; request-ids, appends one row carrying the whole list, and advances `node`
;; to the next entry. Every node in pending-withdrawal-ll has a nonempty
;; pending-withdrawals entry (a node is spliced out when its list empties), so
;; no filtering is needed and one row is emitted per node. Once `node` is none
;; it is a no-op. `tick` is unused; it only bounds the iteration count.
;; #[allow(unchecked_data)]
(define-private (due-settlements-step
        (tick_ uint)
        (acc {
            node: (optional {
                staker: principal,
                signer-manager: principal,
            }),
            rows: (list 100
                {
                    staker: principal,
                    signer-manager: principal,
                    request-ids: (list 192 uint),
                }
            ),
        })
    )
    (match (get node acc)
        key
        (let ((next-node (match (map-get? pending-withdrawal-ll key)
                links (get next links)
                none
            )))
            (match (map-get? pending-withdrawals key)
                request-ids
                (merge acc {
                    node: next-node,
                    rows: (default-to (get rows acc)
                        (as-max-len?
                            (append (get rows acc) {
                                staker: (get staker key),
                                signer-manager: (get signer-manager key),
                                request-ids: request-ids,
                            })
                            u100
                        )),
                })
                ;; A linked-list node with no pending entry should never happen;
                ;; skip it defensively rather than aborting the read.
                (merge acc { node: next-node })
            )
        )
        ;; Past the tail: nothing left to visit.
        acc
    )
)

;; The keeper's settlement work list. Walks pending-withdrawal-ll from `cursor`
;; (or the head if none) and returns up to 100 rows, one per
;; {staker, signer-manager} with outstanding withdrawals:
;;   staker, signer-manager  the registration key.
;;   request-ids             every sbtc-registry request-id awaiting settlement
;;                           for that key (up to 192).
;; Every node in the list has a nonempty entry, so unlike get-due-sweeps there
;; is no filtering: each node yields exactly one row, pagination is exact, and
;; a short page reliably means the tail was reached. Includes entries whether
;; or not their parent registration still exists. Paginate by passing the last
;; row's {staker, signer-manager} as the next `cursor`. Doesn't check status
;; itself -- the caller checks sbtc-registry per request-id before deciding
;; whether calling settle-pending-withdrawal is worth the gas.
(define-read-only (get-due-settlements (cursor (optional {
    staker: principal,
    signer-manager: principal,
})))
    (let (
            ;; Resume just after `cursor` (the last key the caller handled), or
            ;; start at the head on the first page.
            (start (match cursor
                cursor-key (match (map-get? pending-withdrawal-ll cursor-key)
                    links (get next links)
                    none
                )
                (var-get pending-withdrawal-ll-head)
            ))
        )
        ;; DUE_TICKS is the elided (list 100 uint) bounding the walk to at most
        ;; DUE_PAGE_SIZE node visits per call.
        (ok (get rows
            (fold due-settlements-step DUE_TICKS {
                node: start,
                rows: (list),
            })
        ))
    )
)

;; Fold step for settle-pending-withdrawal-impl: drops `target` from the list
;; being rebuilt, recording whether it was found.
(define-private (pending-withdrawal-fold-step
        (request-id uint)
        (acc {
            target: uint,
            found: bool,
            kept: (list 192 uint),
        })
    )
    (if (is-eq request-id (get target acc))
        (merge acc { found: true })
        (merge acc { kept: (default-to (get kept acc) (as-max-len? (append (get kept acc) request-id) u192)) })
    )
)

;; Shared by settle-pending-withdrawal and the batch fold below. Reads the
;; pending item's status from sbtc-registry and:
;;   pending (status none)     no-op. Calling early just costs the caller's gas.
;;   accepted (some true)      calls signer-manager::settle-accepted-withdrawal.
;;   rejected (some false)     calls signer-manager::reclaim-failed-withdrawal.
;; Either resolved case removes the request-id from pending-withdrawals (deleting
;; the entry and splicing out of pending-withdrawal-ll if that empties the list).
;; No STX moves. Returns whether it resolved (true) or was still pending (false).
;; #[allow(unchecked_data)]
(define-private (settle-pending-withdrawal-impl
        (staker principal)
        (signer-manager <sweeper-signer-manager-trait>)
        (request-id uint)
    )
    (let (
            (key {
                staker: staker,
                signer-manager: (contract-of signer-manager),
            })
            (current (unwrap! (map-get? pending-withdrawals key) ERR_UNKNOWN_PENDING_WITHDRAWAL))
            (fold-result (fold pending-withdrawal-fold-step current {
                target: request-id,
                found: false,
                kept: (list),
            }))
            (request (unwrap!
                (contract-call? 'SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-registry
                    get-withdrawal-request request-id
                )
                ERR_UNKNOWN_PENDING_WITHDRAWAL
            ))
        )
        (asserts! (get found fold-result) ERR_UNKNOWN_PENDING_WITHDRAWAL)
        (match (get status request)
            accepted (begin
                (if accepted
                    (try! (contract-call? signer-manager settle-accepted-withdrawal request-id))
                    (try! (contract-call? signer-manager reclaim-failed-withdrawal request-id))
                )
                (if (is-eq (get kept fold-result) (list))
                    (begin
                        (map-delete pending-withdrawals key)
                        (pending-ll-remove key)
                    )
                    (map-set pending-withdrawals key (get kept fold-result))
                )
                (print {
                    topic: "settle-pending-withdrawal",
                    staker: staker,
                    signer-manager: (contract-of signer-manager),
                    request-id: request-id,
                    accepted: accepted,
                })
                (ok true)
            )
            (ok false)
        )
    )
)

;; Resolve one pending withdrawal. Reads its status from sbtc-registry and:
;;   pending (status none)     no-op. Calling early just costs the caller's gas.
;;   accepted (some true)      calls signer-manager::settle-accepted-withdrawal.
;;   rejected (some false)     calls signer-manager::reclaim-failed-withdrawal.
;; Either resolved case removes the request-id from pending-withdrawals,
;; splicing out of pending-withdrawal-ll if the list goes empty. Permissionless;
;; the caller pays their own gas and receives nothing. Returns whether it
;; resolved (true) or was still pending (false).
;; #[allow(unchecked_data)]
(define-public (settle-pending-withdrawal
        (staker principal)
        (signer-manager <sweeper-signer-manager-trait>)
        (request-id uint)
    )
    (settle-pending-withdrawal-impl staker signer-manager request-id)
)

;; Batch settle-pending-withdrawal, one signer-manager per call for the same
;; reason as perform-sweeps: the trait must be a single top-level argument.
;; Skips, without aborting the batch, any item not found or still pending.
;; Returns the count resolved.
(define-public (settle-pending-withdrawals
        (signer-manager <sweeper-signer-manager-trait>)
        (items (list 100 {
            staker: principal,
            request-id: uint,
        }))
    )
    (ok (get resolved
        (fold count-settlement items {
            signer-manager: signer-manager,
            resolved: u0,
        })
    ))
)

;; Fold step for settle-pending-withdrawals: match each
;; settle-pending-withdrawal-impl result so a skip or failure doesn't abort
;; the batch. Returns the count, not the accumulator, which carries the
;; trait and can't be returned.
;; #[allow(unchecked_data)]
(define-private (count-settlement
        (item {
            staker: principal,
            request-id: uint,
        })
        (state {
            signer-manager: <sweeper-signer-manager-trait>,
            resolved: uint,
        })
    )
    (match (settle-pending-withdrawal-impl (get staker item) (get signer-manager state)
        (get request-id item)
    )
        did-resolve (merge state { resolved: (+ (get resolved state) (if did-resolve
            u1
            u0
        )) }
        )
        err-code state
    )
)

;;; Admin functions

;; Update the allowed admin principal
;; #[allow(unchecked_data)]
(define-public (update-admin
        (admin principal)
        (enabled bool)
    )
    (begin
        (try! (authorize-admin))
        (print {
            topic: "update-admin",
            admin: admin,
            enabled: enabled,
        })
        (map-set admins admin enabled)
        (ok admin)
    )
)

(define-read-only (is-admin (caller principal))
    (default-to false (map-get? admins caller))
)

(define-private (authorize-admin)
    (ok (asserts! (and (is-eq contract-caller tx-sender) (is-admin tx-sender)) ERR_NOT_ADMIN))
)
