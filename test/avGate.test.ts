import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { avGate, configureAvGate, resetAvGate } from "@/lib/avGate";

// A fake clock: sleeping just advances time, so nothing really waits.
let clock: number;
let slept: number[];
beforeEach(() => {
  clock = 1_000_000;
  slept = [];
  configureAvGate({
    spacingMs: 1500,
    now: () => clock,
    sleep: async (ms) => { slept.push(ms); clock += ms; },
  });
});
afterEach(() => resetAvGate());

describe("avGate", () => {
  it("does not wait before the very first call", async () => {
    await avGate(async () => "ok");
    expect(slept).toEqual([]);
  });

  it("starts concurrent calls at least the interval apart, in order", async () => {
    const starts: [string, number][] = [];
    const call = (name: string) => avGate(async () => { starts.push([name, clock]); });
    await Promise.all([call("a"), call("b"), call("c")]);
    expect(starts.map(([n]) => n)).toEqual(["a", "b", "c"]);
    expect(starts[1][1] - starts[0][1]).toBeGreaterThanOrEqual(1500);
    expect(starts[2][1] - starts[1][1]).toBeGreaterThanOrEqual(1500);
  });

  it("only waits for the remainder of the interval", async () => {
    await avGate(async () => {});
    clock += 1000;
    await avGate(async () => {});
    expect(slept).toEqual([500]);
  });

  it("a failed call does not stall later calls", async () => {
    await expect(avGate(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(avGate(async () => "next")).resolves.toBe("next");
    expect(slept).toEqual([1500]);
  });
});
