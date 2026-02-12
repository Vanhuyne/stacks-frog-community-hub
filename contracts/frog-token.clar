;; Frog FT + Faucet (24h cooldown)

(define-fungible-token frog)

(define-constant token-name "frog")
(define-constant token-symbol "FROG")
(define-constant token-decimals u0)

(define-constant faucet-amount u1000)
;; Stacks block time ~10 minutes, 24h ~= 144 blocks
(define-constant cooldown-blocks u144)

(define-constant err-claim-too-soon (err u200))
(define-constant err-not-sender (err u300))

(define-map last-claim {account: principal} {block: uint})

(define-read-only (get-name)
  (ok token-name))

(define-read-only (get-symbol)
  (ok token-symbol))

(define-read-only (get-decimals)
  (ok token-decimals))

(define-read-only (get-total-supply)
  (ok (ft-get-supply frog)))

(define-read-only (get-balance (who principal))
  (ok (ft-get-balance frog who)))

(define-read-only (get-last-claim (who principal))
  (map-get? last-claim {account: who}))

(define-read-only (get-next-claim-block (who principal))
  (match (map-get? last-claim {account: who})
    last (ok (+ (get block last) cooldown-blocks))
    (ok u0)))

(define-read-only (can-claim? (who principal))
  (match (map-get? last-claim {account: who})
    last (let ((last-block (get block last)))
           (if (>= stacks-block-height last-block)
               (>= (- stacks-block-height last-block) cooldown-blocks)
               false))
    true))

(define-public (claim)
  (begin
    (asserts! (can-claim? tx-sender) err-claim-too-soon)
    (try! (ft-mint? frog faucet-amount tx-sender))
    (map-set last-claim {account: tx-sender} {block: stacks-block-height})
    (ok faucet-amount)))

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) err-not-sender)
    (ft-transfer? frog amount sender recipient)))
