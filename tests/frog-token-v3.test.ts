import { Cl } from "@stacks/transactions";
import { describe, expect, it } from "vitest";

const deployer = simnet.getAccounts().get("deployer")!;
const alice = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
const bob = "STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6";

describe("frog-token-v3", () => {
  it("claims faucet once and blocks immediate re-claim", () => {
    const firstClaim = simnet.callPublicFn("frog-token-v3", "claim", [], alice);
    expect(firstClaim.result).toBeOk(Cl.uint(1000));

    const secondClaim = simnet.callPublicFn("frog-token-v3", "claim", [], alice);
    expect(secondClaim.result).toBeErr(Cl.uint(200));

    const canClaimNow = simnet.callReadOnlyFn("frog-token-v3", "can-claim?", [Cl.principal(alice)], alice);
    expect(canClaimNow.result).toBeBool(false);
  });

  it("allows owner to pause faucet and rejects claim while paused", () => {
    const pauseByOwner = simnet.callPublicFn("frog-token-v3", "set-faucet-paused", [Cl.bool(true)], deployer);
    expect(pauseByOwner.result).toBeOk(Cl.bool(true));

    const claimWhilePaused = simnet.callPublicFn("frog-token-v3", "claim", [], alice);
    expect(claimWhilePaused.result).toBeErr(Cl.uint(401));
  });

  it("rejects transfer when tx-sender is not the sender argument", () => {
    const claim = simnet.callPublicFn("frog-token-v3", "claim", [], alice);
    expect(claim.result).toBeOk(Cl.uint(1000));

    const invalidTransfer = simnet.callPublicFn(
      "frog-token-v3",
      "transfer",
      [Cl.uint(10), Cl.principal(alice), Cl.principal(bob), Cl.none()],
      bob,
    );
    expect(invalidTransfer.result).toBeErr(Cl.uint(300));
  });
});
