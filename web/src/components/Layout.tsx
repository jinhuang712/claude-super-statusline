import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { CSS } from "@dnd-kit/utilities";
import type { LineConfig, WidgetInstance, Zone } from "../api";
import { CAT_COLOR } from "../colors";
import { collision, TRAY_DROP_ID, TRAY_PREFIX, ZONE_PREFIX } from "../collision";
import { useT, widgetName } from "../i18n";
import { emptyStateAt, hasCenter, layoutMode, linesOf, useStore, widgetAt, type Surface } from "../store";
import { Icon } from "./Icon";
import { OptionsPanel } from "./Options";
import { LayoutModes } from "./LayoutModes";
import { Popover } from "./Popover";
import { Tray } from "./Tray";

/*
  Drag ids must survive a reorder. Positions do not, so a chip is identified by its widget id plus
  its occurrence number across the whole config (`git.branch#0`, `git.branch#1`). Zones get their own
  droppable id so a chip can be dropped into an empty zone.
*/
type Pos = { line: number; zone: Zone; index: number };
const ZONES: Zone[] = ["left", "center", "right"];
const CHIP_HELP_ID = "chip-help";

function zoneId(line: number, zone: Zone): string {
  return `${ZONE_PREFIX}${line}:${zone}`;
}
function parseZoneId(id: string): { line: number; zone: Zone } | null {
  if (!id.startsWith(ZONE_PREFIX)) return null;
  const [, l, z] = id.split(":");
  return { line: Number(l), zone: z as Zone };
}
function indexChips(lines: LineConfig[]): { ids: Map<string, Pos>; at: Map<string, string> } {
  const seen = new Map<string, number>();
  const ids = new Map<string, Pos>();
  const at = new Map<string, string>();
  lines.forEach((line, li) =>
    ZONES.forEach((zone) =>
      (line[zone] ?? []).forEach((w, index) => {
        const n = seen.get(w.widget) ?? 0;
        seen.set(w.widget, n + 1);
        const id = `${w.widget}#${n}`;
        ids.set(id, { line: li, zone, index });
        at.set(`${li}:${zone}:${index}`, id);
      }),
    ),
  );
  return { ids, at };
}

function ChipFace({ widget, ghost }: { widget: string; ghost?: boolean }) {
  const t = useT();
  const manifest = useStore((s) => s.widgets.find((w) => w.id === widget));
  const cat = CAT_COLOR[manifest?.category ?? "misc"];
  return (
    <span className="chip mono" data-ghost={ghost} style={{ ["--cat" as string]: cat }}>
      <span className="chip-name">{widgetName(t, manifest, widget)}</span>
    </span>
  );
}

const ARROWS: Record<string, "left" | "right" | "up" | "down"> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

function Chip({ id, line, zone, index, item }: { id: string; line: number; zone: Zone; index: number; item: WidgetInstance }) {
  // `attributes` from useSortable are deliberately not spread: they would make the wrapper a
  // focusable role="button" around two real buttons (nested interactive controls, which screen
  // readers flatten). Pointer dragging only needs the listeners; keyboard users move chips with
  // Alt+Arrow on the name button instead.
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const t = useT();
  const s = useStore();
  const nameBtn = useRef<HTMLButtonElement>(null);
  const manifest = s.widgets.find((w) => w.id === item.widget);
  const selected = s.selection?.line === line && s.selection.zone === zone && s.selection.index === index;
  const cat = CAT_COLOR[manifest?.category ?? "misc"];
  const empty = emptyStateAt(s.preview, { line, zone, index });
  const name = widgetName(t, manifest, item.widget);

  // After a keyboard move the chip re-mounts at its new position; the one standing there takes focus.
  const focusHere = s.focusPos?.line === line && s.focusPos.zone === zone && s.focusPos.index === index;
  useEffect(() => {
    if (!focusHere) return;
    nameBtn.current?.focus();
    s.claimFocus();
  }, [focusHere, s]);

  return (
    <span
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1, ["--cat" as string]: cat }}
      className="chip mono"
      data-selected={selected}
      data-empty={empty ?? undefined}
      {...listeners}
    >
      <button
        ref={nameBtn}
        className="chip-name"
        // A second click on the open chip closes its options again.
        onClick={() => (selected ? s.closeOptions() : s.select({ line, zone, index }))}
        aria-expanded={selected}
        onKeyDown={(e) => {
          // Delete / Backspace removes — the keyboard twin of dragging a chip to the tray.
          if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            s.removeAt({ line, zone, index });
            return;
          }
          const dir = ARROWS[e.key];
          if (!dir || !e.altKey) return;
          e.preventDefault();
          s.nudge({ line, zone, index }, dir);
        }}
        title={empty === "filled" ? t.layout.filledTitle : empty === "placeholder" ? t.layout.placeholderTitle : empty === "hidden" ? t.layout.hiddenTitle : t.layout.editOptions}
        aria-describedby={CHIP_HELP_ID}
        aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown Delete"
      >
        {/*
          Just the name. The label ("Project" in front of the path) used to sit beside it, which read
          as the same word twice; it is edited, and shown, in the widget's options and the preview.
          Its own span so a name too long for a phone-width zone truncates instead of wrapping.
        */}
        <span className="chip-text">{name}</span>
        {empty && <span className="chip-empty">{empty === "filled" ? t.layout.sampleTag : t.layout.noDataTag}</span>}
      </button>
    </span>
  );
}

function ZoneBox({ line, zone, items, at, caret, lineEmpty }: { line: number; zone: Zone; items: WidgetInstance[]; at: Map<string, string>; caret: number | null; lineEmpty: boolean }) {
  const t = useT();
  const ids = items.map((_, i) => at.get(`${line}:${zone}:${i}`)!);
  const empty = items.length === 0;
  const { setNodeRef, isOver } = useDroppable({ id: zoneId(line, zone) });
  // Where a chip dragged in from another zone will land (same-zone drags show it by shifting chips).
  const Caret = () => <i className="drop-caret" aria-hidden="true" />;
  return (
    <SortableContext items={ids} strategy={rectSortingStrategy}>
      <div ref={setNodeRef} className="zone" data-zone={zone} data-empty={empty} data-over={isOver}>
        {/* Caption: always for the center zone (its position varies), for every zone once rows stack. */}
        <span className="zone-cap">{t.layout.zones[zone]}</span>
        {items.map((it, i) => (
          <Fragment key={ids[i]}>
            {caret === i && <Caret />}
            <Chip id={ids[i]!} line={line} zone={zone} index={i} item={it} />
          </Fragment>
        ))}
        {caret !== null && caret >= items.length && <Caret />}
        {/* A brand-new line says how to fill it; a zone that is merely empty stays quiet (it lights up as a drop target while dragging). */}
        {lineEmpty && zone === "left" && caret === null && <span className="hint">{t.layout.emptyLine}</span>}
      </div>
    </SortableContext>
  );
}

/** Per-line actions and settings, behind the line number so rows stay uncluttered. */
function LineMenu({ line, index, total }: { line: LineConfig; index: number; total: number }) {
  const t = useT();
  const s = useStore();
  return (
    <Popover label={t.layout.lineMenu(index + 1)} buttonClassName="linerow-num mono" buttonContent={index + 1}>
      {(close) => (
        <div className="linemenu">
          <div className="linemenu-actions">
            <button
              className="btn"
              disabled={index === 0}
              onClick={() => {
                s.moveLine(index, -1);
                close();
              }}
            >
              ↑ {t.layout.moveUp}
            </button>
            <button
              className="btn"
              disabled={index === total - 1}
              onClick={() => {
                s.moveLine(index, 1);
                close();
              }}
            >
              ↓ {t.layout.moveDown}
            </button>
            <button
              className="btn"
              onClick={() => {
                s.insertLine(index);
                close();
              }}
            >
              <Icon name="plus" size={12} />
              {t.layout.insertAbove}
            </button>
            <button
              className="btn"
              onClick={() => {
                s.insertLine(index + 1);
                close();
              }}
            >
              <Icon name="plus" size={12} />
              {t.layout.insertBelow}
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                s.removeLine(index);
                close();
              }}
            >
              × {t.layout.deleteLine}
            </button>
          </div>
          {/* The desktop band is one fixed row of left and right: it has no width to overflow or hide at. */}
          {s.surface === "terminal" && (
          <>
          <label className="linemenu-field">
            <span>{t.layout.overflow}</span>
            <select
              className="field !w-auto"
              value={line.overflow ?? "truncate"}
              onChange={(e) =>
                s.setConfig((c) => {
                  linesOf(c, s.surface)[index]!.overflow = e.target.value as LineConfig["overflow"];
                })
              }
            >
              {/* Truncate first: it is the default (one row per line, no gaps in the right column). */}
              <option value="truncate">{t.layout.overflowTruncate}</option>
              <option value="wrap">{t.layout.overflowWrap}</option>
              {/* Hiding the right side is no longer offered (the right zone stays put); shown only for a config that already chose it. */}
              {line.overflow === "drop-right" && <option value="drop-right">{t.layout.overflowDropRight}</option>}
            </select>
          </label>
          <label className="linemenu-field">
            <span>
              {t.layout.hideBelow} <span className="hint">({t.layout.hideBelowHint})</span>
            </span>
            <span className="inline-flex items-center gap-2">
              <input
                className="field !w-20"
                type="number"
                min={0}
                value={line.minColumns ?? 0}
                onChange={(e) =>
                  s.setConfig((c) => {
                    const v = Number(e.target.value);
                    const target = linesOf(c, s.surface)[index]!;
                    if (v > 0) target.minColumns = v;
                    else delete target.minColumns;
                  })
                }
              />
              {t.layout.columnsUnit}
            </span>
          </label>
          </>
          )}
        </div>
      )}
    </Popover>
  );
}

function Row({ line, index, total, withCenter, at, caret }: { line: LineConfig; index: number; total: number; withCenter: boolean; at: Map<string, string>; caret: Pos | null }) {
  const caretIn = (zone: Zone) => (caret && caret.line === index && caret.zone === zone ? caret.index : null);
  const lineEmpty = ZONES.every((z) => (line[z]?.length ?? 0) === 0);
  // The open widget's options unfold under its own line, so what is being edited stays next to it.
  const open = useStore((s) => s.selection?.line === index && widgetAt(s, s.selection) !== null);
  const removeLine = useStore((s) => s.removeLine);
  const insertLine = useStore((s) => s.insertLine);
  const t = useT();
  return (
    <div className="linerow" data-open={open}>
      {/*
        Mouse shortcuts for "Insert line above / below": a ⊕ on the row's top and bottom edge, in
        the gutter, shown while the row is hovered. At a boundary the row above's "below" and the
        row below's "above" sit on the same spot and do the same thing. They are skipped by Tab
        and hidden from screen readers on purpose — two more tab stops per line would be noise, and
        the line-number menu offers the same two actions to keyboard and screen-reader users.
      */}
      {(["above", "below"] as const).map((edge) => (
        <button
          key={edge}
          type="button"
          className="line-insert"
          data-edge={edge}
          tabIndex={-1}
          aria-hidden
          title={t.layout.insertHere}
          onClick={() => insertLine(edge === "above" ? index : index + 1)}
        >
          <span className="line-insert-dot">
            <Icon name="plus" size={10} />
          </span>
        </button>
      ))}
      <div className="linerow-gutter">
        <LineMenu line={line} index={index} total={total} />
      </div>
      <div className={`linerow-body ${withCenter ? "with-center" : ""}`}>
        <ZoneBox line={index} zone="left" items={line.left ?? []} at={at} caret={caretIn("left")} lineEmpty={lineEmpty} />
        {withCenter && <ZoneBox line={index} zone="center" items={line.center ?? []} at={at} caret={caretIn("center")} lineEmpty={lineEmpty} />}
        <ZoneBox line={index} zone="right" items={line.right ?? []} at={at} caret={caretIn("right")} lineEmpty={lineEmpty} />
        {/*
          An empty line says how to fill it — and how to get rid of it, right there. Deleting it was
          only possible from the menu behind the line number, which nobody found.
        */}
        {lineEmpty && (
          <button className="btn btn-ghost btn-sm line-remove" onClick={() => removeLine(index)}>
            <Icon name="x" size={12} />
            {t.layout.deleteLine}
          </button>
        )}
      </div>
      {open && <OptionsPanel />}
    </div>
  );
}

/** The widget a drag id stands for: a tray item (`tray:git.pr`) or a placed chip (`git.pr#0`). */
function widgetOfDragId(id: string): string {
  return id.startsWith(TRAY_PREFIX) ? id.slice(TRAY_PREFIX.length) : id.split("#")[0]!;
}

/**
 * Which layout is being edited: the terminal statusline, or the desktop app's band (drawn by the
 * mod). The desktop has no statusLine, so it gets its own lines; the choice only moves the editor.
 */
function SurfaceSwitch() {
  const t = useT();
  const surface = useStore((s) => s.surface);
  const setSurface = useStore((s) => s.setSurface);
  const options: Surface[] = ["terminal", "desktop"];
  return (
    <span className="seg" role="group" aria-label={t.layout.surface}>
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={surface === o} onClick={() => setSurface(o)}>
          {t.layout.surfaces[o]}
        </button>
      ))}
    </span>
  );
}

export function Layout() {
  const t = useT();
  const config = useStore((s) => s.config)!;
  const reorder = useStore((s) => s.reorder);
  const moveWidget = useStore((s) => s.moveWidget);
  const addWidget = useStore((s) => s.addWidget);
  const removeAt = useStore((s) => s.removeAt);
  const setTryOn = useStore((s) => s.setTryOn);
  const addLine = useStore((s) => s.addLine);
  const live = useStore((s) => s.live);
  const withCenter = useStore(hasCenter);
  const mode = useStore(layoutMode);
  const surface = useStore((s) => s.surface);
  const lines = linesOf(config, surface);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [dragging, setDragging] = useState<string | null>(null);
  const [caret, setCaret] = useState<Pos | null>(null);
  const { ids, at } = useMemo(() => indexChips(lines), [lines]);

  /** Where a drop on `overId` (a zone or a chip) lands, or null when it isn't in the layout. */
  function dropTarget(overId: string): Pos | null {
    const z = parseZoneId(overId);
    if (z) return { ...z, index: lines[z.line]?.[z.zone]?.length ?? 0 };
    return ids.get(overId) ?? null;
  }
  function onDragStart(e: DragStartEvent) {
    // A tray item was being hovered (try-on) when the drag began: the preview goes back to the real config.
    setTryOn(null);
    setDragging(String(e.active.id));
  }
  function onDragOver(e: DragOverEvent) {
    if (!e.over) return setCaret(null);
    const target = dropTarget(String(e.over.id));
    const a = ids.get(String(e.active.id));
    // Same zone: the sortable strategy already shows the gap by shifting chips. A tray item has no
    // zone yet, so it always gets the caret.
    setCaret(target && !(a && target.line === a.line && target.zone === a.zone) ? target : null);
  }
  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    setCaret(null);
    if (!e.over || e.active.id === e.over.id) return;
    const activeId = String(e.active.id);
    const overId = String(e.over.id);
    if (activeId.startsWith(TRAY_PREFIX)) {
      const target = dropTarget(overId);
      if (target) addWidget(target.line, target.zone, widgetOfDragId(activeId), target.index);
      return;
    }
    const a = ids.get(activeId);
    if (!a) return;
    // Dragged back onto the tray: out of the statusline.
    if (overId === TRAY_DROP_ID) return removeAt(a);
    const z = parseZoneId(overId);
    if (z) {
      // Dropped on a zone's empty space: append there (a no-op if it is already last in that zone).
      const len = lines[z.line]?.[z.zone]?.length ?? 0;
      if (a.line === z.line && a.zone === z.zone) {
        if (a.index !== len - 1) reorder(a.line, a.zone, a.index, len - 1);
      } else moveWidget(a, z.line, z.zone, len);
      return;
    }
    const b = ids.get(overId);
    if (!b) return;
    if (a.line === b.line && a.zone === b.zone) reorder(a.line, a.zone, a.index, b.index);
    else moveWidget(a, b.line, b.zone, b.index);
  }

  return (
    <section className="section" aria-labelledby="layout-title">
      <div className="section-head">
        <h2 id="layout-title" className="h2">
          {t.layout.title}
        </h2>
        <SurfaceSwitch />
      </div>
      {surface === "terminal" && <LayoutModes />}
      <p className="sr-only" aria-live="polite">
        {live}
      </p>
      {mode === "custom" && (
        <>
          <p className="hint layout-hint">{surface === "desktop" ? t.layout.desktopHint : t.layout.hint}</p>
          <p id={CHIP_HELP_ID} className="sr-only">
            {t.layout.chipHelp}
          </p>
          {renderEditor()}
        </>
      )}
    </section>
  );

  // The line editor and the tray: only in Custom mode (a preset is picked above, not built here).
  // Called as a function, not rendered as <Component/>: a component defined inside Layout would be a
  // new type on every render and remount, losing drag state and focus each time.
  function renderEditor() {
    return (
      /* One drag context for the lines and the tray, so widgets travel both ways between them. */
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setDragging(null);
          setCaret(null);
        }}
      >
        {/* No Left / Right header row: the right zone sits at the right edge as on the real line; stacked rows on a phone caption each zone. */}
        <div className="layout-card">
          {/* data-dragging widens empty zones into visible drop slots, only while something is being dragged. */}
          <div className="linelist" data-dragging={dragging !== null}>
            {lines.map((line, i) => (
              <Row key={`${surface}${i}`} line={line} index={i} total={lines.length} withCenter={withCenter} at={at} caret={caret} />
            ))}
          </div>
          {/* Sits in the rows' column, as the next row would: adding a line reads as extending the list. */}
          <div className="linerow">
            <span />
            <button className="addline" onClick={addLine}>
              <Icon name="plus" size={14} />
              {t.layout.addLine}
            </button>
          </div>
        </div>
        <Tray />
        <DragOverlay dropAnimation={null}>{dragging ? <ChipFace widget={widgetOfDragId(dragging)} ghost /> : null}</DragOverlay>
      </DndContext>
    );
  }
}
