import { describe, it, expect } from "vitest";
import { surprisePct, outcomeOf, baseIndex, computeMove, flagOf } from "@/lib/reactions";
import { STOCK, spyMap } from "./helpers";

describe("surprisePct", () => {
  it("is (actual − estimate) / |estimate| × 100", () => {
    expect(surprisePct(1.05, 1.01)).toBeCloseTo(3.9604, 3);
  });
  it("handles negative estimates", () => {
    expect(surprisePct(-0.1, -0.2)).toBeCloseTo(50, 6);
  });
  it("is null when estimate is 0 or a value is missing", () => {
    expect(surprisePct(1, 0)).toBeNull();
    expect(surprisePct(null, 1)).toBeNull();
    expect(surprisePct(1, null)).toBeNull();
  });
});

describe("outcomeOf", () => {
  it("classifies beat / miss / inline / unknown", () => {
    expect(outcomeOf(1.05, 1.01)).toBe("beat");
    expect(outcomeOf(0.9, 1)).toBe("miss");
    expect(outcomeOf(1, 1)).toBe("inline");
    expect(outcomeOf(1, null)).toBe("unknown");
    expect(outcomeOf(1, 0)).toBe("beat");
  });
});

describe("baseIndex", () => {
  it("AMC: base is the report-date close", () => {
    expect(baseIndex(STOCK, "2025-08-27", "AMC")).toBe(2);
  });
  it("BMO: base is the prior trading day's close", () => {
    expect(baseIndex(STOCK, "2025-08-27", "BMO")).toBe(1);
  });
  it("non-trading report date: base is the last close before it", () => {
    expect(baseIndex(STOCK, "2025-08-30", "AMC")).toBe(4);
    expect(baseIndex(STOCK, "2025-08-30", "BMO")).toBe(4);
  });
  it("null when there is no earlier price", () => {
    expect(baseIndex(STOCK, "2025-08-01", "AMC")).toBeNull();
    expect(baseIndex(STOCK, "2025-08-25", "BMO")).toBeNull();
  });
});

describe("computeMove", () => {
  it("AMC day 1 vs S&P", () => {
    const m = computeMove(STOCK, spyMap(), "2025-08-27", "AMC", 1)!;
    expect(m.stock).toBeCloseTo(5.7692, 3);
    expect(m.spy).toBeCloseTo(1, 6);
    expect(m.excess).toBeCloseTo(4.7692, 3);
  });
  it("BMO day 1 uses the report day as day 1", () => {
    const m = computeMove(STOCK, spyMap(), "2025-08-27", "BMO", 1)!;
    expect(m.stock).toBeCloseTo(1.9608, 3);
    expect(m.spy).toBeCloseTo(0, 6);
  });
  it("counts trading days, skipping the holiday", () => {
    const m = computeMove(STOCK, spyMap(), "2025-08-27", "AMC", 3)!;
    expect(m.stock).toBeCloseTo(0.9615, 3); // Aug 27 → Sep 2
  });
  it("weekend report: day 1 is the next trading day", () => {
    expect(computeMove(STOCK, spyMap(), "2025-08-30", "AMC", 1)!.stock).toBeCloseTo(6.0606, 3);
  });
  it("null when not enough trading days have passed", () => {
    expect(computeMove(STOCK, spyMap(), "2025-09-03", "AMC", 1)!.stock).toBeCloseTo(1.8868, 3);
    expect(computeMove(STOCK, spyMap(), "2025-09-03", "AMC", 3)).toBeNull();
  });
  it("unknown timing behaves like AMC", () => {
    expect(computeMove(STOCK, spyMap(), "2025-08-27", "unknown", 1)).toEqual(
      computeMove(STOCK, spyMap(), "2025-08-27", "AMC", 1),
    );
  });
  it("null when SPY is missing a needed date", () => {
    const spy = spyMap();
    spy.delete("2025-08-28");
    expect(computeMove(STOCK, spy, "2025-08-27", "AMC", 1)).toBeNull();
  });
});

describe("flagOf", () => {
  const up = { stock: 2, spy: 1, excess: 1 };
  const down = { stock: -2, spy: 1, excess: -3 };
  it("flags disagreements between result and reaction", () => {
    expect(flagOf("beat", down)).toBe("beat-but-fell");
    expect(flagOf("miss", up)).toBe("missed-but-rose");
  });
  it("no flag when they agree, are inline, or move is missing", () => {
    expect(flagOf("beat", up)).toBeNull();
    expect(flagOf("inline", down)).toBeNull();
    expect(flagOf("beat", null)).toBeNull();
  });
});
