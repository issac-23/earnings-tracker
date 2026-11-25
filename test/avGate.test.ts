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

describe("avGate queue cap", () => {
  const never = () => new Promise<void>(() => {});

  it("rejects the call past maxQueue at once with RATE_LIMIT, without waiting", async () => {
    configureAvGate({ maxQueue: 2 });
    let release!: () => void;
    const hold = new Promise<void>((r) => { release = r; });
    const a = avGate(() => hold);
    const b = avGate(async () => "b");
    await expect(avGate(async () => "c")).rejects.toMatchObject({ code: "RATE_LIMIT", message: "Too many lookups at once. Try again in a few seconds." });
    // rejected while `a` is still held open, so it didn't wait for anything
    release();
    await expect(Promise.all([a, b])).resolves.toBeDefined();
  });

  it("the refused call does not disturb the chain", async () => {
    configureAvGate({ maxQueue: 2 });
    const starts: string[] = [];
    const call = (n: string) => avGate(async () => { starts.push(n); });
    const results = await Promise.allSettled([call("a"), call("b"), call("c")]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "rejected"]);
    expect(starts).toEqual(["a", "b"]);
  });

  it("room comes back after tasks finish", async () => {
    configureAvGate({ maxQueue: 2 });
    await Promise.all([avGate(async () => 1), avGate(async () => 2)]);
    await expect(Promise.all([avGate(async () => 3), avGate(async () => 4)])).resolves.toEqual([3, 4]);
  });

  it("room comes back after failing tasks too", async () => {
    configureAvGate({ maxQueue: 2 });
    const boom = () => avGate(async () => { throw new Error("boom"); });
    await Promise.allSettled([boom(), boom()]);
    await expect(Promise.all([avGate(async () => 3), avGate(async () => 4)])).resolves.toEqual([3, 4]);
  });

  it("defaults to 6 and resetAvGate restores the default and the count", async () => {
    const held = Array.from({ length: 6 }, () => avGate(never));
    await expect(avGate(async () => 1)).rejects.toMatchObject({ code: "RATE_LIMIT" });
    resetAvGate();
    configureAvGate({ now: () => clock, sleep: async (ms) => { clock += ms; } });
    await expect(avGate(async () => "fresh")).resolves.toBe("fresh");
    void held;
  });
});
