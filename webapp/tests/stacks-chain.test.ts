import { describe, expect, it, vi, afterEach } from "vitest";
import {
  burnTipPollIntervalMs,
  fetchStacksNodeInfo,
} from "../src/lib/stacks-chain";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("burnTipPollIntervalMs", () => {
  it("polls mainnet more slowly than test networks", () => {
    expect(burnTipPollIntervalMs("mainnet")).toBe(5 * 60_000);
    expect(burnTipPollIntervalMs("testnet")).toBe(3 * 60_000);
    expect(burnTipPollIntervalMs("devnet")).toBe(3 * 60_000);
  });
});

describe("fetchStacksNodeInfo", () => {
  it("reads burn_block_height from /v2/info", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          burn_block_height: 963488,
          stacks_tip_height: 8816420,
        }),
      ),
    );

    await expect(
      fetchStacksNodeInfo({ apiUrl: "https://api.mainnet.hiro.so" }),
    ).resolves.toEqual({
      burnBlockHeight: 963488,
      stacksTipHeight: 8816420,
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.mainnet.hiro.so/v2/info",
    );
  });
});
