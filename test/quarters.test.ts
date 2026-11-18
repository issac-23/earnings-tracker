import { describe, it, expect } from "vitest";
import { buildQuarterRows } from "@/lib/quarters";
import { revenueSurprisePct } from "@/lib/reactions";
import { summarize } from "@/lib/summary";
import type { EarningsRecord } from "@/lib/types";
import { STOCK, SPY_BARS } from "./helpers";

// Report dates are contrived to land inside the helper price window.
const EARNINGS: EarningsRecord[] = [
  { fiscalDateEnding: "2024-12-31", reportedDate: "2025-08-25", timing: "AMC", reportedEPS: 1.0, estimatedEPS: null },
  { fiscalDateEnding: "2025-06-30", reportedDate: "2025-08-28", timing: "AMC", reportedEPS: 1.05, estimatedEPS: 1.01 },
  { fiscalDateEnding: "2025-03-31", reportedDate: "2025-08-26", timing: "BMO", reportedEPS: 0.9, estimatedEPS: 1.0 },
  { fiscalDateEnding: "2025-09-30", reportedDate: "2025-11-19", timing: "AMC", reportedEPS: null, estimatedEPS: 1.2 },
];
const REVENUE = { "2025-06-30": 46.7e9 };
const rows = () => buildQuarterRows({ earnings: EARNINGS, revenue: REVENUE, stock: STOCK, spy: SPY_BARS });

describe("buildQuarterRows", () => {
  it("sorts newest first and skips unreported quarters", () => {
    expect(rows().map((r) => r.fiscalDateEnding)).toEqual(["2025-06-30", "2025-03-31", "2024-12-31"]);
  });

  it("beat but fell", () => {
    const r = rows()[0];
    expect(r.outcome).toBe("beat");
    expect(r.surprisePct).toBeCloseTo(3.9604, 3);
    expect(r.revenue).toBe(46.7e9);
    expect(r.moves.d1!.stock).toBeCloseTo(-10, 6);
    expect(r.moves.d1!.spy).toBeCloseTo(-0.9901, 3);
    expect(r.moves.d1!.excess).toBeCloseTo(-9.0099, 3);
    expect(r.moves.d3!.stock).toBeCloseTo(-3.6364, 3);
    expect(r.moves.d5).toBeNull();
    expect(r.flag).toBe("beat-but-fell");
  });

  it("missed but rose (BMO)", () => {
    const r = rows()[1];
    expect(r.outcome).toBe("miss");
    expect(r.moves.d1!.excess).toBeCloseTo(2, 6);
    expect(r.flag).toBe("missed-but-rose");
    expect(r.revenue).toBeNull();
  });

  it("missing estimate → unknown, no surprise, no flag", () => {
    const r = rows()[2];
    expect(r.outcome).toBe("unknown");
    expect(r.surprisePct).toBeNull();
    expect(r.flag).toBeNull();
  });

  it("small estimate → no surprise %, dollar surprise instead", () => {
    const r = buildQuarterRows({
      earnings: [{ fiscalDateEnding: "2025-06-30", reportedDate: "2025-08-28", timing: "AMC", reportedEPS: 0.29, estimatedEPS: 0.01 }],
      revenue: {}, stock: STOCK, spy: SPY_BARS,
    })[0];
    expect(r.surprisePct).toBeNull();
    expect(r.surpriseUsd).toBeCloseTo(0.28, 6);
    expect(r.outcome).toBe("beat");
  });

  it("large estimate keeps surprise %, no dollar surprise", () => {
    const r = rows()[0];
    expect(r.surprisePct).not.toBeNull();
    expect(r.surpriseUsd).toBeNull();
  });

  it("respects limit", () => {
    expect(buildQuarterRows({ earnings: EARNINGS, revenue: {}, stock: STOCK, spy: SPY_BARS, limit: 2 })).toHaveLength(2);
  });
});

describe("summarize", () => {
  it("computes the four headline numbers", () => {
    const s = summarize(rows());
    expect(s.quartersWithEstimate).toBe(2);
    expect(s.beats).toBe(1);
    expect(s.avgSurprisePct).toBeCloseTo(-3.0198, 3);
    expect(s.avgD1Excess).toBeCloseTo(-1.67, 2);
    expect(s.beatButFell).toBe(1);
    expect(s.excludedSmallEstimate).toBe(0);
  });

  it("averages surprise % only over quarters that have one, and counts the rest", () => {
    const small: EarningsRecord[] = [
      ...EARNINGS,
      { fiscalDateEnding: "2024-09-30", reportedDate: "2025-08-27", timing: "AMC", reportedEPS: 0.29, estimatedEPS: 0.01 },
      { fiscalDateEnding: "2024-06-30", reportedDate: "2025-08-27", timing: "BMO", reportedEPS: -0.05, estimatedEPS: 0 },
    ];
    const s = summarize(buildQuarterRows({ earnings: small, revenue: REVENUE, stock: STOCK, spy: SPY_BARS }));
    expect(s.avgSurprisePct).toBeCloseTo(-3.0198, 3);
    expect(s.excludedSmallEstimate).toBe(2);
    expect(s.quartersWithEstimate).toBe(4);
    expect(s.beats).toBe(2);
  });

  it("average is null when every estimate is small", () => {
    const only: EarningsRecord[] = [
      { fiscalDateEnding: "2025-06-30", reportedDate: "2025-08-28", timing: "AMC", reportedEPS: 0.29, estimatedEPS: 0.01 },
    ];
    const s = summarize(buildQuarterRows({ earnings: only, revenue: {}, stock: STOCK, spy: SPY_BARS }));
    expect(s.avgSurprisePct).toBeNull();
    expect(s.excludedSmallEstimate).toBe(1);
  });

  it("handles no rows", () => {
    expect(summarize([])).toEqual({
      quartersWithEstimate: 0, beats: 0, avgSurprisePct: null, avgD1Excess: null, beatButFell: 0, excludedSmallEstimate: 0,
    });
  });
});

describe("revenue surprise", () => {
  it("is (actual - estimate) / estimate in percent", () => {
    expect(revenueSurprisePct(110, 100)).toBeCloseTo(10, 9);
    expect(revenueSurprisePct(90, 100)).toBeCloseTo(-10, 9);
    expect(revenueSurprisePct(100, 100)).toBe(0);
  });
  it("is null when either side is missing or the estimate is not positive", () => {
    expect(revenueSurprisePct(null, 100)).toBeNull();
    expect(revenueSurprisePct(100, null)).toBeNull();
    expect(revenueSurprisePct(100, 0)).toBeNull();
    expect(revenueSurprisePct(100, -5)).toBeNull();
  });
});

describe("revenue estimates on quarter rows", () => {
  const build = (revenueEstimates?: Record<string, number>) =>
    buildQuarterRows({ earnings: EARNINGS, revenue: REVENUE, revenueEstimates, stock: STOCK, spy: SPY_BARS });

  it("matches estimates to quarters by exact fiscalDateEnding", () => {
    const r = build({ "2025-06-30": 44.0e9, "2025-03-30": 1, "2025-07-01": 2 }).find((x) => x.fiscalDateEnding === "2025-06-30")!;
    expect(r.revenueEstimate).toBe(44.0e9);
    expect(r.revenueSurprisePct).toBeCloseTo(((46.7e9 - 44.0e9) / 44.0e9) * 100, 9);
    expect(r.revenueOutcome).toBe("beat");
  });

  it("flags a miss and an inline result", () => {
    expect(build({ "2025-06-30": 50e9 })[0].revenueOutcome).toBe("miss");
    expect(build({ "2025-06-30": 46.7e9 })[0].revenueOutcome).toBe("inline");
  });

  it("is unknown with nulls when the estimate or the actual revenue is missing", () => {
    const noEst = build({})[0];
    expect(noEst.revenueEstimate).toBeNull();
    expect(noEst.revenueSurprisePct).toBeNull();
    expect(noEst.revenueOutcome).toBe("unknown");
    expect(build()[0].revenueOutcome).toBe("unknown");
    // 2025-03-31 has an estimate but no actual revenue
    const noActual = build({ "2025-03-31": 1e9 }).find((x) => x.fiscalDateEnding === "2025-03-31")!;
    expect(noActual.revenueEstimate).toBe(1e9);
    expect(noActual.revenueSurprisePct).toBeNull();
    expect(noActual.revenueOutcome).toBe("unknown");
  });

  it("keeps the estimate but gives no surprise when it is not positive", () => {
    const r = build({ "2025-06-30": 0 })[0];
    expect(r.revenueEstimate).toBe(0);
    expect(r.revenueSurprisePct).toBeNull();
    expect(r.revenueOutcome).toBe("unknown");
  });
});
