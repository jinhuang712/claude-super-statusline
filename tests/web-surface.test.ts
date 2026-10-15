/**
 * The panel edits one of two layouts: the terminal statusline (`lines`) or the desktop band
 * (`desktop.lines`). These pin the selectors every editor action goes through (web/src/store.ts).
 */
import { describe, expect, test } from "bun:test";
import { normalizeConfig } from "../src/core/config.ts";
import { hasCenter, layoutMode, linesOf, widgetAt } from "../web/src/store";

const config = normalizeConfig({
  lines: [{ left: [{ widget: "project.path" }], center: [{ widget: "model.badge" }] }],
  desktop: { lines: [{ left: [{ widget: "usage.windows" }], right: [{ widget: "cost.session" }] }] },
}) as Parameters<typeof linesOf>[0];

describe("linesOf", () => {
  test("picks the lines of the surface being edited", () => {
    expect(linesOf(config, "terminal")).toBe(config.lines);
    expect(linesOf(config, "desktop")).toBe(config.desktop.lines);
  });
});

describe("selectors on the desktop surface", () => {
  test("the desktop band is always edited directly, never as a preset", () => {
    expect(layoutMode({ config, customMode: false, surface: "desktop" })).toBe("custom");
  });

  test("it has no center zone, even when the terminal layout uses one", () => {
    expect(hasCenter({ config, surface: "terminal" })).toBe(true);
    expect(hasCenter({ config, surface: "desktop" })).toBe(false);
  });

  test("a selection reads from the surface's own lines", () => {
    const state = { config, surface: "desktop" } as Parameters<typeof widgetAt>[0];
    expect(widgetAt(state, { line: 0, zone: "right", index: 0 })?.widget).toBe("cost.session");
    expect(widgetAt({ ...state, surface: "terminal" }, { line: 0, zone: "right", index: 0 })).toBeNull();
  });
});
