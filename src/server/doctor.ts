import { listLiveSamples } from "../core/capture.js";
import { loadEffectiveConfig } from "../core/config.js";
import { buildContext } from "../core/context.js";
import { render } from "../core/layout.js";
import { loadPlugins } from "../core/plugins.js";
import { listWidgets } from "../core/registry.js";
import { registerBuiltinWidgets } from "../widgets/index.js";
import { settingsPath } from "./install.js";
import * as fs from "node:fs";

export async function doctor(): Promise<void> {
  registerBuiltinWidgets();
  const cwd = process.cwd();
  const { config, layers } = loadEffectiveConfig(cwd);
  console.log("# claude-super-statusline doctor\n");
  console.log("## Config layers");
  for (const l of layers) console.log(`- ${l.name}: ${l.path ?? "(built-in)"} ${l.exists ? "✓" : "✗ missing"}${l.error ? ` — ERROR ${l.error}` : ""}`);
  console.log(`\n## Plugins`);
  const plugins = await loadPlugins(config, cwd);
  for (const d of plugins.dirs) console.log(`- dir: ${d}`);
  for (const p of plugins.loaded) console.log(`- loaded ${p.file}: ${p.ids.join(", ")}`);
  for (const e of plugins.errors) console.log(`- ERROR ${e.file}: ${e.message}`);
  for (const s of plugins.skipped) console.log(`- skipped ${s.dir}: ${s.reason}`);
  console.log(`\n## Widgets (${listWidgets().length})`);
  console.log(listWidgets().map((w) => `${w.id}${w.source === "plugin" ? " (plugin)" : ""}`).join(", "));
  console.log(`\n## settings.json`);
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as { statusLine?: unknown };
    console.log(JSON.stringify(s.statusLine ?? null, null, 2));
  } catch (err) {
    console.log(`cannot read: ${(err as Error).message}`);
  }
  const samples = listLiveSamples();
  console.log(`\n## Live samples (${samples.length})`);
  for (const s of samples.slice(0, 5)) console.log(`- ${s.id}: ${s.label}`);
  if (samples[0]) {
    console.log(`\n## Render against latest sample`);
    const ctx = await buildContext(structuredClone(samples[0].payload) as never, config, { columns: 120 });
    const out = render(config, ctx);
    for (const line of out.lines) console.log(line);
    console.log(`\nrender: ${out.ms.toFixed(1)}ms, errors: ${out.errors.length}`);
    for (const e of out.errors) console.log(`- ${e.widget}: ${e.message}`);
  }
}
