import { Cl } from "@stacks/transactions";
import { describe, expect, it } from "vitest";

const deployer = simnet.getAccounts().get("deployer")!;
const alice = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
const bob = "STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6";

describe("frog-dao-nft-v5", () => {
  it("requires username and balance before minting pass", () => {
    const mintWithoutUsername = simnet.callPublicFn("frog-dao-nft-v5", "mint-pass", [], alice);
    expect(mintWithoutUsername.result).toBeErr(Cl.uint(402));

    expect(
      simnet.callPublicFn("frog-dao-nft-v5", "register-username", [Cl.stringAscii("alice")], alice).result,
    ).toBeOk(Cl.stringAscii("alice"));

    const mintWithoutBalance = simnet.callPublicFn("frog-dao-nft-v5", "mint-pass", [], alice);
    expect(mintWithoutBalance.result).toBeErr(Cl.uint(403));

    expect(simnet.callPublicFn("frog-token-v3", "claim", [], alice).result).toBeOk(Cl.uint(1000));

    const mintPass = simnet.callPublicFn("frog-dao-nft-v5", "mint-pass", [], alice);
    expect(mintPass.result).toBeOk(Cl.uint(1));
  });

  it("supports proposal lifecycle: create, vote, execute", () => {
    expect(simnet.callPublicFn("frog-token-v3", "claim", [], alice).result).toBeOk(Cl.uint(1000));
    expect(simnet.callPublicFn("frog-dao-nft-v5", "register-username", [Cl.stringAscii("alice2")], alice).result).toBeOk(
      Cl.stringAscii("alice2"),
    );
    expect(simnet.callPublicFn("frog-dao-nft-v5", "mint-pass", [], alice).result).toBeOk(Cl.uint(1));

    expect(simnet.callPublicFn("frog-dao-nft-v5", "set-voting-period-blocks", [Cl.uint(1)], deployer).result).toBeOk(
      Cl.uint(1),
    );

    const proposal = simnet.callPublicFn(
      "frog-dao-nft-v5",
      "create-proposal",
      [Cl.stringAscii("Upgrade"), Cl.stringAscii("ipfs://proposal-1")],
      alice,
    );
    expect(proposal.result).toBeOk(Cl.uint(1));

    const vote = simnet.callPublicFn("frog-dao-nft-v5", "vote", [Cl.uint(1), Cl.uint(1)], alice);
    expect(vote.result).toBeOk(Cl.uint(1));

    const execute = simnet.callPublicFn("frog-dao-nft-v5", "execute-proposal", [Cl.uint(1)], bob);
    expect(execute.result).toBeOk(Cl.bool(true));
  });

  it("rejects duplicate votes", () => {
    expect(simnet.callPublicFn("frog-token-v3", "claim", [], alice).result).toBeOk(Cl.uint(1000));
    expect(simnet.callPublicFn("frog-dao-nft-v5", "register-username", [Cl.stringAscii("alice3")], alice).result).toBeOk(
      Cl.stringAscii("alice3"),
    );
    expect(simnet.callPublicFn("frog-dao-nft-v5", "mint-pass", [], alice).result).toBeOk(Cl.uint(1));

    expect(
      simnet.callPublicFn(
        "frog-dao-nft-v5",
        "create-proposal",
        [Cl.stringAscii("Proposal"), Cl.stringAscii("ipfs://proposal-2")],
        alice,
      ).result,
    ).toBeOk(Cl.uint(1));

    expect(simnet.callPublicFn("frog-dao-nft-v5", "vote", [Cl.uint(1), Cl.uint(1)], alice).result).toBeOk(Cl.uint(1));

    const secondVote = simnet.callPublicFn("frog-dao-nft-v5", "vote", [Cl.uint(1), Cl.uint(2)], alice);
    expect(secondVote.result).toBeErr(Cl.uint(503));
  });
});
