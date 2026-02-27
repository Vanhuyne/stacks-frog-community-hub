import { Cl } from "@stacks/transactions";
import { describe, expect, it } from "vitest";

const deployer = simnet.getAccounts().get("deployer")!;
const alice = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
const bob = "STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6";

describe("frog-social-tips-v1", () => {
  it("returns stx-transfer error when tipper has no STX balance in current simnet", () => {
    expect(simnet.callPublicFn("frog-token-v3", "claim", [], alice).result).toBeOk(Cl.uint(1000));
    expect(
      simnet.callPublicFn("frog-social-v1", "publish-post", [Cl.stringAscii("tips-post-1")], alice).result,
    ).toBeOk(Cl.uint(1));

    const tip = simnet.callPublicFn("frog-social-tips-v1", "tip-post", [Cl.uint(1), Cl.uint(100000)], bob);
    expect(tip.result).toBeErr(Cl.uint(1));

    const creatorReputation = simnet.callReadOnlyFn(
      "frog-social-tips-v1",
      "get-creator-reputation",
      [Cl.principal(alice)],
      bob,
    );
    expect(creatorReputation.result).toBeUint(0);
  });

  it("rejects invalid scenarios and owner-restricted settings", () => {
    const missingPost = simnet.callPublicFn("frog-social-tips-v1", "tip-post", [Cl.uint(99), Cl.uint(100000)], bob);
    expect(missingPost.result).toBeErr(Cl.uint(503));

    expect(simnet.callPublicFn("frog-token-v3", "claim", [], alice).result).toBeOk(Cl.uint(1000));
    expect(
      simnet.callPublicFn("frog-social-v1", "publish-post", [Cl.stringAscii("tips-post-2")], alice).result,
    ).toBeOk(Cl.uint(1));

    const ownTip = simnet.callPublicFn("frog-social-tips-v1", "tip-post", [Cl.uint(1), Cl.uint(100000)], alice);
    expect(ownTip.result).toBeErr(Cl.uint(504));

    const nonOwnerPause = simnet.callPublicFn("frog-social-tips-v1", "set-tipping-paused", [Cl.bool(true)], alice);
    expect(nonOwnerPause.result).toBeErr(Cl.uint(500));

    const ownerPause = simnet.callPublicFn("frog-social-tips-v1", "set-tipping-paused", [Cl.bool(true)], deployer);
    expect(ownerPause.result).toBeOk(Cl.bool(true));

    const pausedTip = simnet.callPublicFn("frog-social-tips-v1", "tip-post", [Cl.uint(1), Cl.uint(100000)], bob);
    expect(pausedTip.result).toBeErr(Cl.uint(501));
  });
});
