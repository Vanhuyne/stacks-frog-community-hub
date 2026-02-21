;; FROG Social Feed v1 (Hybrid)
;; - Publish post costs 50 FROG
;; - Like post costs 5 FROG
;; - On-chain stores content-hash only

(define-constant contract-owner tx-sender)

(define-constant err-not-owner (err u400))
(define-constant err-invalid-post (err u401))
(define-constant err-post-not-found (err u404))
(define-constant err-already-liked (err u405))
(define-constant err-cannot-like-own-post (err u406))
(define-constant err-invalid-fee (err u407))

(define-data-var treasury principal tx-sender)
(define-data-var post-fee uint u50)
(define-data-var like-fee uint u5)
(define-data-var last-post-id uint u0)

(define-map posts
  {post-id: uint}
  {
    author: principal,
    content-hash: (string-ascii 64),
    created-at: uint,
    like-count: uint
  }
)

(define-map likes
  {post-id: uint, liker: principal}
  {liked: bool}
)

(define-private (is-owner)
  (is-eq tx-sender contract-owner))

(define-private (charge-fee (amount uint) (payer principal))
  (contract-call? .frog-token-v3 transfer amount payer (var-get treasury) none))

(define-read-only (get-social-config)
  (ok {
    treasury: (var-get treasury),
    post-fee: (var-get post-fee),
    like-fee: (var-get like-fee),
    last-post-id: (var-get last-post-id)
  }))

(define-read-only (get-post (post-id uint))
  (ok (map-get? posts {post-id: post-id})))

(define-read-only (has-liked (post-id uint) (who principal))
  (is-some (map-get? likes {post-id: post-id, liker: who})))

(define-read-only (get-frog-balance (who principal))
  (unwrap-panic (contract-call? .frog-token-v3 get-balance who)))

(define-public (publish-post (content-hash (string-ascii 64)))
  (let (
      (hash-len (len content-hash))
      (next-id (+ (var-get last-post-id) u1))
    )
    (asserts! (> hash-len u0) err-invalid-post)
    (try! (charge-fee (var-get post-fee) tx-sender))
    (map-set posts
      {post-id: next-id}
      {
        author: tx-sender,
        content-hash: content-hash,
        created-at: stacks-block-height,
        like-count: u0
      })
    (var-set last-post-id next-id)
    (ok next-id)))

(define-public (like-post (post-id uint))
  (match (map-get? posts {post-id: post-id})
    post
      (begin
        (asserts! (not (is-eq tx-sender (get author post))) err-cannot-like-own-post)
        (asserts! (not (is-some (map-get? likes {post-id: post-id, liker: tx-sender}))) err-already-liked)

        (try! (charge-fee (var-get like-fee) tx-sender))

        (map-set likes {post-id: post-id, liker: tx-sender} {liked: true})
        (map-set posts
          {post-id: post-id}
          {
            author: (get author post),
            content-hash: (get content-hash post),
            created-at: (get created-at post),
            like-count: (+ (get like-count post) u1)
          })
        (ok (+ (get like-count post) u1)))
    err-post-not-found))

(define-public (set-post-fee (amount uint))
  (begin
    (asserts! (is-owner) err-not-owner)
    (asserts! (> amount u0) err-invalid-fee)
    (var-set post-fee amount)
    (ok amount)))

(define-public (set-like-fee (amount uint))
  (begin
    (asserts! (is-owner) err-not-owner)
    (asserts! (> amount u0) err-invalid-fee)
    (var-set like-fee amount)
    (ok amount)))

(define-public (set-treasury (next principal))
  (begin
    (asserts! (is-owner) err-not-owner)
    (var-set treasury next)
    (ok next)))
