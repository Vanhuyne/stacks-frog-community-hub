import { Cl } from "@stacks/transactions";
import { describe, expect, it } from "vitest";

const deployer = simnet.getAccounts().get("deployer")!;
const alice = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
const bob = "STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6";

describe("frog-social-reputation-v1", () => {
  it("awards publish and like reputation points", () => {
    expect(simnet.callPublicFn("frog-token-v3", "claim", [], alice).result).toBeOk(Cl.uint(1000));
    expect(simnet.callPublicFn("frog-token-v3", "claim", [], bob).result).toBeOk(Cl.uint(1000));

    expect(
      simnet.callPublicFn("frog-social-reputation-v1", "publish-post", [Cl.stringAscii("rep-post-1")], alice).result,
    ).toBeOk(Cl.uint(1));

    const authorRepAfterPublish = simnet.callReadOnlyFn(
      "frog-social-reputation-v1",
      "get-author-reputation",
      [Cl.principal(alice)],
      alice,
    );
    expect(authorRepAfterPublish.result).toBeOk(Cl.uint(10));

    expect(simnet.callPublicFn("frog-social-reputation-v1", "like-post", [Cl.uint(1)], bob).result).toBeOk(Cl.uint(1));

    const authorRepAfterLike = simnet.callReadOnlyFn(
      "frog-social-reputation-v1",
      "get-author-reputation",
      [Cl.principal(alice)],
      alice,
    );
    expect(authorRepAfterLike.result).toBeOk(Cl.uint(12));
  });

  it("enforces owner-only config updates", () => {
    const nonOwner = simnet.callPublicFn("frog-social-reputation-v1", "set-like-fee", [Cl.uint(8)], alice);
    expect(nonOwner.result).toBeErr(Cl.uint(400));

    const ownerUpdate = simnet.callPublicFn("frog-social-reputation-v1", "set-like-fee", [Cl.uint(8)], deployer);
    expect(ownerUpdate.result).toBeOk(Cl.uint(8));
  });
});
