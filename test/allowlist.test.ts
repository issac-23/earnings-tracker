import { describe, it, expect } from "vitest";
import { parseAllowlist, isAllowed, notAllowedMessage } from "@/lib/allowlist";

describe("parseAllowlist", () => {
  it.each([[undefined], [""], ["   "], [" , ,"]])("treats %j as no restriction", (v) => {
    expect(parseAllowlist(v)).toBeNull();
  });

  it("uppercases, trims and drops empty entries", () => {
    expect(parseAllowlist(" nvda, aapl ,,MSFT ")).toEqual(["NVDA", "AAPL", "MSFT"]);
  });

  it("removes duplicates, keeping first-seen order", () => {
    expect(parseAllowlist("aapl,AAPL, nvda,Aapl")).toEqual(["AAPL", "NVDA"]);
  });
});

describe("isAllowed", () => {
  it("allows everything when there is no list", () => {
    expect(isAllowed("ANY", null)).toBe(true);
  });

  it("allows only listed symbols", () => {
    const list = parseAllowlist("nvda,aapl");
    expect(isAllowed("NVDA", list)).toBe(true);
    expect(isAllowed("TSLA", list)).toBe(false);
  });
});

describe("notAllowedMessage", () => {
  it("names the symbol and lists the tickers", () => {
    expect(notAllowedMessage("NVDA", ["AAPL", "MSFT"])).toBe(
      "NVDA isn't available on this site. Available tickers: AAPL, MSFT.",
    );
  });

  it("lists all 20 when there are 20", () => {
    const list = Array.from({ length: 20 }, (_, i) => `T${i}`);
    expect(notAllowedMessage("X", list)).toContain("T19.");
  });

  it("truncates beyond 20 with an ellipsis", () => {
    const list = Array.from({ length: 21 }, (_, i) => `T${i}`);
    const msg = notAllowedMessage("X", list);
    expect(msg).toContain("T19…");
    expect(msg).not.toContain("T20");
  });
});
