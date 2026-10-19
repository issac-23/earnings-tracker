import { describe, it, expect } from "vitest";
import { formatDate, formatEps, formatMonthYear, formatPct, formatRevenue } from "@/lib/format";

describe("format", () => {
  it("formatPct", () => {
    expect(formatPct(3.9604)).toBe("+4.0%");
    expect(formatPct(-10)).toBe("-10.0%");
    expect(formatPct(0.04)).toBe("0.0%");
    expect(formatPct(-0.04)).toBe("0.0%");
    expect(formatPct(1.234, 2)).toBe("+1.23%");
    expect(formatPct(null)).toBe("—");
  });
  it("formatEps", () => {
    expect(formatEps(1.05)).toBe("$1.05");
    expect(formatEps(-0.1)).toBe("-$0.10");
    expect(formatEps(null)).toBe("—");
  });
  it("formatRevenue", () => {
    expect(formatRevenue(46_743_000_000)).toBe("$46.7B");
    expect(formatRevenue(812_300_000)).toBe("$812.3M");
    expect(formatRevenue(12_345)).toBe("$12,345");
    expect(formatRevenue(null)).toBe("—");
  });
  it("dates", () => {
    expect(formatMonthYear("2025-07-27")).toBe("Jul 2025");
    expect(formatDate("2025-08-27")).toBe("Aug 27, 2025");
  });
});
