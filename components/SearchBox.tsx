"use client";

import { useState } from "react";

export function SearchBox({ initial, busy, onSubmit }: { initial: string; busy: boolean; onSubmit: (symbol: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <form
      role="search"
      className="flex w-full gap-2 sm:w-auto"
      onSubmit={(e) => {
        e.preventDefault();
        const v = value.trim().toUpperCase();
        if (v) onSubmit(v);
      }}
    >
      <label htmlFor="ticker" className="sr-only">Ticker symbol</label>
      <input
        id="ticker"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Ticker, e.g. NVDA"
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-lg border border-zinc-500 bg-transparent px-3 py-2 uppercase placeholder:normal-case min-w-0 sm:w-56 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
      />
      <button
        type="submit"
        disabled={busy}
        className="shrink-0 whitespace-nowrap rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
      >
        {busy ? "Loading…" : "Look up"}
      </button>
    </form>
  );
}
