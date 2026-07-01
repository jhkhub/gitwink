import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { timeAgo } from "./relativeTime";

// A fixed "now" so the s/m/h boundaries can't flip on real-clock drift.
const BASE = 1_700_000_000; // unix seconds
const DAY = 86_400;
const at = (secondsAgo: number) => timeAgo(BASE - secondsAgo);

describe("timeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE * 1000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts seconds, then minutes, hours, days", () => {
    expect(at(0)).toBe("0s");
    expect(at(59)).toBe("59s");
    expect(at(60)).toBe("1m");
    expect(at(3599)).toBe("59m");
    expect(at(3600)).toBe("1h");
    expect(at(86_399)).toBe("23h");
    expect(at(DAY)).toBe("1d");
    expect(at(6 * DAY)).toBe("6d");
  });

  it("rolls up past a week into w / mo / y (no unbounded NNNd)", () => {
    expect(at(7 * DAY)).toBe("1w");
    expect(at(29 * DAY)).toBe("4w");
    expect(at(30 * DAY)).toBe("1mo");
    expect(at(364 * DAY)).toBe("12mo");
    expect(at(365 * DAY)).toBe("1y");
    expect(at(730 * DAY)).toBe("2y");
  });

  it("clamps future timestamps to 0s", () => {
    expect(timeAgo(BASE + 100)).toBe("0s");
  });
});
