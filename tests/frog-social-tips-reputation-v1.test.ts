import { Cl } from "@stacks/transactions";
import { describe, expect, it } from "vitest";

const deployer = simnet.getAccounts().get("deployer")!;
const alice = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
const bob = "STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6";

describe("frog-social-tips-reputation-v1", () => {
  // Xac nhan tip tra ve err u1 khi tipper khong co du STX trong simnet hien tai.
  it("returns stx-transfer error when tipper has no STX balance in current simnet", () => {
    expect(simnet.callPublicFn("frog-token-v3", "claim", [], alice).result).toBeOk(Cl.uint(1000));
    expect(
      simnet.callPublicFn("frog-social-reputation-v1", "publish-post", [Cl.stringAscii("tips-rep-post-1")], alice).result,
    ).toBeOk(Cl.uint(1));

    const tip = simnet.callPublicFn("frog-social-tips-reputation-v1", "tip-post", [Cl.uint(1), Cl.uint(100000)], bob);
    expect(tip.result).toBeErr(Cl.uint(1));

    const creatorReputation = simnet.callReadOnlyFn(
      "frog-social-tips-reputation-v1",
      "get-creator-reputation",
      [Cl.principal(alice)],
      bob,
    );
    expect(creatorReputation.result).toBeUint(0);
  });

  // Dam bao chi owner moi duoc cap nhat gia tri min-tip-ustx.
  it("allows only owner to update min tip", () => {
    const nonOwner = simnet.callPublicFn("frog-social-tips-reputation-v1", "set-min-tip-ustx", [Cl.uint(200000)], alice);
    expect(nonOwner.result).toBeErr(Cl.uint(500));

    const ownerUpdate = simnet.callPublicFn("frog-social-tips-reputation-v1", "set-min-tip-ustx", [Cl.uint(200000)], deployer);
    expect(ownerUpdate.result).toBeOk(Cl.uint(200000));
  });
});
