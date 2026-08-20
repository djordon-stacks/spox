import { describe, expect, it } from "vitest";
import {
  feeMicroForClaimCount,
  formatStxFromMicro,
  parseStxToMicro,
  resolveClaimsConfig,
  stacksExplorerContractUrlForConfig,
} from "../src/lib/claims-config";

describe("formatStxFromMicro", () => {
  it("formats whole STX without decimals", () => {
    expect(formatStxFromMicro(2_000_000n)).toBe("2");
  });

  it("trims trailing zeros from fractional STX", () => {
    expect(formatStxFromMicro(250_000n)).toBe("0.25");
  });
});

describe("parseStxToMicro", () => {
  it("round-trips with formatStxFromMicro", () => {
    const micro = 1_234_567n;
    expect(parseStxToMicro(formatStxFromMicro(micro))).toBe(micro);
  });
});

describe("feeMicroForClaimCount", () => {
  it("multiplies claim count by the on-chain rate", () => {
    expect(feeMicroForClaimCount(12n, 250_000n)).toBe(3_000_000n);
  });
});

describe("stacksExplorerContractUrlForConfig", () => {
  const contract =
    "ST2SBXRBJJTH7GV5J93HJ62W2NRRQ46XYBK92Y039.reward-claim-registry";

  it("builds mainnet explorer links", () => {
    const config = resolveClaimsConfig(true, {
      network: "mainnet",
      apiUrl: "https://api.mainnet.hiro.so",
    });
    expect(stacksExplorerContractUrlForConfig(contract, config)).toBe(
      `https://explorer.hiro.so/txid/${contract}`,
    );
  });

  it("builds testnet explorer links", () => {
    const config = resolveClaimsConfig(true, {
      network: "testnet",
      apiUrl: "https://api.testnet.hiro.so",
    });
    expect(stacksExplorerContractUrlForConfig(contract, config)).toBe(
      `https://explorer.hiro.so/txid/${contract}?chain=testnet`,
    );
  });

  it("builds devnet explorer links with the configured API", () => {
    const config = resolveClaimsConfig(true, {
      network: "devnet",
      apiUrl: "http://localhost:3999",
    });
    expect(stacksExplorerContractUrlForConfig(contract, config)).toBe(
      `http://localhost:3020/txid/${contract}?chain=testnet&api=http%3A%2F%2Flocalhost%3A3999&ssr=false`,
    );
  });

  it("returns null for malformed contract ids", () => {
    const config = resolveClaimsConfig(false, {});
    expect(stacksExplorerContractUrlForConfig("", config)).toBeNull();
    expect(stacksExplorerContractUrlForConfig("not-a-contract", config)).toBeNull();
  });
});
