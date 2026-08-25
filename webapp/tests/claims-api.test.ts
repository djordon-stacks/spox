import { describe, expect, it, vi, afterEach } from "vitest";
import { Cl, cvToHex } from "@stacks/transactions";
import { fetchFeePerClaim, fetchPosition, fetchRegistration, fetchSignerManagerTraitCheck } from "../src/lib/claims-api";
import type { ClaimsConfig } from "../src/lib/claims-config";
import { resolveClaimsConfig } from "../src/lib/claims-config";

function devnetConfig(): ClaimsConfig {
  return resolveClaimsConfig(true, {
    network: "devnet",
    apiUrl: "http://localhost:3999",
    claimsContract: "ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039.reward-claim-registry",
  });
}

function mockFetch(
  impl: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response> | Response | never,
) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("read-only call errors", () => {
  it("reports an unreachable node when the transport fails", async () => {
    mockFetch(() => {
      throw new TypeError("fetch failed");
    });

    await expect(fetchFeePerClaim(devnetConfig(), "ST1234")).rejects.toThrow(
      /Cannot reach the Stacks API at http:\/\/localhost:3999/,
    );
  });

  it("reports a missing contract when the node answers with NoSuchContract", async () => {
    mockFetch(async () =>
      Response.json({
        okay: false,
        cause:
          'RuntimeCheck(NoSuchContract("ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039.reward-claim-registry"))',
      }),
    );

    const result = await fetchFeePerClaim(devnetConfig(), "ST1234").catch(
      (e: unknown) => e,
    );
    expect(result).toBeInstanceOf(Error);
    const error = result as Error;
    expect(error.message).toMatch(/registry contract has not been deployed/i);
    expect(error.message).not.toMatch(/Cannot reach/);
  });

  it("returns the fee when the node answers successfully", async () => {
    // Clarity uint 250000.
    mockFetch(async () =>
      Response.json({
        okay: true,
        result:
          "0x010000000000000000000000000003d090",
      }),
    );

    await expect(fetchFeePerClaim(devnetConfig(), "ST1234")).resolves.toBe(
      250000n,
    );
  });
});

describe("pox-5 position lookup", () => {
  it("loads a bonded position directly from pox-5 without the registry", async () => {
    const signer = "ST1J9R0VMA5GQTW65QVHW1KVSKD7MCGT27X37A551.signer-manager";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          okay: true,
          result: cvToHex(
            Cl.some(
              Cl.tuple({
                "amount-sats": Cl.uint(1),
                "amount-ustx": Cl.uint(1),
                "bond-index": Cl.uint(7),
                "is-l1-lock": Cl.bool(false),
                signer: Cl.principal(signer),
              }),
            ),
          ),
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          okay: true,
          result: cvToHex(Cl.uint(123)),
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const config = devnetConfig();
    config.claimsContract = "";

    await expect(
      fetchPosition(config, "ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039"),
    ).resolves.toEqual({
      signer,
      firstRewardCycle: 123n,
      bondIndex: 7n,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url)).toContain(
        "/ST000000000000000000002AMW42H/pox-5/",
      );
      expect(String(url)).not.toContain("reward-claim-registry");
    }
  });

  it("falls back to the pox-5 STX-only position", async () => {
    const signer = "ST24VB7FBXCBV6P0SRDSPSW0Y2J9XHDXNHW9Q8S7H.signer-manager";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ okay: true, result: cvToHex(Cl.none()) }),
      )
      .mockResolvedValueOnce(
        Response.json({
          okay: true,
          result: cvToHex(
            Cl.some(
              Cl.tuple({
                "amount-ustx": Cl.uint(1),
                "first-reward-cycle": Cl.uint(124),
                "num-cycles": Cl.uint(12),
                signer: Cl.principal(signer),
              }),
            ),
          ),
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchPosition(
        devnetConfig(),
        "ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039",
      ),
    ).resolves.toEqual({
      signer,
      firstRewardCycle: 124n,
      bondIndex: null,
    });
  });

  it("queries mainnet pox-5 when the config network is mainnet", async () => {
    const signer = "SP000000000000000000002Q6VF78.signer-manager";
    const staker = "SP000000000000000000002Q6VF78";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ okay: true, result: cvToHex(Cl.none()) }),
      )
      .mockResolvedValueOnce(
        Response.json({
          okay: true,
          result: cvToHex(
            Cl.some(
              Cl.tuple({
                "amount-ustx": Cl.uint(1),
                "first-reward-cycle": Cl.uint(140),
                "num-cycles": Cl.uint(12),
                signer: Cl.principal(signer),
              }),
            ),
          ),
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const config = resolveClaimsConfig(true, {
      network: "mainnet",
      apiUrl: "https://api.mainnet.hiro.so",
      claimsContract: "",
    });

    await expect(fetchPosition(config, staker)).resolves.toEqual({
      signer,
      firstRewardCycle: 140n,
      bondIndex: null,
    });

    for (const [url] of fetchMock.mock.calls) {
      expect(String(url)).toContain(
        "/SP000000000000000000002Q6VF78/pox-5/",
      );
      expect(String(url)).not.toContain("ST000000000000000000002AMW42H");
    }
  });
});

describe("registry registration lookup", () => {
  it("returns null when get-registration is none", async () => {
    mockFetch(async () =>
      Response.json({ okay: true, result: cvToHex(Cl.none()) }),
    );

    await expect(
      fetchRegistration(
        devnetConfig(),
        "ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039",
        "ST24VB7FBXCBV6P0SRDSPSW0Y2J9XHDXNHW9Q8S7H.signer-manager",
      ),
    ).resolves.toBeNull();
  });

  it("parses a registration tuple and the matching Bitcoin height", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          okay: true,
          result: cvToHex(
            Cl.some(
              Cl.tuple({
                "bond-index": Cl.some(Cl.uint(7)),
                "remaining-claims": Cl.uint(12),
                "one-claim-per-reward-cycle": Cl.bool(false),
                "next-claim-distribution": Cl.uint(240),
                "prepaid-ustx": Cl.uint(1_200_000),
              }),
            ),
          ),
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          okay: true,
          result: cvToHex(Cl.uint(850_100)),
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchRegistration(
        devnetConfig(),
        "ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039",
        "ST24VB7FBXCBV6P0SRDSPSW0Y2J9XHDXNHW9Q8S7H.signer-manager",
      ),
    ).resolves.toEqual({
      bondIndex: 7n,
      remainingClaims: 12n,
      oneClaimPerCycle: false,
      nextClaimDistribution: 240n,
      nextClaimBurnHeight: 850_100n,
      prepaidUstx: 1_200_000n,
    });

    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "/ST000000000000000000002AMW42H/pox-5/distribution-cycle-to-burn-height",
    );
    const heightBody = JSON.parse(
      String(fetchMock.mock.calls[1]?.[1]?.body ?? "{}"),
    ) as { arguments?: string[] };
    expect(heightBody.arguments?.[0]).toBe(cvToHex(Cl.uint(241)));
  });
});

describe("signer-manager trait check", () => {
  const validSigner =
    "ST3TB3AJ0XMZ9S6CGY2CQ6R06H1Z6DJQ1SK5QGMWP.signer-manager-4";

  it("returns supported when the node reports trait implementation", async () => {
    mockFetch(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        "http://localhost:3999/v2/traits/ST3TB3AJ0XMZ9S6CGY2CQ6R06H1Z6DJQ1SK5QGMWP/signer-manager-4/ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039/reward-claim-registry/reward-claim-signer-manager-trait",
      );
      return Response.json({ is_implemented: true });
    });

    await expect(
      fetchSignerManagerTraitCheck(devnetConfig(), validSigner),
    ).resolves.toBe("supported");
  });

  it("returns not-implemented when the contract exists but lacks the trait", async () => {
    mockFetch(async () => Response.json({ is_implemented: false }));

    await expect(
      fetchSignerManagerTraitCheck(devnetConfig(), validSigner),
    ).resolves.toBe("not-implemented");
  });

  it("returns not-found on HTTP 404", async () => {
    mockFetch(async () => new Response(null, { status: 404 }));

    await expect(
      fetchSignerManagerTraitCheck(devnetConfig(), validSigner),
    ).resolves.toBe("not-found");
  });

  it("returns null for incomplete contract principals without calling the API", async () => {
    const fetchMock = vi.fn();
    mockFetch(fetchMock);

    await expect(
      fetchSignerManagerTraitCheck(devnetConfig(), "ST3TB.signer-manager"),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
