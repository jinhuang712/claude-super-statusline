import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, normalizeConfig } from "../src/core/config.js";
import { DEFAULT_DESKTOP_LINES, DESKTOP_WIDGETS, isDesktopWidget, readDesktopLines } from "../src/core/desktop.js";
import { getWidget } from "../src/core/registry.js";
import { registerBuiltinWidgets } from "../src/widgets/index.js";

describe("readDesktopLines", () => {
  test("falls back to the defaults when the file has no desktop section", () => {
    expect(readDesktopLines({})).toBe(DEFAULT_DESKTOP_LINES);
    expect(readDesktopLines(null)).toBe(DEFAULT_DESKTOP_LINES);
    expect(readDesktopLines({ desktop: { lines: "nope" } })).toBe(DEFAULT_DESKTOP_LINES);
  });

  test("an explicitly empty layout stays empty", () => {
    expect(readDesktopLines({ desktop: { lines: [] } })).toEqual([]);
  });

  test("drops widgets the mod cannot draw and keeps the rest in order", () => {
    const lines = readDesktopLines({
      desktop: {
        lines: [{ left: [{ widget: "git.branch" }, { widget: "usage.windows" }], right: [{ widget: "cost.session" }, "junk"] }],
      },
    });
    expect(lines).toEqual([{ left: [{ widget: "usage.windows" }], right: [{ widget: "cost.session" }] }]);
  });
});

describe("desktop widgets", () => {
  test("every one is a registered widget, so the panel can list it", () => {
    registerBuiltinWidgets();
    for (const id of DESKTOP_WIDGETS) expect(getWidget(id)).toBeDefined();
  });

  test("the default layout only names widgets the mod can draw", () => {
    for (const line of DEFAULT_DESKTOP_LINES) {
      for (const w of [...(line.left ?? []), ...(line.right ?? [])]) expect(isDesktopWidget(w.widget)).toBe(true);
    }
  });
});

describe("config", () => {
  test("a default config carries the default desktop layout", () => {
    expect(DEFAULT_CONFIG.desktop.lines).toBe(DEFAULT_DESKTOP_LINES);
    expect(normalizeConfig({}).desktop.lines).toEqual(DEFAULT_DESKTOP_LINES);
  });

  test("the saved desktop layout replaces the default wholesale, and the terminal lines are untouched", () => {
    const saved = [{ left: [{ widget: "tokens.session" }] }];
    const config = normalizeConfig({ desktop: { lines: saved } });
    expect(config.desktop.lines).toEqual([{ left: [{ widget: "tokens.session" }], right: [] }]);
    expect(config.lines).toEqual(normalizeConfig({}).lines);
  });
});
