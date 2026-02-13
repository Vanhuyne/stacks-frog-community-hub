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

;; Moi lan claim se nhan 1000 FROG
(define-constant faucet-amount u1000)
;; Stacks block time ~10 minutes, 24h ~= 144 blocks
;; Dung so block de mo phong cooldown 24h
(define-constant cooldown-blocks u144)

;; Ma loi tra ve theo chuan (err uxxx)
(define-constant err-claim-too-soon (err u200))
(define-constant err-not-sender (err u300))

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
    last (ok (+ (get block last) cooldown-blocks))
    (ok u0)))

(define-read-only (can-claim? (who principal))
  ;; Kiem tra account co du block cooldown de claim tiep hay chua
  (match (map-get? last-claim {account: who})
    last (let ((last-block (get block last)))
           (if (>= stacks-block-height last-block)
               (>= (- stacks-block-height last-block) cooldown-blocks)
               false))
    ;; Chua tung claim -> duoc claim ngay
    true))

;; ---------------------------
;; WRITE FUNCTIONS (co ghi state)
;; ---------------------------

(define-public (claim)
  (begin
    ;; 1) Guard: chua du cooldown thi fail voi err u200
    (asserts! (can-claim? tx-sender) err-claim-too-soon)
    ;; 2) Mint 1000 FROG cho nguoi goi tx
    (try! (ft-mint? frog faucet-amount tx-sender))
    ;; 3) Cap nhat block vua claim de tinh cooldown lan sau
    (map-set last-claim {account: tx-sender} {block: stacks-block-height})
    ;; 4) Return amount vua claim
    (ok faucet-amount)))

;; Transfer token theo chuan SIP-010 style argument
;; memo duoc nhan vao de tuong thich giao dien/SDK, contract nay chua su dung memo
(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    ;; Chi cho phep sender tu ky giao dich cua chinh minh
    (asserts! (is-eq tx-sender sender) err-not-sender)
    ;; Chuyen token, tra ve response tu ft-transfer?
    (ft-transfer? frog amount sender recipient)))
