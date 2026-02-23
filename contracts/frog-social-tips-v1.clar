;; FROG Social Tips v1
;; - Trustless STX tipping for frog-social-v1 posts
;; - Tracks totals per post, per tipper, and per creator

(define-constant contract-owner tx-sender)

(define-constant err-not-owner (err u500))
(define-constant err-tip-paused (err u501))
(define-constant err-invalid-tip-amount (err u502))
(define-constant err-post-not-found (err u503))
(define-constant err-cannot-tip-own-post (err u504))

(define-data-var tipping-paused bool false)
(define-data-var min-tip-ustx uint u100000)

(define-map post-tip-stats
  {post-id: uint}
  {
    total-tip-ustx: uint,
    tip-count: uint,
    updated-at: uint
  }
)

(define-map tipper-tip-stats
  {post-id: uint, tipper: principal}
  {
    total-tip-ustx: uint,
    tip-count: uint,
    last-tip-at: uint
  }
)

(define-map creator-tip-stats
  {creator: principal}
  {
    total-received-ustx: uint,
    tip-count: uint,
    reputation-score: uint,
    updated-at: uint
  }
)

(define-private (is-owner)
  (is-eq tx-sender contract-owner))

(define-private (get-post-author (post-id uint))
  (let ((post-opt (unwrap-panic (contract-call? .frog-social-v1 get-post post-id))))
    (if (is-some post-opt)
      (some (get author (unwrap-panic post-opt)))
      none)))

(define-read-only (get-tip-config)
  {
    paused: (var-get tipping-paused),
    min-tip-ustx: (var-get min-tip-ustx)
  })

(define-read-only (get-post-tip-stats (post-id uint))
  (default-to
    {
      total-tip-ustx: u0,
      tip-count: u0,
      updated-at: u0
    }
    (map-get? post-tip-stats {post-id: post-id})))

(define-read-only (get-tipper-tip-stats (post-id uint) (tipper principal))
  (default-to
    {
      total-tip-ustx: u0,
      tip-count: u0,
      last-tip-at: u0
    }
    (map-get? tipper-tip-stats {post-id: post-id, tipper: tipper})))

(define-read-only (get-creator-tip-stats (creator principal))
  (default-to
    {
      total-received-ustx: u0,
      tip-count: u0,
      reputation-score: u0,
      updated-at: u0
    }
    (map-get? creator-tip-stats {creator: creator})))

(define-read-only (get-creator-reputation (creator principal))
  (get reputation-score (get-creator-tip-stats creator)))

(define-public (tip-post (post-id uint) (amount-ustx uint))
  (begin
    (asserts! (not (var-get tipping-paused)) err-tip-paused)
    (asserts! (>= amount-ustx (var-get min-tip-ustx)) err-invalid-tip-amount)

    (match (get-post-author post-id)
      author
        (begin
          (asserts! (not (is-eq tx-sender author)) err-cannot-tip-own-post)
          (try! (stx-transfer? amount-ustx tx-sender author))

          (let (
              (post-current (get-post-tip-stats post-id))
              (tipper-current (get-tipper-tip-stats post-id tx-sender))
              (creator-current (get-creator-tip-stats author))
              (next-post-total (+ (get total-tip-ustx post-current) amount-ustx))
              (next-post-count (+ (get tip-count post-current) u1))
              (next-tipper-total (+ (get total-tip-ustx tipper-current) amount-ustx))
              (next-tipper-count (+ (get tip-count tipper-current) u1))
              (next-creator-total (+ (get total-received-ustx creator-current) amount-ustx))
              (next-creator-count (+ (get tip-count creator-current) u1))
              (next-score (+ next-creator-count (/ next-creator-total u1000000)))
            )
            (map-set post-tip-stats
              {post-id: post-id}
              {
                total-tip-ustx: next-post-total,
                tip-count: next-post-count,
                updated-at: stacks-block-height
              })
            (map-set tipper-tip-stats
              {post-id: post-id, tipper: tx-sender}
              {
                total-tip-ustx: next-tipper-total,
                tip-count: next-tipper-count,
                last-tip-at: stacks-block-height
              })
            (map-set creator-tip-stats
              {creator: author}
              {
                total-received-ustx: next-creator-total,
                tip-count: next-creator-count,
                reputation-score: next-score,
                updated-at: stacks-block-height
              })
            (ok {
              recipient: author,
              total-tip-ustx: next-post-total,
              tip-count: next-post-count
            })))
      err-post-not-found)))

(define-public (set-tipping-paused (paused bool))
  (begin
    (asserts! (is-owner) err-not-owner)
    (var-set tipping-paused paused)
    (ok paused)))

(define-public (set-min-tip-ustx (amount uint))
  (begin
    (asserts! (is-owner) err-not-owner)
    (asserts! (> amount u0) err-invalid-tip-amount)
    (var-set min-tip-ustx amount)
    (ok amount)))
