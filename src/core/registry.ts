import type { RegisteredWidget, WidgetDefinition, WidgetManifest } from "./types.js";
import { isDesktopWidget } from "./desktop.js";

const widgets = new Map<string, RegisteredWidget>();

export function registerWidget(def: WidgetDefinition<any>, source: RegisteredWidget["source"] = "builtin", sourcePath?: string): void {
  if (!def || typeof def.id !== "string" || !def.id) throw new Error("widget definition needs a string id");
  if (typeof def.render !== "function") throw new Error(`widget ${def.id} has no render()`);
  widgets.set(def.id, { ...def, defaults: def.defaults ?? {}, schema: def.schema ?? { type: "object", properties: {} }, source, sourcePath });
}

export function getWidget(id: string): RegisteredWidget | undefined {
  return widgets.get(id);
}

export function listWidgets(): RegisteredWidget[] {
  return [...widgets.values()].sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
}

export function widgetManifest(): WidgetManifest[] {
  return listWidgets().map((w) => ({
    id: w.id,
    name: w.name,
    description: w.description,
    category: w.category,
    schema: w.schema,
    defaults: w.defaults,
    sample: w.sample,
    source: w.source,
    sourcePath: w.sourcePath,
    desktop: isDesktopWidget(w.id),
  }));
}

/** Test helper. */
export function _resetRegistry(): void {
  widgets.clear();
}
