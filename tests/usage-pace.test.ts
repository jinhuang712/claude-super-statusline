import { describe, expect, test } from "bun:test";
import { weekPace } from "../src/widgets/usage.ts";
import { renderWidget } from "./helpers.ts";

const DAY = 24 * 3600 * 1000;

/** A stdin payload whose 7-day window resets `daysLeft` days from now with `used` percent spent. */
function payload(used: number, daysLeft: number) {
  const now = Date.now();
  return {
    rate_limits: {
      five_hour: { used_percentage: 10, resets_at: Math.floor((now + 3600_000) / 1000) },
      seven_day: { used_percentage: used, resets_at: Math.floor((now + daysLeft * DAY) / 1000) },
    },
  };
}

describe("weekPace", () => {
  test("is the elapsed share of the 7-day window", () => {
    const now = 1_000_000_000_000;
    expect(weekPace(now + 7 * DAY, now)).toBeCloseTo(0, 5); // window just opened
    expect(weekPace(now + 3.5 * DAY, now)).toBeCloseTo(50, 5);
    expect(weekPace(now + 6 * DAY, now)).toBeCloseTo(100 / 7, 5); // one day in: 14.3%
  });

  test("is clamped when the reset is stale or implausibly far away", () => {
    const now = 1_000_000_000_000;
    expect(weekPace(now - DAY, now)).toBe(100);
    expect(weekPace(now + 9 * DAY, now)).toBe(0);
  });
});

describe("usage.windows showPace", () => {
  test("is off by default", async () => {
    expect(await renderWidget(payload(66, 2), { widget: "usage.windows" })).not.toContain("pace");
  });

  test("shows the even-spend share next to the 7d figure only", async () => {
    // 2 days left = 5 of 7 days elapsed = 71%.
    const line = await renderWidget(payload(66, 2), { widget: "usage.windows", options: { showPace: true } });
    expect(line).toContain("66% pace 71%");
    expect(line.match(/pace/g)).toHaveLength(1);
  });
});
