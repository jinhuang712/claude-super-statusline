import { useState } from "react";
import { CAT_COLOR } from "../colors";
import { HTML_LANG, LANGS, useLang, useT, type Lang, type Messages } from "../i18n";
import { isDirty, useStore } from "../store";
import { describeStatusLine } from "../statusline";
import { useTheme, type ThemePref } from "../theme";
import { Diagnostics } from "./Diagnostics";
import { Icon, type IconName } from "./Icon";
import { Popover } from "./Popover";

/**
 * Asked before this configurator replaces another tool's statusLine. Nothing is overwritten until
 * "Replace it" — the old entry is parked and can be restored from the header's ⋯ menu.
 */
function ConsentBanner() {
  const t = useT();
  const consent = useStore((s) => s.consent);
  const install = useStore((s) => s.install);
  const dismiss = useStore((s) => s.dismissConsent);
  if (!consent) return null;
  const cmd = describeStatusLine(consent.current);
  return (
    <div className="banner" role="alertdialog" aria-labelledby="consent-title" aria-describedby="consent-body">
      <div className="min-w-0">
        <strong id="consent-title">{t.consent.title}</strong>
        <p id="consent-body" className="hint">
          {t.consent.body}
        </p>
        <code className="mono banner-code" title={cmd.full}>
          {cmd.short}
        </code>
      </div>
      <div className="banner-actions">
        <button className="btn btn-primary" onClick={() => void install(true)}>
          {t.consent.replace}
        </button>
        <button className="btn" onClick={dismiss}>
          {t.consent.notNow}
        </button>
      </div>
    </div>
  );
}

type StatusState = "error" | "saving" | "dirty" | "defaults" | "live" | "unapplied" | "saved" | "demo";

/**
 * One short, true sentence about where the config stands. Order matters: a failure outranks
 * everything, and "nothing saved yet" must not read as "Saved" on a first visit.
 */
function statusOf(s: ReturnType<typeof useStore.getState>, t: Messages): { state: StatusState; text: string } {
  if (s.saveError) return { state: "error", text: t.header.saveFailed };
  if (s.saving) return { state: "saving", text: t.header.saving };
  if (isDirty(s)) return { state: "dirty", text: t.header.dirty };
  // The demo saves to this browser only; "live in Claude" would be untrue there.
  if (s.demo) return { state: "demo", text: t.header.demoSaved };
  const hasFile = s.layers.some((l) => l.name !== "defaults" && l.exists);
  if (!hasFile) return { state: "defaults", text: t.header.defaults };
  if (s.installed === true) return { state: "live", text: t.header.savedLive };
  if (s.installed === false) return { state: "unapplied", text: t.header.savedNotApplied };
  return { state: "saved", text: t.header.saved };
}

/** Where edits are written. Hidden until the previewed project has its own config file. */
function ScopeSelect() {
  const t = useT();
  const scope = useStore((s) => s.scope);
  const setScope = useStore((s) => s.setScope);
  const project = useStore((s) => s.layers.find((l) => l.name === "project"));
  const projectName = useStore((s) => (s.projectCwd ?? project?.path ?? "").split(/[\\/]/).filter(Boolean).slice(-1)[0] ?? "");
  if (!project?.exists && scope !== "project") return null;
  return (
    <label className="scope">
      <span>{t.header.scope}</span>
      <select className="field field-sm !w-auto" value={scope} onChange={(e) => setScope(e.target.value as "user" | "project")} title={scope === "project" ? (project?.path ?? "") : undefined}>
        <option value="user">{t.header.scopeUser}</option>
        <option value="project">{t.header.scopeProject(projectName)}</option>
      </select>
    </label>
  );
}

/**
 * "Stop using this statusline", in two steps: the first click says what will happen (which command
 * comes back, or that ours is simply removed) and only the second one acts. A menu item is too easy
 * to hit by accident for something that changes settings.json.
 */
function RestoreItem({ close }: { close: () => void }) {
  const t = useT();
  const plan = useStore((s) => s.installPlan);
  const uninstall = useStore((s) => s.uninstall);
  const [confirming, setConfirming] = useState(false);
  const prev = plan?.savedPrevious ? describeStatusLine(plan.savedPrevious) : null;
  if (!confirming) {
    return (
      <button className="menu-item menu-danger" onClick={() => setConfirming(true)}>
        {t.restore.title}
      </button>
    );
  }
  return (
    <div className="menu-confirm" role="group" aria-label={t.restore.title}>
      <span className="hint">{prev ? t.restore.previous : t.restore.none}</span>
      {prev && (
        <code className="mono banner-code" title={prev.full}>
          {prev.short}
        </code>
      )}
      <div className="flex gap-2">
        <button
          className="btn btn-danger"
          autoFocus
          onClick={() => {
            close();
            void uninstall();
          }}
        >
          {prev ? t.restore.restoreButton : t.restore.removeButton}
        </button>
        <button className="btn btn-ghost" onClick={() => setConfirming(false)}>
          {t.restore.cancel}
        </button>
      </div>
    </div>
  );
}

/** The intervals offered, in seconds; null = only on session events. 1 is Claude Code's minimum. */
const REFRESH_CHOICES: Array<number | null> = [null, 1, 5, 10, 30];

/**
 * "Refresh: every 5 s ▸": Claude Code's statusLine.refreshInterval. Claude Code re-runs the
 * statusline only on session events (a new message, a mode change…), so without a timer a save here
 * shows up only after the next message. Opens in place, like Stop using, rather than a flyout
 * submenu: a flyout would leave the popover's bounds on a 390px screen.
 */
function RefreshItem() {
  const t = useT();
  const plan = useStore((s) => s.installPlan);
  const setRefreshInterval = useStore((s) => s.setRefreshInterval);
  const [open, setOpen] = useState(false);
  const raw = (plan?.current as { refreshInterval?: unknown } | null)?.refreshInterval;
  const current = typeof raw === "number" && raw > 0 ? raw : null;
  // A value set by hand in settings.json (say 3) is shown as one more choice rather than hidden.
  const choices = current === null || REFRESH_CHOICES.includes(current) ? REFRESH_CHOICES : [...REFRESH_CHOICES, current];
  const label = (n: number | null) => (n === null ? t.refresh.optionEvents : t.refresh.optionEvery(n));
  return (
    <>
      <button className="menu-item menu-expand" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="menu-expand-row">
          {t.refresh.row(current === null ? t.refresh.onEvents : t.refresh.every(current))}
          <Icon name="chevron" size={12} className="menu-expand-chevron" />
        </span>
      </button>
      {open && (
        <div className="menu-confirm" role="group" aria-label={t.refresh.title}>
          <span className="hint">{t.refresh.hint}</span>
          <div className="choices">
            {choices.map((n) => (
              <button
                key={String(n)}
                className="choice"
                data-active={current === n}
                aria-pressed={current === n}
                onClick={() => {
                  // Stays open: the pressed choice moving is the confirmation, and the toast says what it means.
                  if (current !== n) void setRefreshInterval(n);
                }}
              >
                {label(n)}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** The header's ⋯ menu: actions that matter rarely (repairs, the way out, debugging), off the main surface. */
function HeaderMenu({ close, openDiagnostics }: { close: () => void; openDiagnostics: () => void }) {
  const t = useT();
  const s = useStore();
  const project = s.layers.find((l) => l.name === "project");
  // Each action closes the menu first, so focus returns to ⋯ before a toast or dialog appears.
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  return (
    <div className="menu">
      {!s.demo && (
        <>
      {s.installed === true && (
        <button className="menu-item" onClick={run(() => void s.install())} title={t.header.reapplyTitle}>
          {t.header.reapply}
        </button>
      )}
      <button className="menu-item" onClick={run(() => void s.resetCounters())} title={t.header.resetCountersTitle}>
        {t.header.resetCounters}
        <span className="hint">{t.header.resetCountersHint}</span>
      </button>
      <button className="menu-item" onClick={run(() => void s.saveAsProject())} title={project?.path ?? undefined}>
        {project?.exists ? t.header.overwriteProject : t.header.saveAsProject}
        {/* The file name is the same in every language (it is a path), so it isn't a locale string. Taken
            from the server's path: a project that still has the pre-0.4.0 claude-code-ssp.json saves there. */}
        <span className="hint mono">.claude/{project?.path?.split(/[\\/]/).pop() ?? "claude-code-super-statusline.json"}</span>
      </button>
      {/* Only our own entry can be retimed; before Apply there is nothing in settings.json to change. */}
      {s.installed === true && <RefreshItem />}
      <button className="menu-item" onClick={run(openDiagnostics)}>
        {t.doctor.title}
      </button>
      {s.installed === true && <RestoreItem close={close} />}
        </>
      )}
      <a className="menu-item menu-link" href="https://github.com/jinhuang712/claude-code-super-statusline" target="_blank" rel="noreferrer">
        <span className="inline-flex items-center gap-1.5">
          {t.prefs.source}
          <Icon name="external" size={13} />
        </span>
      </a>
    </div>
  );
}

/**
 * The language switch, in the header's corner rather than the ⋯ menu: a wrong language is the
 * one setting that makes the rest of the page unreadable, so it must be findable without reading
 * it. Each option is written in its own language (EN, 中文), never translated, and carries its
 * full name and `lang` for screen readers. Two languages fit one toggle; a third would want a menu.
 */
function LangToggle() {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const setLang = useLang((s) => s.setLang);
  return (
    <span className="seg" role="group" aria-label={t.header.language}>
      {(Object.keys(LANGS) as Lang[]).map((l) => (
        <button key={l} type="button" lang={HTML_LANG[l]} aria-pressed={lang === l} aria-label={LANGS[l].langName} title={LANGS[l].langName} onClick={() => setLang(l)}>
          {LANGS[l].langShort}
        </button>
      ))}
    </span>
  );
}

/** The appearance choices, in switch order, with the icon each one wears. */
const APPEARANCE: Array<{ pref: ThemePref; icon: IconName }> = [
  { pref: "system", icon: "monitor" },
  { pref: "light", icon: "sun" },
  { pref: "dark", icon: "moon" },
];

/**
 * The panel's appearance (per browser, never written to the config), beside the language switch.
 * Hidden in the ⋯ menu it read as if the page had no light mode. Icons rather than words keep
 * three options narrow enough for a phone's header; each carries its name as the accessible name
 * and tooltip.
 */
function AppearanceToggle() {
  const t = useT();
  const pref = useTheme((s) => s.pref);
  const setPref = useTheme((s) => s.setPref);
  return (
    <span className="seg seg-icons" role="group" aria-label={t.prefs.appearance}>
      {APPEARANCE.map(({ pref: p, icon }) => (
        <button key={p} type="button" aria-pressed={pref === p} aria-label={t.prefs[p]} title={t.prefs[p]} onClick={() => setPref(p)}>
          <Icon name={icon} size={15} />
        </button>
      ))}
    </span>
  );
}

/**
 * The hairline under the name: three left-zone segments, a gap, one right-zone segment, in the
 * layout chips' category colours. Widths in em, so it scales with the name.
 */
const BASELINE: Array<{ color: string; width: string } | null> = [
  { color: CAT_COLOR.project!, width: "2.6em" },
  { color: CAT_COLOR.git!, width: "1.3em" },
  { color: CAT_COLOR.usage!, width: "0.8em" },
  null,
  { color: CAT_COLOR.context!, width: "1.75em" },
];

/**
 * The prompt chevron of the wordmark (and of the first-run welcome), drawn rather than typed: ❯ is
 * missing from the usual monospace fonts, and the fallback glyph came out small and sitting low.
 * Sized in em (see .brand-prompt), so it follows the text it stands beside. Decorative.
 */
export function PromptMark() {
  return (
    <svg className="brand-prompt" viewBox="0 0 10 12" aria-hidden="true" focusable="false">
      <path d="M2.2 1.6 7.8 6l-5.6 4.4" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Where the wordmark's cursor remembers being paused (per browser; storage can throw, then it just isn't remembered). */
const CURSOR_PAUSED_KEY = "ssp.cursorPaused";

function readCursorPaused(): boolean {
  try {
    return localStorage.getItem(CURSOR_PAUSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The product's name as the page heading (styles and rationale at .brand in index.css). The prompt,
 * the cursor and the hairline are decoration, so the heading reads "super-statusline". It is a proper
 * name, the same in every language, so it isn't a locale string.
 *
 * The cursor blinks for as long as the page is open, so it is also the way to stop it (WCAG 2.2.2): a
 * real button, reachable by keyboard, that remembers the choice. The heading keeps a fixed name so the
 * button inside it does not become part of it.
 */
function Wordmark() {
  const t = useT();
  const [paused, setPaused] = useState(readCursorPaused);
  const toggle = () => {
    const next = !paused;
    setPaused(next);
    try {
      localStorage.setItem(CURSOR_PAUSED_KEY, next ? "1" : "0");
    } catch {
      /* not remembered; still applies for this page view */
    }
  };
  const label = paused ? t.header.cursorResume : t.header.cursorPause;
  return (
    <h1 className="brand mono" aria-label="super-statusline">
      <PromptMark />
      <span className="brand-word">
        <span>
          <span className="brand-super">super</span>-statusline
          <button type="button" className="brand-cursor" data-paused={paused} aria-pressed={paused} aria-label={label} title={label} onClick={toggle} />
        </span>
        <span className="brand-base" aria-hidden="true">
          {BASELINE.map((seg, i) => (seg ? <span key={i} style={{ width: seg.width, background: seg.color }} /> : <span key={i} style={{ flex: 1 }} />))}
        </span>
      </span>
    </h1>
  );
}

export function Header() {
  const t = useT();
  const s = useStore();
  const [diagnostics, setDiagnostics] = useState(false);
  const { state, text } = statusOf(s, t);
  return (
    <>
    <header className="topbar">
      <div className="topbar-id">
        <Wordmark />
        {s.sandbox && (
          <span className="tag tag-warn" title={t.header.sandboxTitle}>
            {t.header.sandbox}
          </span>
        )}
        {s.demo && (
          <span className="tag tag-warn" title={t.header.demoTitle}>
            {t.header.demo}
          </span>
        )}
        {/* Polite live region: screen readers hear "Saving… / Saved" without focus moving. */}
        <span className="status" data-state={state} role="status" title={s.saveError ? `${t.header.saveFailed}: ${s.saveError}` : t.header.statusDetail}>
          <span className="status-text">{text}</span>
          {state === "error" && (
            <button className="linklike" onClick={() => void s.saveNow()}>
              {t.header.retry}
            </button>
          )}
        </span>
      </div>
      <div className="topbar-actions">
        <ScopeSelect />
        {/* Applying is the one step a first-time user must take, so it stays visible until done; afterwards "Re-apply" is a repair tool and lives in the menu. */}
        {s.installed !== true && !s.demo && (
          <button className="btn btn-primary" onClick={() => void s.install()} title={t.header.applyTitle}>
            {t.header.apply}
          </button>
        )}
        <LangToggle />
        <AppearanceToggle />
        <Popover label={t.header.more} buttonClassName="btn btn-ghost btn-icon" buttonContent={<Icon name="more" />} align="end">
          {(close) => <HeaderMenu close={close} openDiagnostics={() => setDiagnostics(true)} />}
        </Popover>
      </div>
    </header>
    <ConsentBanner />
    {diagnostics && <Diagnostics onClose={() => setDiagnostics(false)} />}
    </>
  );
}
