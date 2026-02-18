;; Frog FT + Faucet (24h cooldown)
;; ------------------------------------------------------------
;; FLOW TONG QUAN
;; 1) Deploy contract -> tao FT "frog" va cac hang so cau hinh.
;; 2) Frontend goi cac ham read-only de hien thi balance/cooldown.
;; 3) User goi `claim`:
;;    - Kiem tra co du 24h chua (dua tren block height).
;;    - Neu du dieu kien -> mint 1000 FROG cho tx-sender.
;;    - Luu block vua claim vao map `last-claim`.
;; 4) User goi `transfer`:
;;    - Bat buoc tx-sender phai trung voi sender truyen vao.
;;    - Chuyen token qua `ft-transfer?`.
;; ------------------------------------------------------------

;; Tao fungible token voi asset identifier la `frog`
(define-fungible-token frog)

;; Metadata don gian de frontend doc hien thi
(define-constant token-name "frog")
(define-constant token-symbol "FROG")
(define-constant token-decimals u0)
;; Metadata hosted from this repository (raw GitHub URL).
(define-constant token-uri u"https://raw.githubusercontent.com/Vanhuyne/stacks-frog-faucet/main/metadata/frog-token-v3.metadata.json")

;; Owner la principal deploy contract.
;; Chi owner duoc phep cap nhat tham so faucet.
(define-constant contract-owner tx-sender)

;; Ma loi tra ve theo chuan (err uxxx)
(define-constant err-claim-too-soon (err u200))
(define-constant err-not-sender (err u300))
(define-constant err-not-owner (err u400))
(define-constant err-faucet-paused (err u401))
(define-constant err-invalid-amount (err u402))
(define-constant err-invalid-cooldown (err u403))

;; Config faucet co the cap nhat boi owner
(define-data-var faucet-amount uint u1000)
;; Stacks block time ~10 minutes, 24h ~= 144 blocks
(define-data-var cooldown-blocks uint u144)
(define-data-var faucet-paused bool false)

;; Luu block claim cuoi cung cua tung account
;; key: {account: principal}
;; value: {block: uint}
(define-map last-claim {account: principal} {block: uint})

;; ---------------------------
;; READ-ONLY HELPERS (khong ghi state)
;; ---------------------------

(define-read-only (get-name)
  (ok token-name))

(define-read-only (get-symbol)
  (ok token-symbol))

(define-read-only (get-decimals)
  (ok token-decimals))

;; SIP-010 metadata pointer for wallets/indexers.
(define-read-only (get-token-uri)
  (ok (some token-uri)))

(define-read-only (get-total-supply)
  (ok (ft-get-supply frog)))

(define-read-only (get-balance (who principal))
  (ok (ft-get-balance frog who)))

(define-read-only (get-last-claim (who principal))
  ;; Tra ve (some {block: ...}) neu da claim, nguoc lai la none
  (map-get? last-claim {account: who}))

(define-read-only (get-next-claim-block (who principal))
  ;; Neu da claim -> next = last + cooldown
  ;; Neu chua claim -> tra u0 (co the claim ngay)
  (match (map-get? last-claim {account: who})
    last (ok (+ (get block last) (var-get cooldown-blocks)))
    (ok u0)))

(define-read-only (can-claim? (who principal))
  ;; Kiem tra account co du block cooldown de claim tiep hay chua
  (if (var-get faucet-paused)
      false
  (match (map-get? last-claim {account: who})
    last (let ((last-block (get block last)))
           (if (>= stacks-block-height last-block)
               (>= (- stacks-block-height last-block) (var-get cooldown-blocks))
               false))
    ;; Chua tung claim -> duoc claim ngay
    true)))

(define-read-only (get-faucet-config)
  (ok {
    owner: contract-owner,
    amount: (var-get faucet-amount),
    cooldown: (var-get cooldown-blocks),
    paused: (var-get faucet-paused)
  }))

(define-private (is-owner)
  (is-eq tx-sender contract-owner))

;; ---------------------------
;; WRITE FUNCTIONS (co ghi state)
;; ---------------------------

(define-public (claim)
  (begin
    (asserts! (not (var-get faucet-paused)) err-faucet-paused)
    ;; 1) Guard: chua du cooldown thi fail voi err u200
    (asserts! (can-claim? tx-sender) err-claim-too-soon)
    ;; 2) Mint 1000 FROG cho nguoi goi tx
    (try! (ft-mint? frog (var-get faucet-amount) tx-sender))
    ;; 3) Cap nhat block vua claim de tinh cooldown lan sau
    (map-set last-claim {account: tx-sender} {block: stacks-block-height})
    ;; 4) Return amount vua claim
    (ok (var-get faucet-amount))))

(define-public (set-faucet-paused (paused bool))
  (begin
    (asserts! (is-owner) err-not-owner)
    (var-set faucet-paused paused)
    (ok paused)))

(define-public (set-faucet-amount (amount uint))
  (begin
    (asserts! (is-owner) err-not-owner)
    (asserts! (> amount u0) err-invalid-amount)
    (var-set faucet-amount amount)
    (ok amount)))

(define-public (set-cooldown-blocks (blocks uint))
  (begin
    (asserts! (is-owner) err-not-owner)
    (asserts! (> blocks u0) err-invalid-cooldown)
    (var-set cooldown-blocks blocks)
    (ok blocks)))

;; Transfer token theo chuan SIP-010 style argument
;; memo duoc nhan vao de tuong thich giao dien/SDK, contract nay chua su dung memo
(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    ;; Chi cho phep sender tu ky giao dich cua chinh minh
    (asserts! (is-eq tx-sender sender) err-not-sender)
    ;; Chuyen token, tra ve response tu ft-transfer?
    (ft-transfer? frog amount sender recipient)))
