import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, type WidgetInstance, type WidgetManifest } from "../api";
import { CAT_COLOR } from "../colors";
import { TRAY_DROP_ID, TRAY_PREFIX } from "../collision";
import { RETIRED } from "../retired";
import { useT, widgetDesc, widgetName } from "../i18n";
import { linesOf, useStore } from "../store";

/**
 * Tray groups, in reading order, and the widget categories each one gathers. The tray only lists
 * *unused* widgets, so a narrow category (project, cost…) was often down to a single item once its
 * siblings were placed — a one-item category is no grouping at all. Related categories share a
 * group instead; anything not listed (a plugin's own category) goes to "misc".
 */
const GROUPS: Array<{ id: TrayGroup; categories: string[] }> = [
  { id: "projectGit", categories: ["project", "git"] },
  { id: "modelContext", categories: ["model", "context"] },
  { id: "usageCost", categories: ["usage", "tokens", "cost"] },
  { id: "session", categories: ["session"] },
  { id: "activity", categories: ["activity"] },
  { id: "environment", categories: ["environment"] },
  { id: "misc", categories: ["misc"] },
];
type TrayGroup = "projectGit" | "modelContext" | "usageCost" | "session" | "activity" | "environment" | "misc";
const groupOf = (category: string): TrayGroup => GROUPS.find((g) => g.categories.includes(category))?.id ?? "misc";

/**
 * Widgets meant to be placed more than once, each with its own text / variable / URL. They stay in
 * the tray after use; every other widget leaves it once it is in the layout (a second project path
 * would only repeat the first).
 */
const REPEATABLE = (id: string) => id.startsWith("custom.");

/**
 * Widgets that a placed widget already shows as one of its parts, while the named option is on:
 * offering them would only put the same value on the line twice. Turn the part off (e.g. the model
 * badge's "Show effort level") and the stand-alone widget is back in the tray.
 */
const COVERED: Array<{ widget: string; by: string; option: string }> = [{ widget: "model.effort", by: "model.badge", option: "showEffort" }];

/** Is `id` already shown by some placed widget (see COVERED)? */
function coveredBy(id: string, placed: WidgetInstance[], widgets: WidgetManifest[]): boolean {
  return COVERED.some((c) => {
    if (c.widget !== id) return false;
    const def = widgets.find((w) => w.id === c.by)?.defaults[c.option];
    return placed.some((p) => p.widget === c.by && (p.options?.[c.option] ?? def) === true);
  });
}

/** How many items a phone shows before "Show all": about three rows at 390px. */
const COLLAPSED_COUNT = 8;
/** Same breakpoint as the stacked layout rows in index.css. */
const NARROW_QUERY = "(max-width: 49.5rem)";

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia?.(NARROW_QUERY).matches === true);
  useEffect(() => {
    const mq = window.matchMedia?.(NARROW_QUERY);
    if (!mq) return;
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

/** Keep a floating tooltip this far from the window edges. */
const EDGE = 8;

/**
 * What a tray item is, shown above it on hover or keyboard focus: its description and what it
 * prints (the widget's sample). It replaced a try-on that redrew the whole preview for every item
 * the pointer crossed. Positioned fixed from the item's box and clamped to the window, so items at
 * either end of a row don't push it off screen.
 */
function TrayTip({ id, anchor, w }: { id: string; anchor: HTMLElement; w: WidgetManifest }) {
  const t = useT();
  const tip = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect();
    const box = tip.current!.getBoundingClientRect();
    const left = Math.max(EDGE, Math.min(window.innerWidth - box.width - EDGE, a.left + a.width / 2 - box.width / 2));
    // Above the item; below it when there is no room above (the item sits at the top of the window).
    const top = a.top - box.height - 6 >= EDGE ? a.top - box.height - 6 : a.bottom + 6;
    setPos({ left, top });
  }, [anchor]);
  return (
    <div ref={tip} id={id} role="tooltip" className="tray-tip" style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}>
      <span>{widgetDesc(t, w, w.id)}</span>
      {w.sample && <span className="tray-tip-sample mono">{w.sample}</span>}
    </div>
  );
}

function TrayItem({ w, repeatable }: { w: WidgetManifest; repeatable: boolean }) {
  const t = useT();
  const lines = useStore((s) => linesOf(s.config!, s.surface));
  const addWidget = useStore((s) => s.addWidget);
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: `${TRAY_PREFIX}${w.id}` });
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const tipId = useId();
  const name = widgetName(t, w, w.id);
  return (
    <>
      <button
        ref={setNodeRef}
        type="button"
        className="tray-item mono"
        style={{ ["--cat" as string]: CAT_COLOR[w.category] ?? CAT_COLOR.misc, opacity: isDragging ? 0.4 : 1 }}
        aria-describedby={`${tipId} tray-help`}
        {...listeners}
        onMouseEnter={(e) => setAnchor(e.currentTarget)}
        onMouseLeave={() => setAnchor(null)}
        // Keyboard focus only: a mouse click also focuses, and the tip is already showing then.
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && setAnchor(e.currentTarget)}
        onBlur={() => setAnchor(null)}
        onKeyDown={(e) => e.key === "Escape" && setAnchor(null)}
        onClick={() => {
          setAnchor(null);
          addWidget(Math.max(0, lines.length - 1), "left", w.id);
        }}
      >
        {name}
        {repeatable && <span className="chip-empty">{t.tray.repeatable}</span>}
        {w.source === "plugin" && <span className="chip-empty">{t.tray.plugin}</span>}
      </button>
      {anchor && !isDragging && <TrayTip id={tipId} anchor={anchor} w={w} />}
    </>
  );
}

/**
 * A skipped project widget folder `<root>/.claude/claude-code-super-statusline/widgets` → its project
 * root. `claude-code-ssp` is the folder's pre-0.4.0 name, still loaded where a project has it.
 */
function projectRootOf(dir: string): string {
  return dir.replace(/[\\/]\.claude[\\/]claude-code-(?:super-statusline|ssp)[\\/]widgets[\\/]?$/, "");
}

/**
 * A project's own widgets that did not load because the project isn't trusted. Shown where people
 * look for widgets, so the reason a project widget is missing isn't buried in Diagnostics.
 */
function Untrusted() {
  const t = useT();
  const cwd = useStore((s) => s.projectCwd);
  const trustProject = useStore((s) => s.trustProject);
  const [skipped, setSkipped] = useState<Array<{ dir: string }>>([]);
  const load = () =>
    api
      .doctor(cwd)
      .then((r) => setSkipped(r.plugins.skipped ?? []))
      // Only a hint: if the report can't load, the tray simply doesn't show it (Diagnostics reports the error).
      .catch(() => setSkipped([]));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);
  return (
    <>
      {skipped.map((sk) => (
        <div key={sk.dir} className="tray-notice">
          <span>{t.tray.untrusted}</span>
          <code className="mono hint">{sk.dir}</code>
          <button className="btn" onClick={() => void trustProject(projectRootOf(sk.dir)).then(load)} title={t.doctor.trustHint}>
            {t.doctor.trust}
          </button>
        </div>
      ))}
    </>
  );
}

/**
 * Every widget not in the layout, grouped by category, under the lines. It replaces the "+" slot
 * in every zone and the picker drawer: what can be added is always in view, a click appends to the
 * last line, and dragging puts it anywhere. Dropping a chip here takes it out of the statusline.
 */
export function Tray() {
  const t = useT();
  const widgets = useStore((s) => s.widgets);
  const config = useStore((s) => s.config!);
  const surface = useStore((s) => s.surface);
  const { setNodeRef, isOver, active } = useDroppable({ id: TRAY_DROP_ID });
  const lines = linesOf(config, surface);
  const placed = useMemo(() => lines.flatMap((l) => [...(l.left ?? []), ...(l.center ?? []), ...(l.right ?? [])]), [lines]);
  const groups = useMemo(() => {
    const inUse = new Set(placed.map((w) => w.widget));
    const map = new Map<TrayGroup, WidgetManifest[]>();
    for (const w of widgets) {
      // The desktop band is drawn by a mod, which can only run some of the widgets.
      if (surface === "desktop" && !w.desktop) continue;
      const offered = !RETIRED.has(w.id) && (REPEATABLE(w.id) || (!inUse.has(w.id) && !coveredBy(w.id, placed, widgets)));
      if (offered) map.set(groupOf(w.category), [...(map.get(groupOf(w.category)) ?? []), w]);
    }
    // A group left with one widget (its siblings are all placed) isn't a group: it joins "misc", so
    // no line of the tray holds a lone item under a heading of its own.
    for (const [id, ws] of map) {
      if (id === "misc" || ws.length !== 1) continue;
      map.delete(id);
      map.set("misc", [...(map.get("misc") ?? []), ...ws]);
    }
    const order = GROUPS.map((g) => g.id);
    return [...map.entries()].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b));
  }, [widgets, placed, surface]);
  const count = groups.reduce((n, [, ws]) => n + ws.length, 0);
  // Only a chip from the layout can be dropped here (a tray item dropped back on the tray is a no-op).
  const removing = isOver && active !== null && !String(active.id).startsWith(TRAY_PREFIX);
  // On a phone ~26 items wrap into a screen and a half of chips; show the first few until asked.
  const narrow = useNarrow();
  const [expanded, setExpanded] = useState(false);
  const limit = narrow && !expanded ? COLLAPSED_COUNT : Infinity;
  // Each group keeps what is left of the limit after the groups before it.
  const visible = groups
    .map(([cat, ws], gi) => {
      const before = groups.slice(0, gi).reduce((n, [, g]) => n + g.length, 0);
      return [cat, ws.slice(0, Math.max(0, limit - before))] as const;
    })
    .filter(([, ws]) => ws.length > 0);
  return (
    <div ref={setNodeRef} className="tray" data-over={removing} aria-labelledby="tray-title">
      <div className="tray-head">
        <h3 id="tray-title">{t.tray.title}</h3>
        <span className="hint" id="tray-help">
          {removing ? t.tray.dropToRemove : t.tray.hint}
        </span>
      </div>
      <Untrusted />
      {count === 0 ? (
        <p className="hint">{t.tray.empty}</p>
      ) : (
        // One group per row: its name in a column of its own, its widgets wrapping beside it.
        <div className="tray-items">
          {visible.map(([id, ws]) => (
            <div key={id} className="tray-group" role="group" aria-label={t.tray.groups[id]}>
              <span className="tray-cat" aria-hidden="true">
                {t.tray.groups[id]}
              </span>
              <span className="tray-group-items">
                {ws.map((w) => (
                  <TrayItem key={w.id} w={w} repeatable={REPEATABLE(w.id)} />
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
      {narrow && count > COLLAPSED_COUNT && (
        <button className="btn btn-ghost self-start" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? t.tray.showFewer : t.tray.showAll(count)}
        </button>
      )}
    </div>
  );
}
