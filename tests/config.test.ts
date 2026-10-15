import { afterAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_CONFIG, loadEffectiveConfig, mergeConfig, migrateGitBranchParts, normalizeConfig, projectConfigPath, writeProjectConfig } from "../src/core/config.ts";
import type { FooterConfig } from "../src/core/types.ts";
import { APP_NAME, LEGACY_APP_NAME } from "../src/data/app-name.ts";

describe("mergeConfig", () => {
  test("objects deep-merge, arrays replace", () => {
    const out = mergeConfig({ a: { x: 1, y: 2 }, list: [1, 2, 3] }, { a: { y: 9 }, list: [7] });
    expect(out).toEqual({ a: { x: 1, y: 9 }, list: [7] });
  });
  test("undefined never overwrites", () => {
    expect(mergeConfig({ a: 1 }, { a: undefined })).toEqual({ a: 1 });
  });
});

describe("normalizeConfig", () => {
  test("fills defaults and drops junk widgets", () => {
    const c = normalizeConfig({ lines: [{ left: [{ widget: "model.badge" }, { nope: 1 } as never, "str" as never] }] });
    expect(c.lines[0]!.left).toEqual([{ widget: "model.badge" }]);
    expect(c.lines[0]!.right).toEqual([]);
    expect(c.separator).toBe(DEFAULT_CONFIG.separator);
    expect(c.columnsOffset).toBe(4);
  });
  test("rejects bad enum values", () => {
    expect(normalizeConfig({ colorLevel: "rainbow" as never }).colorLevel).toBe("auto");
    expect(normalizeConfig({ columnsOffset: -5 }).columnsOffset).toBe(0);
    expect(normalizeConfig({ colorMode: "rainbow" as never }).colorMode).toBe("thresholds");
  });
});

// Up to 0.4.1 the colour mode was a per-widget option; it is now one config-wide setting.
describe("legacy per-widget colorMode", () => {
  const ctxGradient = { widget: "context.bar", options: { colorMode: "gradient", showTokens: true } };
  const usageThresholds = { widget: "usage.windows", options: { colorMode: "thresholds" } };

  test("a widget that asked for the gradient makes the whole config gradient", () => {
    expect(normalizeConfig({ lines: [{ left: [usageThresholds], right: [ctxGradient] }] }).colorMode).toBe("gradient");
  });
  test("only thresholds (or no colorMode at all) stays thresholds", () => {
    expect(normalizeConfig({ lines: [{ left: [usageThresholds] }] }).colorMode).toBe("thresholds");
    expect(normalizeConfig({ lines: [{ left: [{ widget: "context.bar" }] }] }).colorMode).toBe("thresholds");
  });
  test("an explicit top-level colorMode wins over the old widget options", () => {
    expect(normalizeConfig({ colorMode: "thresholds", lines: [{ right: [ctxGradient] }] }).colorMode).toBe("thresholds");
  });
  test("the old widget option is dropped, the widget's other options are kept", () => {
    const c = normalizeConfig({ lines: [{ right: [ctxGradient] }] });
    expect(c.lines[0]!.right).toEqual([{ widget: "context.bar", options: { showTokens: true } }]);
  });
  // The panel saves a diff onto the layer; if only the merged config were lifted, the first save
  // after editing the lines would write lines without the old option and no top-level key.
  test("the layer itself is lifted as it is read, so a panel save keeps the choice", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssp-colormode-"));
    try {
      const file = path.join(dir, "config.json");
      fs.writeFileSync(file, JSON.stringify({ lines: [{ right: [ctxGradient] }] }));
      const eff = loadEffectiveConfig(undefined, { ...process.env, CLAUDE_SUPER_STATUSLINE_CONFIG: file });
      expect(eff.config.colorMode).toBe("gradient");
      expect(eff.layers.find((l) => l.name === "user")!.value!.colorMode).toBe("gradient");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/*
  Config version 2 moved ahead/behind (on by default) and the file stats from git.branch to Changes
  (git.linesChanged). A version-1 statusline must look the same after the upgrade, and the move must
  happen once: a Changes widget removed later must not come back.
*/
describe("migrateGitBranchParts (config version 2)", () => {
  const branch = (options?: Record<string, unknown>) => ({ widget: "git.branch", ...(options ? { options } : {}) });
  // Typed as a plain config, so each case's literal input type doesn't narrow the result.
  const mig = (v: unknown) => migrateGitBranchParts(v as Partial<FooterConfig>);

  test("a lone branch gets a Changes widget with only ↑N ↓N right after it (the old default)", () => {
    const m = mig({ version: 1, lines: [{ left: [{ widget: "project.path" }, branch(), { widget: "model.badge" }] }] });
    expect(m.version).toBe(2);
    expect(m.lines![0]!.left).toEqual([{ widget: "project.path" }, { widget: "git.branch" }, { widget: "git.linesChanged", options: { lines: false, aheadBehind: true } }, { widget: "model.badge" }]);
  });

  test("file stats become files: symbols; both off moves nothing and only strips the options", () => {
    expect(mig({ version: 1, lines: [{ left: [branch({ showFileStats: true, showAheadBehind: false, prefix: "g:" })] }] }).lines![0]!.left).toEqual([
      { widget: "git.branch", options: { prefix: "g:" } },
      { widget: "git.linesChanged", options: { lines: false, files: "symbols" } },
    ]);
    expect(mig({ version: 1, lines: [{ left: [branch({ showAheadBehind: false })] }] }).lines![0]!.left).toEqual([{ widget: "git.branch", options: {} }]);
  });

  test("a Changes widget on the same line (any zone) takes them, keeping its own choices", () => {
    const m = mig({
      version: 1,
      lines: [{ left: [branch({ showFileStats: true })], right: [{ widget: "git.linesChanged", style: { bold: true }, options: { source: "worktree" } }] }],
    });
    expect(m.lines![0]!.left).toEqual([{ widget: "git.branch", options: {} }]);
    expect(m.lines![0]!.right).toEqual([{ widget: "git.linesChanged", style: { bold: true }, options: { source: "worktree", aheadBehind: true, files: "symbols" } }]);
    const own = mig({ version: 1, lines: [{ left: [branch({ showFileStats: true }), { widget: "git.linesChanged", options: { files: "letters", aheadBehind: false } }] }] });
    expect(own.lines![0]!.left![1]).toEqual({ widget: "git.linesChanged", options: { files: "letters", aheadBehind: false } });
  });

  test("a version-2 layer is left alone, so a Changes widget removed on purpose stays removed", () => {
    const v2 = { version: 2 as const, lines: [{ left: [branch()] }] };
    expect(migrateGitBranchParts(v2)).toBe(v2);
  });

  test("a hand-written file without a version counts as version 1; normalizeConfig migrates too", () => {
    expect(normalizeConfig({ lines: [{ left: [branch()] }] }).lines[0]!.left).toHaveLength(2);
  });
});

describe("the explicit config file variable", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ssp-envvar-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = (name: string, separator: string) => {
    const f = path.join(dir, name);
    fs.writeFileSync(f, JSON.stringify({ separator }));
    return f;
  };

  test("the name from before the rename still points at a file", () => {
    const old = file("old.json", " old ");
    expect(loadEffectiveConfig(undefined, { CLAUDE_CODE_SUPER_STATUSLINE_CONFIG: old } as NodeJS.ProcessEnv).config.separator).toBe(" old ");
  });

  test("the new name wins when both are set", () => {
    const env = { CLAUDE_CODE_SUPER_STATUSLINE_CONFIG: file("a.json", " a "), CLAUDE_SUPER_STATUSLINE_CONFIG: file("b.json", " b ") } as NodeJS.ProcessEnv;
    expect(loadEffectiveConfig(undefined, env).config.separator).toBe(" b ");
  });
});

// Project files are never moved (they may be committed to the project's repo): a project that
// has the pre-0.4.0 claude-code-ssp.json keeps reading and saving that one.
describe("project overlay name", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ssp-project-")));
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = (name: string, files: string[]): string => {
    const dir = path.join(root, name);
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(dir, ".claude", f), JSON.stringify({ separator: ` ${f} ` }));
    return dir;
  };

  test("the new name when there is none yet, or when both exist", () => {
    expect(projectConfigPath(project("fresh", []))).toBe(path.join(root, "fresh", ".claude", `${APP_NAME}.json`));
    const both = project("both", [`${APP_NAME}.json`, `${LEGACY_APP_NAME}.json`]);
    expect(loadEffectiveConfig(both).config.separator).toBe(` ${APP_NAME}.json `);
  });

  test("a project with only the old file reads it and saves into it", () => {
    const old = project("old", [`${LEGACY_APP_NAME}.json`]);
    expect(loadEffectiveConfig(old).config.separator).toBe(` ${LEGACY_APP_NAME}.json `);
    expect(writeProjectConfig(old, { separator: " saved " })).toBe(path.join(old, ".claude", `${LEGACY_APP_NAME}.json`));
    expect(fs.readdirSync(path.join(old, ".claude"))).toEqual([`${LEGACY_APP_NAME}.json`]);
    expect(loadEffectiveConfig(old).config.separator).toBe(" saved ");
  });
});
