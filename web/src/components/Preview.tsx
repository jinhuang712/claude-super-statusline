import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useId, useRef, useState } from "react";
import { useT } from "../i18n";
import { linesOf, useStore } from "../store";
import { SurfaceSwitch } from "./SurfaceSwitch";
import { parseAnsi } from "./Ansi";
import { Icon } from "./Icon";
import { Popover } from "./Popover";
import { TERM_THEMES, termScheme, useTheme, type TermBg } from "../theme";

/**
 * The snapshot folder, shortened for display: the home directory becomes "~" (macOS /Users/<name>,
 * Linux /home/<name>). The full path stays in the tooltip.
 */
const HOME_PREFIX = /^\/(?:Users|home)\/[^/]+(?=\/)/;

/**
 * A choice between a few values, drawn as the page's segmented switch (.seg, like the header's
 * language and appearance switches) and named by its row's label. `title` gives a short visible
 * label its full name — it must contain the visible text (WCAG 2.5.3 Label in Name).
 */
function Seg<T extends string>({ labelledBy, value, options, onChange }: { labelledBy: string; value: T; options: Array<{ value: T; label: string; title?: string }>; onChange(v: T): void }) {
  return (
    <span className="seg" role="group" aria-labelledby={labelledBy}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} aria-label={o.title} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

/**
 * − n + in the same track, for small counts where a bordered number box looked like another app.
 * Typing is kept as a draft until it is a whole number in range, so "1" on the way to "120" doesn't
 * snap to the minimum mid-keystroke; leaving the field drops an unfinished draft.
 */
function Stepper({ value, min, max, label, onChange }: { value: number; min: number; max: number; label: string; onChange(n: number): void }) {
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);
  const valid = (n: number) => Number.isInteger(n) && n >= min && n <= max;
  const step = (d: number) => {
    const n = value + d;
    if (valid(n)) onChange(n);
  };
  return (
    <span className="seg stepper" role="group" aria-label={label}>
      <button type="button" aria-label={t.preview.decrease(label)} title={t.preview.decrease(label)} disabled={value <= min} onClick={() => step(-1)}>
        −
      </button>
      <input
        className="mono"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={draft ?? String(value)}
        aria-label={label}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== "" && valid(n)) onChange(n);
        }}
        onBlur={() => setDraft(null)}
      />
      <button type="button" aria-label={t.preview.increase(label)} title={t.preview.increase(label)} disabled={value >= max} onClick={() => step(1)}>
        +
      </button>
    </span>
  );
}

/**
 * How the terminal is drawn: preview width and ground (viewer preferences, per browser) and the
 * render settings that match the statusline to a real terminal (right margin, colour depth, saved
 * snapshots — written to the config). All set once per terminal, so they share one popover. Every
 * control is a segmented switch or a stepper, like the header's: native selects, number boxes and a
 * checkbox made this the one panel that looked like a different app.
 */
function PreviewSettings() {
  const t = useT();
  const columns = useStore((s) => s.columns);
  const columnsMode = useStore((s) => s.columnsMode);
  const setColumnsMode = useStore((s) => s.setColumnsMode);
  const ms = useStore((s) => s.preview?.ms);
  const c = useStore((s) => s.config!);
  const setConfig = useStore((s) => s.setConfig);
  const samplesDir = useStore((s) => s.paths?.samples) ?? "~/.claude/plugins/claude-code-super-statusline/samples";
  const termBg = useTheme((s) => s.termBg);
  const setTermBg = useTheme((s) => s.setTermBg);
  const widthId = useId();
  const termId = useId();
  const marginId = useId();
  const colorId = useId();
  const captureId = useId();
  return (
    <div className="settings">
      <div className="settings-row">
        <span className="settings-label" id={widthId}>
          {t.preview.widthLabel}
        </span>
        <span className="settings-ctl">
          <Seg
            labelledBy={widthId}
            value={columnsMode === "auto" ? "auto" : "fixed"}
            options={[
              { value: "auto", label: t.preview.fitWindow },
              { value: "fixed", label: t.preview.fixedColumns },
            ]}
            onChange={(v) => setColumnsMode(v === "auto" ? "auto" : columns)}
          />
          {columnsMode !== "auto" && <Stepper value={columns} min={40} max={400} label={t.preview.columnsLabel} onChange={(n) => setColumnsMode(n)} />}
        </span>
      </div>
      <div className="settings-row">
        <span className="settings-label">
          <span id={termId}>{t.preview.terminalLabel}</span>
          <span className="hint">{t.preview.terminalHint}</span>
        </span>
        <Seg
          labelledBy={termId}
          value={termBg}
          options={[
            { value: "auto", label: t.preview.termAuto },
            { value: "dark", label: t.preview.termDark },
            { value: "light", label: t.preview.termLight },
          ]}
          onChange={(v: TermBg) => setTermBg(v)}
        />
      </div>
      <div className="settings-row">
        <span className="settings-label">
          <span id={marginId}>{t.preview.rightMargin}</span>
          <span className="hint">{t.preview.rightMarginHint}</span>
        </span>
        <Stepper
          value={c.columnsOffset}
          min={0}
          max={20}
          label={t.preview.rightMargin}
          onChange={(n) =>
            setConfig((x) => {
              x.columnsOffset = n;
            })
          }
        />
      </div>
      <div className="settings-row">
        <span className="settings-label" id={colorId}>
          {t.preview.colorMode}
        </span>
        <Seg
          labelledBy={colorId}
          value={c.colorLevel}
          options={(["auto", "truecolor", "256", "16", "none"] as const).map((lv) => ({ value: lv, label: t.preview.colorLevelsShort[lv]!, title: t.preview.colorLevels[lv] }))}
          onChange={(v) =>
            setConfig((x) => {
              x.colorLevel = v;
            })
          }
        />
      </div>
      <div className="settings-row">
        <span className="settings-label">
          <span id={captureId}>{t.preview.capture}</span>
          <span className="hint" title={samplesDir}>
            {t.preview.captureWhere}
            {/* The folder on a line of its own: wrapped into the sentence, it broke mid-path. */}
            <span className="mono block">{samplesDir.replace(HOME_PREFIX, "~")}</span>
          </span>
        </span>
        <Seg
          labelledBy={captureId}
          value={c.captureSamples ? "on" : "off"}
          options={[
            { value: "on", label: t.preview.on },
            { value: "off", label: t.preview.off },
          ]}
          onChange={(v) =>
            setConfig((x) => {
              x.captureSamples = v === "on";
            })
          }
        />
      </div>
      {/* Kept for the curious (the render budget is 40 ms), but out of the toolbar: a lone "0.1 ms" read as noise. */}
      <p className="hint settings-meta">
        {t.preview.renderTime}: <span className="mono">{ms === undefined ? "—" : `${ms.toFixed(1)} ms`}</span>
      </p>
    </div>
  );
}

/**
 * The preview's type size, relative to the root: a step above the page's own mono text (chips are
 * 0.8125rem), because the statusline is what the page is about and at the page's size it read
 * small. xterm takes pixels, so this is resolved from the root font size once, when the terminal
 * is created, and rounded to a whole pixel. With the 110% root that is 16px (it was 13px).
 */
const PREVIEW_FONT_REM = 0.9;

function previewFontPx(): number {
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Math.round((Number.isFinite(root) && root > 0 ? root : 16) * PREVIEW_FONT_REM);
}

export function Preview() {
  const t = useT();
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  /** Rows reserved by the last try-on, kept while the real config still has `forLines` lines. */
  const hold = useRef<{ rows: number; forLines: number } | null>(null);
  const preview = useStore((s) => s.preview);
  const previewColumns = useStore((s) => s.previewColumns);
  const columns = useStore((s) => s.columns);
  const setColumns = useStore((s) => s.setColumns);
  const columnsMode = useStore((s) => s.columnsMode);
  const lineCount = useStore((s) => (s.config ? linesOf(s.config, s.surface).length : 0));
  const tryOn = useStore((s) => s.tryOn);
  const scheme = useTheme(termScheme);

  useEffect(() => {
    if (!host.current) return;
    const xt = new Terminal({
      rows: 3,
      disableStdin: true,
      cursorBlink: false,
      cursorInactiveStyle: "none",
      fontFamily: 'ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
      fontSize: previewFontPx(),
      lineHeight: 1.25,
      theme: TERM_THEMES[termScheme(useTheme.getState())],
    });
    const f = new FitAddon();
    xt.loadAddon(f);
    xt.open(host.current);
    // xterm keeps a hidden <textarea> for keyboard input. With stdin disabled it is useless here,
    // but it still takes focus and swallows Tab — a keyboard trap that made everything below the
    // preview unreachable. Take it out of the tab order and the accessibility tree; screen readers
    // get the plain-text copy rendered next to the canvas instead.
    const helper = host.current.querySelector<HTMLTextAreaElement>("textarea.xterm-helper-textarea");
    if (helper) {
      helper.tabIndex = -1;
      helper.setAttribute("aria-hidden", "true");
    }
    term.current = xt;
    const refit = () => {
      if (useStore.getState().columnsMode !== "auto") return;
      const dims = f.proposeDimensions();
      if (dims?.cols) setColumns(dims.cols);
    };
    refit();
    const ro = new ResizeObserver(refit);
    ro.observe(host.current);
    return () => {
      ro.disconnect();
      xt.dispose();
      term.current = null;
    };
  }, [setColumns]);

  // Repaint in place when the terminal background changes; xterm re-renders the buffer itself.
  useEffect(() => {
    if (term.current) term.current.options.theme = TERM_THEMES[scheme];
  }, [scheme]);

  // Switching back to "auto" re-measures immediately instead of waiting for a resize.
  useEffect(() => {
    if (columnsMode !== "auto" || !host.current) return;
    const w = host.current.clientWidth;
    const cell = host.current.querySelector<HTMLElement>(".xterm-screen")?.clientWidth;
    const cols = term.current?.cols;
    if (w && cell && cols) setColumns(Math.max(20, Math.floor((w / cell) * cols)));
  }, [columnsMode, setColumns]);

  // The height held for a try-on is let go once nothing has been tried on for a moment. Keeping it
  // until the line count changed left a tall empty terminal after hovering a 4-line template. The
  // delay is what keeps the loop below away: sweeping across a row of choices never goes 500 ms
  // without a try-on, and once the pointer has left them, shrinking can't move one back under it.
  const [released, setReleased] = useState(0);
  useEffect(() => {
    if (tryOn || !hold.current) return;
    const timer = setTimeout(() => {
      hold.current = null;
      setReleased((n) => n + 1);
    }, 500);
    return () => clearTimeout(timer);
  }, [tryOn]);

  // Redraw only from a preview rendered for the current width; a stale one would wrap.
  useEffect(() => {
    const xt = term.current;
    if (!xt || !preview || previewColumns !== columns) return;
    const lines = preview.lines;
    // Height is sticky around try-ons. Hovering a 1-line preset used to shrink the preview, which
    // moved the preset out from under the pointer (mouseleave → real config → grows back →
    // mouseenter …) and looped every ~80 ms. So a try-on may grow the preview but never shrink it;
    // the grown height is kept while the line count stays the same, until the release above.
    let rows = Math.max(1, lines.length);
    if (tryOn) {
      rows = Math.max(rows, xt.rows);
      hold.current = { rows, forLines: lineCount };
    } else if (hold.current?.forLines === lineCount) {
      rows = Math.max(rows, hold.current.rows);
    } else {
      hold.current = null;
    }
    if (xt.cols !== columns || xt.rows !== rows) xt.resize(columns, rows);
    xt.reset();
    // If a line still wraps inside xterm (a glyph whose width the engine and xterm disagree on),
    // the buffer grows past `rows` and the first line scrolls out of view. Grow to fit instead,
    // so the preview never silently hides a line.
    xt.write(lines.join("\r\n"), () => {
      const used = xt.buffer.active.length;
      if (used > xt.rows) xt.resize(xt.cols, used);
      // xterm keeps the bottom anchored on resize; pin the top so line 1 is what shows first.
      xt.scrollToTop();
    });
  }, [preview, previewColumns, columns, tryOn, lineCount, released]);

  const shown = preview?.lines.length ?? 0;
  const hidden = Math.max(0, lineCount - shown);
  const filledCount = preview?.empty?.filter((e) => e.filled).length ?? 0;
  const placeholderCount = preview?.empty?.filter((e) => e.placeholder).length ?? 0;
  const hiddenCount = (preview?.empty?.length ?? 0) - filledCount - placeholderCount;
  const liveNote = [
    filledCount ? t.preview.filled(filledCount) : "",
    placeholderCount ? t.preview.placeholder(placeholderCount) : "",
    hiddenCount ? t.preview.hidden(hiddenCount) : "",
    hidden ? t.preview.emptyLines(hidden) : "",
  ]
    .filter(Boolean)
    .join(t.preview.noteJoin);
  // During a try-on the note describes the real config, not the one being hovered: its numbers would
  // be wrong, and the row appearing/disappearing would change the height (see the hover loop above).
  const realNote = useRef("");
  if (!tryOn) realNote.current = liveNote;
  const note = tryOn ? realNote.current : liveNote;

  // No frame and no toolbar: a small label with the controls beside it, the lines on one filled
  // surface (the same fill as the layout rows), and the note under it. A bordered terminal window
  // with its own title bar and a mock prompt read as a different app pasted into the page.
  return (
    <div className="term-block">
      {/*
        Each control has a short visible label; its aria-label (longer, explanatory) contains that
        word, so voice-control users can say what they see (WCAG 2.5.3 Label in Name).
      */}
      <div className="term-bar">
        <span className="term-title">{t.preview.title}</span>
        <SurfaceSwitch />
        {/*
          "Trying on: …", in the label row so hovering never changes the preview's height (a height
          change is what made hover previews loop; see the hold above).
        */}
        {tryOn && <span className="term-tryon">{t.preview.tryingOn(tryOn.label)}</span>}
        {/*
          No data picker: the preview shows the session /super-statusline:config was run from (see pickSample in
          store.ts). Choosing among every captured session and bundled sample was more than anyone needed.
        */}
        <div className="term-controls">
          {/* The width the lines are laid out for, always visible: it explains why a line wraps. */}
          <span className="mono meta">{t.preview.columns(columns)}</span>
          {/* Set once per terminal and rarely touched again, so they sit behind one button. */}
          <Popover label={t.preview.settings} buttonClassName="btn btn-ghost btn-icon" buttonContent={<Icon name="sliders" />} align="end">
            {() => <PreviewSettings />}
          </Popover>
        </div>
      </div>
      <div className="term" data-fixed={columnsMode !== "auto"} data-scheme={scheme}>
        <div ref={host} className="w-full" aria-hidden="true" />
        {/* What a screen reader announces instead of the canvas: the same lines as plain text. */}
        <pre className="sr-only" aria-label={t.preview.title}>
          {(preview?.lines ?? []).map((l) => parseAnsi(l).map((r) => r.text).join("")).join("\n")}
        </pre>
      </div>
      {/* Under the surface, so the label row and the lines it controls stay adjacent. */}
      {note && <p className="term-note">{note}</p>}
      {preview?.errors.length ? <p className="term-errors">{preview.errors.map((e) => `${e.widget}: ${e.message}`).join("　")}</p> : null}
    </div>
  );
}
