import { describe, it, expect } from "vitest";
import { buildQuarterRows } from "@/lib/quarters";
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
  });

  it("handles no rows", () => {
    expect(summarize([])).toEqual({
      quartersWithEstimate: 0, beats: 0, avgSurprisePct: null, avgD1Excess: null, beatButFell: 0,
    });
  });
});
