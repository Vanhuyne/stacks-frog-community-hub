import { Cl } from "@stacks/transactions";
import { describe, expect, it } from "vitest";

const deployer = simnet.getAccounts().get("deployer")!;
const alice = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
const bob = "STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6";

describe("frog-social-v1", () => {
  // Dang post va like thanh cong, dong thoi kiem tra phi FROG tru dung cho user va treasury.
  it("publishes and likes a post, charging token fees", () => {
    expect(simnet.callPublicFn("frog-token-v3", "claim", [], alice).result).toBeOk(Cl.uint(1000));
    expect(simnet.callPublicFn("frog-token-v3", "claim", [], bob).result).toBeOk(Cl.uint(1000));

    const publish = simnet.callPublicFn(
      "frog-social-v1",
      "publish-post",
      [Cl.stringAscii("hash-post-1")],
      alice,
    );
    expect(publish.result).toBeOk(Cl.uint(1));

    const like = simnet.callPublicFn("frog-social-v1", "like-post", [Cl.uint(1)], bob);
    expect(like.result).toBeOk(Cl.uint(1));

    const aliceBalance = simnet.callReadOnlyFn("frog-token-v3", "get-balance", [Cl.principal(alice)], alice);
    const bobBalance = simnet.callReadOnlyFn("frog-token-v3", "get-balance", [Cl.principal(bob)], bob);
    const treasuryBalance = simnet.callReadOnlyFn("frog-token-v3", "get-balance", [Cl.principal(deployer)], deployer);

    expect(aliceBalance.result).toBeOk(Cl.uint(950));
    expect(bobBalance.result).toBeOk(Cl.uint(995));
    expect(treasuryBalance.result).toBeOk(Cl.uint(55));
  });

  // Chan like bai cua chinh minh va chan like trung lap tren cung post.
  it("rejects liking own post and duplicate like", () => {
    expect(simnet.callPublicFn("frog-token-v3", "claim", [], alice).result).toBeOk(Cl.uint(1000));
    expect(simnet.callPublicFn("frog-token-v3", "claim", [], bob).result).toBeOk(Cl.uint(1000));
    expect(
      simnet.callPublicFn("frog-social-v1", "publish-post", [Cl.stringAscii("hash-post-2")], alice).result,
    ).toBeOk(Cl.uint(1));

    const ownLike = simnet.callPublicFn("frog-social-v1", "like-post", [Cl.uint(1)], alice);
    expect(ownLike.result).toBeErr(Cl.uint(406));

    expect(simnet.callPublicFn("frog-social-v1", "like-post", [Cl.uint(1)], bob).result).toBeOk(Cl.uint(1));

    const duplicateLike = simnet.callPublicFn("frog-social-v1", "like-post", [Cl.uint(1)], bob);
    expect(duplicateLike.result).toBeErr(Cl.uint(405));
  });

  // Chi owner moi duoc cap nhat cau hinh fee cua social contract.
  it("allows only owner to update fee config", () => {
    const nonOwner = simnet.callPublicFn("frog-social-v1", "set-post-fee", [Cl.uint(99)], alice);
    expect(nonOwner.result).toBeErr(Cl.uint(400));

    const invalidFee = simnet.callPublicFn("frog-social-v1", "set-like-fee", [Cl.uint(0)], deployer);
    expect(invalidFee.result).toBeErr(Cl.uint(407));

    const updateFee = simnet.callPublicFn("frog-social-v1", "set-post-fee", [Cl.uint(75)], deployer);
    expect(updateFee.result).toBeOk(Cl.uint(75));
  });
});
