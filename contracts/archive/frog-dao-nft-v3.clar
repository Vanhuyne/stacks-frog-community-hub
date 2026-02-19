;; FROG DAO NFT (membership pass)
;; ------------------------------------------------------------
;; Idea:
;; - User registers a username on-chain.
;; - If user holds at least 1000 FROG (from `frog-token-v3` contract),
;;   user can mint 1 non-transferable NFT "DAO pass".
;; - This NFT can be used later for DAO gating.

(define-constant min-frog-to-mint u1000)
(define-constant pass-mint-fee u99)
(define-constant dao-treasury tx-sender)

(define-constant err-username-taken (err u400))
(define-constant err-username-already-set (err u401))
(define-constant err-username-required (err u402))
(define-constant err-insufficient-frog (err u403))
(define-constant err-pass-already-minted (err u404))

;; Non-transferable membership NFT
(define-non-fungible-token frog-dao-pass uint)

(define-data-var last-token-id uint u0)

;; Username registry (simple, local to this contract)
(define-map username-by-owner {owner: principal} {name: (string-ascii 32)})
(define-map owner-by-username {name: (string-ascii 32)} {owner: principal})

;; Track minted pass per address (one per owner)
(define-map pass-by-owner {owner: principal} {token-id: uint})

(define-read-only (get-last-token-id)
  (ok (var-get last-token-id)))

(define-read-only (get-username (who principal))
  (map-get? username-by-owner {owner: who}))

(define-read-only (get-owner-by-username (name (string-ascii 32)))
  (map-get? owner-by-username {name: name}))

(define-read-only (get-pass-id (who principal))
  (map-get? pass-by-owner {owner: who}))

(define-read-only (has-pass? (who principal))
  (is-some (map-get? pass-by-owner {owner: who})))

;; Helper: read FROG balance from frog-token-v3 contract.
(define-read-only (get-frog-balance (who principal))
  (unwrap-panic (contract-call? .frog-token-v3 get-balance who)))

(define-read-only (is-eligible-to-mint? (who principal))
  (and
    (is-some (map-get? username-by-owner {owner: who}))
    (>= (get-frog-balance who) min-frog-to-mint)
    (is-none (map-get? pass-by-owner {owner: who}))))

(define-read-only (get-pass-mint-fee)
  (ok pass-mint-fee))

(define-read-only (get-dao-treasury)
  (ok dao-treasury))

;; Register a username (one per address, unique)
(define-public (register-username (name (string-ascii 32)))
  (begin
    (asserts! (is-none (map-get? owner-by-username {name: name})) err-username-taken)
    (asserts! (is-none (map-get? username-by-owner {owner: tx-sender})) err-username-already-set)
    (map-set username-by-owner {owner: tx-sender} {name: name})
    (map-set owner-by-username {name: name} {owner: tx-sender})
    (ok name)))

;; Mint one non-transferable DAO pass NFT
(define-public (mint-pass)
  (begin
    (asserts! (is-some (map-get? username-by-owner {owner: tx-sender})) err-username-required)
    (asserts! (>= (unwrap-panic (contract-call? .frog-token-v3 get-balance tx-sender)) min-frog-to-mint) err-insufficient-frog)
    (asserts! (is-none (map-get? pass-by-owner {owner: tx-sender})) err-pass-already-minted)
    (try! (contract-call? .frog-token-v3 transfer pass-mint-fee tx-sender dao-treasury none))

    (let ((next-id (+ (var-get last-token-id) u1)))
      (try! (nft-mint? frog-dao-pass next-id tx-sender))
      (var-set last-token-id next-id)
      (map-set pass-by-owner {owner: tx-sender} {token-id: next-id})
      (ok next-id))))
