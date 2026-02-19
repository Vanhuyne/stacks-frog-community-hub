;; FROG DAO NFT (membership pass + simple proposal voting)
;; ------------------------------------------------------------
;; Existing behavior:
;; - User registers a username on-chain.
;; - If user holds at least 1000 FROG (from `frog-token-v3` contract),
;;   user can mint 1 non-transferable NFT "DAO pass".
;;
;; New governance behavior (simple):
;; - DAO pass holders can create proposals for project upgrades.
;; - DAO pass holders can vote yes/no/abstain (1 pass = 1 vote).
;; - Anyone can execute a proposal after voting ends.

(define-constant min-frog-to-mint u1000)
(define-constant pass-mint-fee u99)
(define-constant dao-treasury tx-sender)

(define-constant err-username-taken (err u400))
(define-constant err-username-already-set (err u401))
(define-constant err-username-required (err u402))
(define-constant err-insufficient-frog (err u403))
(define-constant err-pass-already-minted (err u404))

(define-constant err-proposal-not-found (err u500))
(define-constant err-not-member (err u501))
(define-constant err-invalid-choice (err u502))
(define-constant err-already-voted (err u503))
(define-constant err-voting-closed (err u504))
(define-constant err-voting-still-active (err u505))
(define-constant err-proposal-already-finalized (err u506))
(define-constant err-proposal-canceled (err u507))
(define-constant err-not-proposal-author (err u508))
(define-constant err-invalid-period (err u509))
(define-constant err-invalid-quorum (err u510))
(define-constant err-proposal-content-required (err u511))

(define-constant vote-yes u1)
(define-constant vote-no u2)
(define-constant vote-abstain u3)

;; Non-transferable membership NFT
(define-non-fungible-token frog-dao-pass uint)

(define-data-var last-token-id uint u0)

;; Simple governance params
(define-data-var last-proposal-id uint u0)
(define-data-var voting-period-blocks uint u144)
(define-data-var min-votes-quorum uint u1)

;; Username registry (simple, local to this contract)
(define-map username-by-owner {owner: principal} {name: (string-ascii 32)})
(define-map owner-by-username {name: (string-ascii 32)} {owner: principal})

;; Track minted pass per address (one per owner)
(define-map pass-by-owner {owner: principal} {token-id: uint})

;; Proposals for project upgrades
(define-map proposals
  {id: uint}
  {
    creator: principal,
    title: (string-ascii 64),
    details-uri: (string-ascii 160),
    start-block: uint,
    end-block: uint,
    yes-votes: uint,
    no-votes: uint,
    abstain-votes: uint,
    executed: bool,
    canceled: bool
  })

;; 1 member = 1 vote per proposal
(define-map votes {proposal-id: uint, voter: principal} {choice: uint})

(define-private (is-valid-choice (choice uint))
  (or (is-eq choice vote-yes)
      (is-eq choice vote-no)
      (is-eq choice vote-abstain)))

(define-private (is-member (who principal))
  (is-some (map-get? pass-by-owner {owner: who})))

(define-private (is-proposal-active (proposal {
  creator: principal,
  title: (string-ascii 64),
  details-uri: (string-ascii 160),
  start-block: uint,
  end-block: uint,
  yes-votes: uint,
  no-votes: uint,
  abstain-votes: uint,
  executed: bool,
  canceled: bool
}))
  (and
    (not (get executed proposal))
    (not (get canceled proposal))
    (>= stacks-block-height (get start-block proposal))
    (<= stacks-block-height (get end-block proposal))))

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

(define-read-only (get-governance-config)
  (ok {
    voting-period-blocks: (var-get voting-period-blocks),
    min-votes-quorum: (var-get min-votes-quorum),
    last-proposal-id: (var-get last-proposal-id)
  }))

(define-read-only (get-proposal (proposal-id uint))
  (map-get? proposals {id: proposal-id}))

(define-read-only (get-vote (proposal-id uint) (voter principal))
  (map-get? votes {proposal-id: proposal-id, voter: voter}))

(define-read-only (can-vote? (proposal-id uint) (voter principal))
  (match (map-get? proposals {id: proposal-id})
    proposal
      (and
        (is-member voter)
        (is-proposal-active proposal)
        (is-none (map-get? votes {proposal-id: proposal-id, voter: voter})))
    false))

(define-read-only (get-proposal-result (proposal-id uint))
  (let ((proposal (unwrap! (map-get? proposals {id: proposal-id}) err-proposal-not-found)))
    (let ((yes (get yes-votes proposal))
          (no (get no-votes proposal))
          (abstain (get abstain-votes proposal))
          (quorum (var-get min-votes-quorum)))
      (let ((total (+ yes (+ no abstain))))
        (ok {
          yes-votes: yes,
          no-votes: no,
          abstain-votes: abstain,
          total-votes: total,
          quorum: quorum,
          passed: (and (>= total quorum) (> yes no)),
          executed: (get executed proposal),
          canceled: (get canceled proposal),
          active: (is-proposal-active proposal)
        })))))

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

;; Create a proposal (for project upgrades) with title + details URI/hash.
(define-public (create-proposal (title (string-ascii 64)) (details-uri (string-ascii 160)))
  (begin
    (asserts! (is-member tx-sender) err-not-member)
    (asserts! (> (len title) u0) err-proposal-content-required)
    (asserts! (> (len details-uri) u0) err-proposal-content-required)
    (let ((next-id (+ (var-get last-proposal-id) u1))
          (start-block stacks-block-height)
          (end-block (+ stacks-block-height (var-get voting-period-blocks))))
      (map-set proposals
        {id: next-id}
        {
          creator: tx-sender,
          title: title,
          details-uri: details-uri,
          start-block: start-block,
          end-block: end-block,
          yes-votes: u0,
          no-votes: u0,
          abstain-votes: u0,
          executed: false,
          canceled: false
        })
      (var-set last-proposal-id next-id)
      (ok next-id))))

;; Vote choice: u1=yes, u2=no, u3=abstain.
(define-public (vote (proposal-id uint) (choice uint))
  (let ((proposal (unwrap! (map-get? proposals {id: proposal-id}) err-proposal-not-found)))
    (begin
      (asserts! (is-member tx-sender) err-not-member)
      (asserts! (not (get canceled proposal)) err-proposal-canceled)
      (asserts! (not (get executed proposal)) err-proposal-already-finalized)
      (asserts! (is-proposal-active proposal) err-voting-closed)
      (asserts! (is-valid-choice choice) err-invalid-choice)
      (asserts! (is-none (map-get? votes {proposal-id: proposal-id, voter: tx-sender})) err-already-voted)

      (map-set votes {proposal-id: proposal-id, voter: tx-sender} {choice: choice})

      (if (is-eq choice vote-yes)
        (map-set proposals {id: proposal-id} (merge proposal {yes-votes: (+ (get yes-votes proposal) u1)}))
        (if (is-eq choice vote-no)
          (map-set proposals {id: proposal-id} (merge proposal {no-votes: (+ (get no-votes proposal) u1)}))
          (map-set proposals {id: proposal-id} (merge proposal {abstain-votes: (+ (get abstain-votes proposal) u1)}))))
      (ok choice))))

;; Execute proposal after voting ends. Returns whether proposal passed.
(define-public (execute-proposal (proposal-id uint))
  (let ((proposal (unwrap! (map-get? proposals {id: proposal-id}) err-proposal-not-found)))
    (begin
      (asserts! (not (get canceled proposal)) err-proposal-canceled)
      (asserts! (not (get executed proposal)) err-proposal-already-finalized)
      (asserts! (> stacks-block-height (get end-block proposal)) err-voting-still-active)
      (let ((yes (get yes-votes proposal))
            (no (get no-votes proposal))
            (abstain (get abstain-votes proposal))
            (quorum (var-get min-votes-quorum)))
        (let ((total (+ yes (+ no abstain)))
              (passed (and (>= (+ yes (+ no abstain)) quorum) (> yes no))))
          (map-set proposals {id: proposal-id} (merge proposal {executed: true}))
          (ok passed))))))

;; Cancel proposal by creator before execution.
(define-public (cancel-proposal (proposal-id uint))
  (let ((proposal (unwrap! (map-get? proposals {id: proposal-id}) err-proposal-not-found)))
    (begin
      (asserts! (is-eq tx-sender (get creator proposal)) err-not-proposal-author)
      (asserts! (not (get executed proposal)) err-proposal-already-finalized)
      (asserts! (not (get canceled proposal)) err-proposal-canceled)
      (map-set proposals {id: proposal-id} (merge proposal {canceled: true}))
      (ok true))))

;; Optional governance tuning for deployer/owner.
(define-public (set-voting-period-blocks (blocks uint))
  (begin
    (asserts! (is-eq tx-sender dao-treasury) err-not-proposal-author)
    (asserts! (> blocks u0) err-invalid-period)
    (var-set voting-period-blocks blocks)
    (ok blocks)))

(define-public (set-min-votes-quorum (quorum uint))
  (begin
    (asserts! (is-eq tx-sender dao-treasury) err-not-proposal-author)
    (asserts! (> quorum u0) err-invalid-quorum)
    (var-set min-votes-quorum quorum)
    (ok quorum)))
