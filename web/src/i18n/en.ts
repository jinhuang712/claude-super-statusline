/**
 * English UI copy — the source of truth for the message shape.
 *
 * Every other locale is typed as `Messages`, so a missing or misspelled key is a compile error
 * rather than a blank label at runtime. Strings that need values are small functions instead of
 * `{placeholder}` templates: TypeScript then checks the arguments too.
 *
 * Widget names/descriptions and option titles are deliberately *not* duplicated here: English
 * falls back to what each widget declares in its own manifest (src/widgets), so plugin authors
 * only ever write English once. The `widgets` tables below only fill gaps and friendlier wording.
 */
export const en = {
  langName: "English",
  /** The language's own short name, for the header's language switch (always shown untranslated). */
  langShort: "EN",

  app: {
    loading: "Loading…",
    unreachable: (err: string) => `Can't reach the local server: ${err}`,
    unreachableHint: ["In Claude Code, type ", " — or run ", " in a terminal."] as readonly [string, string, string],
  },

  header: {
    saving: "Saving…",
    dirty: "Unsaved changes",
    defaults: "Using defaults — nothing saved yet",
    savedLive: "Saved · live in Claude",
    savedNotApplied: "Saved · not applied to Claude Code yet",
    saved: "Saved",
    saveFailed: "Couldn't save",
    retry: "Retry",
    statusDetail: "Edits save automatically. Claude Code re-reads the config on its next statusline refresh.",
    resetCounters: "Reset counters",
    resetCountersTitle: "Restart cost, tokens, API calls and lines changed from zero. Only affects the current session.",
    resetCountersHint: "cost · tokens · calls",
    more: "More actions",
    saveAsProject: "Save as project config",
    overwriteProject: "Overwrite project config",
    apply: "Apply to Claude Code",
    applyTitle: "Point Claude Code's statusline at this configurator (once — later edits apply automatically)",
    reapply: "Re-apply",
    reapplyTitle: "Rarely needed: every save applies automatically. Use this to repair settings.json if something else changed it.",
    language: "Language",
    sandbox: "Sandbox",
    demo: "Demo",
    demoTitle: "A demo with a sample session. Your changes stay in this browser; install the plugin to use it in Claude Code.",
    demoSaved: "Changes stay in this browser",
    sandboxTitle: "This configurator edits temporary copies — nothing you change here reaches your real config or Claude Code.",
    scope: "Saving to",
    scopeUser: "Your settings (all projects)",
    scopeProject: (name: string) => `This project only (${name})`,
  },

  preview: {
    title: "Preview",
    renderTime: "Render time",
    widthLabel: "Width",
    terminalLabel: "Terminal",
    filled: (n: number) => (n === 1 ? "1 item has no real data yet — showing a sample value" : `${n} items have no real data yet — showing sample values`),
    hidden: (n: number) => (n === 1 ? "1 item has no data or sample and is hidden" : `${n} items have no data or sample and are hidden`),
    placeholder: (n: number) => (n === 1 ? "1 item has no data yet — showing its placeholder" : `${n} items have no data yet — showing their placeholder`),
    emptyLines: (n: number) => (n === 1 ? "1 line is empty as a result" : `${n} lines are empty as a result`),
    noteJoin: "; ",
    settings: "Preview settings",
    fitWindow: "Fit to window",
    fixedColumns: "Fixed",
    columnsLabel: "Columns",
    columns: (n: number) => `${n} cols`,
    /** Beside the "Preview" label while a choice is hovered, so it doesn't repeat that word. */
    tryingOn: (label: string) => `Trying on ${label} — click to apply`,
    terminalHint: "Your terminal's background, so colors are judged fairly",
    termAuto: "Match panel",
    termDark: "Dark",
    termLight: "Light",
    rightMargin: "Right margin",
    rightMarginHint: "Columns Claude Code keeps free — raise it if the right edge wraps",
    colorMode: "Colors",
    /** Full names: the switch's tooltip and accessible name, so each contains its short label. */
    colorLevels: { auto: "Auto", truecolor: "Truecolor (24-bit)", "256": "256 colors", "16": "16 colors", none: "None (no color)" } as Record<string, string>,
    colorLevelsShort: { auto: "Auto", truecolor: "24-bit", "256": "256", "16": "16", none: "None" } as Record<string, string>,
    capture: "Save session snapshots",
    /** Followed by the folder, in mono, on its own line. */
    captureWhere: "For the preview, kept in",
    on: "On",
    off: "Off",
    decrease: (what: string) => `Decrease ${what.toLowerCase()}`,
    increase: (what: string) => `Increase ${what.toLowerCase()}`,
  },

  presets: {
    lines: (n: number) => (n === 1 ? "1 line" : `${n} lines`),
    minimal: { name: "Minimal", blurb: "One line: project, branch, model, context" },
    standard: { name: "Standard", blurb: "Two lines: adds usage limits" },
    full: { name: "Full", blurb: "Four lines: adds the diff, cache, tokens and speed" },
    custom: { name: "Custom", blurb: "Build your own: pick widgets, arrange lines, set each one's options" },
  },

  layout: {
    surface: "Show on",
    surfaces: { terminal: "Terminal", desktop: "Desktop app" },
    desktopHint: "The desktop app has no statusline, so a mod draws this band above the prompt. It has its own layout and only the widgets listed below; the model, context and project are already on screen there. The preview approximates it as text. The theme, bars and separator above apply to the terminal only.",
    title: "Layout",
    hint: "Each row is one line of the statusline. Click a widget to edit it; drag it — or press Alt+Arrow keys — to reorder it or move it to another line.",
    zones: { left: "Left", center: "Center", right: "Right" },
    emptyLine: "Empty line — drag a widget here, or click one below",
    editOptions: "Edit options",
    sampleTag: "sample",
    noDataTag: "no data",
    filledTitle: "No data for this in the current session — the preview shows a sample value",
    hiddenTitle: "No data and no sample — hidden in the preview",
    placeholderTitle: "No data for this in the current session — it shows its placeholder, as in Claude Code",
    lineMenu: (n: number) => `Line ${n} options`,
    chipHelp: "Alt+Arrow keys move this widget; Enter opens its options; Delete removes it.",
    moved: (name: string, line: number, zone: string, pos: number) => `${name} moved to line ${line}, ${zone.toLowerCase()}, position ${pos}`,
    hideBelowHint: "0 = always show",
    moveUp: "Move line up",
    moveDown: "Move line down",
    deleteLine: "Delete line",
    insertAbove: "Insert line above",
    insertBelow: "Insert line below",
    insertHere: "Insert a line here",
    overflow: "When it doesn't fit",
    overflowWrap: "Continue the left side on the next row",
    overflowTruncate: "Cut the left side short (…)",
    overflowDropRight: "Hide the right side",
    hideBelow: "Hide the line below",
    columnsUnit: "columns",
    addLine: "Add line",
  },

  style: {
    title: "Style",
    hint: "Hover or focus a choice to preview it above; click to apply. Esc closes.",
    customTheme: "custom",
  },

  themes: {
    title: "Color theme",
  },

  bars: {
    title: "Progress bars",
    names: {
      theme: "Theme default",
      block: "Full block",
      rect: "Tall",
      low: "Low",
      half: "Half",
      slant: "Slanted",
      square: "Squares",
      line: "Line",
      dot: "Dots",
    },
  },

  /** Style → how every bar and percentage is coloured (config `colorMode`). */
  levels: {
    title: "Progress bar mode",
    names: { thresholds: "Thresholds", gradient: "Gradient" },
    /** Tooltips: what each mode does, with the widget options it uses. */
    hints: {
      thresholds: "Green, yellow from each widget's “Yellow at %”, red from its “Red at %”",
      gradient: "0% grey → 10% blue → 30% green → 50% yellow → 70% orange → 90% red → 100% deep red; “Yellow at %” is ignored",
    },
  },

  separators: {
    title: "Separator",
    custom: "Custom",
    customLabel: "Custom separator",
    spacesShown: "␣ marks a space",
  },

  /** Style → Empty widgets (config `emptyText`). */
  emptyText: {
    title: "Empty widgets",
    hide: "Hide",
    /** The label in each choice's sample, e.g. "Name –". */
    sampleLabel: "Name",
    customLabel: "Custom placeholder",
    hint: "What a labelled widget shows before it has data, like the session name in a new session. Hide drops it, label and all. A widget can override this in its options.",
  },

  welcome: {
    title: "Set up your statusline",
    steps: [
      "Pick a layout below — a preset, or Custom to build your own line by line.",
      "Your first edit applies it to Claude Code (it asks first if you already use another statusline).",
      "Open a Claude Code session: its real data shows up in the preview. Until then you see samples.",
    ] as readonly string[],
    dismiss: "Got it",
  },

  /** The unused widgets under the layout. */
  tray: {
    title: "Unused widgets",
    hint: "Click one to add it to the last line · drag it into any line · drag a widget back here to remove it",
    dropToRemove: "Let go to remove it from the statusline",
    empty: "Every widget is already in your statusline.",
    showAll: (n: number) => `Show all ${n}`,
    showFewer: "Show fewer",
    repeatable: "any number",
    plugin: "plugin",
    added: (name: string, line: number) => `${name} added to line ${line}. Alt+Arrow keys move it; Enter opens its options.`,
    untrusted: "This project has its own widgets, but they don't load until you trust the project:",
    /** Tray groups (each gathers related widget categories; see GROUPS in Tray.tsx). */
    groups: {
      projectGit: "Project · Git",
      modelContext: "Model · Context",
      usageCost: "Usage · Cost",
      session: "Session",
      activity: "Activity",
      environment: "Environment",
      misc: "Other",
    },
  },

  options: {
    dialog: (name: string) => `Options for ${name}`,
    where: (line: number, zone: string) => `Line ${line} · ${zone}`,
    done: "Done",
    nothingNow: "(nothing to show with the current data)",
    label: "Label",
    hidden: "Hidden",
    /** Per-widget emptyText. The field's placeholder names what it falls back to. */
    whenEmpty: "When empty",
    whenEmptyInherit: (v: string) => (v ? `Style: ${v}` : "Hidden (Style)"),
    whenEmptyNoLabel: "Hidden (no label)",
    show: "Show",
    hide: "Hide",
    on: "On",
    off: "Off",
    needs: (field: string, value: string) => `Only applies when “${field}” is ${value}`,
    toggles: "Show",
    thresholds: "Thresholds",
    warnAt: "Yellow at %",
    critAt: "Red at %",
    // Under the gradient colour mode the critical threshold no longer turns the value red, only bold.
    critBold: "Bold at %",
    // "Text color", not "Color": it is the instance's own colour, not the Progress bar mode.
    color: "Text color",
    colors: { "": "Default", fg: "Text", muted: "Muted", accent: "Accent", ok: "Green", warn: "Yellow", crit: "Red" } as Record<string, string>,
    custom: "Custom",
    pickColor: "Pick a color",
    bold: "Bold",
    removeWidget: "Remove from statusline",
  },

  doctor: {
    title: "Diagnostics",
    close: "Close",
    configJson: "Config JSON",
    pluginsHint: ["Custom widgets: drop a .ts / .js file into ", ", restart the server, and it shows up under Unused widgets. See examples/widgets/hello.ts."] as readonly [string, string],
    refresh: "Refresh",
    loading: "Loading diagnostics…",
    failed: (err: string) => `Couldn't load diagnostics: ${err}`,
    layers: "Config sources (later ones win)",
    layerNames: { defaults: "Defaults", user: "User", project: "Project" } as Record<string, string>,
    builtIn: "(built in)",
    pluginDirs: "Custom widget folders",
    noPlugins: "No custom widgets loaded",
    statusLine: (path: string) => `statusLine in settings.json (${path})`,
    lastStdin: (time: string) => (time ? `Last stdin from Claude Code (${time})` : "Last stdin from Claude Code"),
    notCaptured: "Nothing captured yet — turn on “Save real stdin snapshots” in the preview settings.",
    skipped: "Not loaded",
    trust: "Trust this project",
    trustHint: "Project widgets are code that runs on every statusline refresh. Only trust projects whose code you trust.",
  },

  consent: {
    title: "Claude Code already has a statusline",
    body: "Applying this one replaces it. The current one is kept and can be put back any time from the ⋯ menu.",
    replace: "Replace it",
    notNow: "Not now",
  },

  restore: {
    title: "Stop using this statusline",
    previous: "Puts back the statusline it replaced:",
    none: "Removes it from settings.json (there was no statusline before).",
    restoreButton: "Restore previous",
    removeButton: "Remove",
    cancel: "Cancel",
  },

  /** The ⋯ menu's refresh timer: statusLine.refreshInterval in settings.json. */
  refresh: {
    title: "Refresh",
    /** The menu row: the label with its current value (the colon differs per language). */
    row: (value: string) => `Refresh: ${value}`,
    every: (n: number) => `every ${n} s`,
    onEvents: "new messages only",
    hint: "Claude Code also re-runs the statusline on this timer, so saved changes and the clock show up without a new message. Written to settings.json.",
    optionEvents: "Only on new messages",
    optionEvery: (n: number) => `Every ${n} s`,
  },

  /** Viewer preferences in the header menu (per browser, never saved to the config). */
  prefs: {
    appearance: "Appearance",
    system: "System",
    light: "Light",
    dark: "Dark",
    source: "Source",
  },

  toast: {
    savedProject: "Saved as project config. Its lines replace your user layout entirely, so later edits here only change the other settings.",
    saveFailed: (e: string) => `Couldn't save: ${e}`,
    installed: (file: string) => `Written to ${file}. Open a new Claude Code session to see it.`,
    installFailed: (e: string) => `Couldn't apply: ${e}`,
    reset: (id: string) => `Counters reset for session ${id}… — cost, tokens, API calls and lines changed restart from 0 on the next refresh`,
    resetFailed: (e: string) => `Couldn't reset: ${e}`,
    previewFailed: (e: string) => `Preview failed: ${e}`,
    trusted: (dir: string) => `Trusted ${dir}. Its widgets load in the statusline right away; restart the configurator to see them under Unused widgets.`,
    restored: "Your previous statusline is back. Open a new Claude Code session to see it.",
    uninstalled: "Removed from settings.json. Claude Code shows its default statusline again.",
    uninstallFailed: (e: string) => `Couldn't restore: ${e}`,
    refreshSet: (n: number) => `The statusline now refreshes every ${n} s, and on every new message.`,
    refreshOff: "The statusline now refreshes only when a new message arrives.",
    refreshFailed: (e: string) => `Couldn't change the refresh: ${e}`,
  },

  widgets: {
    /** Overrides for manifest names; English uses the manifest as-is. */
    names: {} as Record<string, string>,
    /** Overrides for manifest descriptions. */
    descs: {} as Record<string, string>,
    categories: {
      model: "Model",
      project: "Project",
      git: "Git",
      context: "Context",
      usage: "Usage",
      tokens: "Tokens",
      cost: "Cost",
      session: "Session",
      activity: "Activity",
      environment: "Environment",
      misc: "Other",
    } as Record<string, string>,
    /** Titles for options whose schema has none (the schema title wins when present). */
    fields: {
      label: "Label",
      color: "Color",
      format: "Format",
      max: "Show at most",
      showClaudeMd: "Count CLAUDE.md files",
      showDescription: "Show description",
      showHooks: "Count hooks",
      showMcp: "Count MCP servers",
      showModel: "Show model",
      showRules: "Count rules",
      text: "Text",
      url: "Link address",
      value: "Value",
      window: "Window",
    } as Record<string, string>,
    /** Short legends shown next to an option's title. */
    fieldHints: {
      name: "Required, e.g. AWS_PROFILE — nothing shows until it is set",
      effortStyle: "Symbols: ○ low · ◔ medium · ◑ high · ◕ xhigh · ● max",
      files: "From git status. Letters: A added (new files too) · M modified · D deleted · R renamed. Symbols: ! modified · + staged new · ✘ deleted · ? untracked · → renamed",
    } as Record<string, string>,
    /** Friendly names for enum values, shared by every widget. */
    enums: {
      full: "Full",
      compact: "Compact",
      short: "Shortest",
      tilde: "~ relative",
      percent: "Percent",
      tokens: "Tokens",
      remaining: "Remaining",
      both: "Both",
      used: "Used",
      words: "Words",
      arrows: "Arrows",
      relative: "Countdown",
      absolute: "Clock time",
      transcript: "Transcript",
      stdin: "Reported by Claude Code",
      datetime: "Date + time",
      time: "Time only",
      name: "Name",
      "owner/name": "owner/name",
      "5h": "5 hours",
      "7d": "7 days",
      "1": "1 level",
      "2": "2 levels",
      "3": "3 levels",
    } as Record<string, string>,
    /** Per-widget wording where the shared words would hide what an option really does. */
    enumsByField: {
      "model.badge.format": { full: "As reported", compact: "Drop “(1M context)”", short: "Also drop “Claude”" },
      "model.badge.effortStyle": { "symbol-word": "Symbol + word", word: "Word only", symbol: "Symbol only" },
      "model.effort.effortStyle": { "symbol-word": "Symbol + word", word: "Word only", symbol: "Symbol only" },
      "model.badge.joiner": { space: "Space", dot: "Dot ·" },
      "context.bar.value": { percent: "Used %", remaining: "Remaining %" },
      "git.linesChanged.source": { session: "Edited this session", worktree: "Uncommitted in the worktree" },
      "git.linesChanged.files": { off: "Off", total: "Count (4 files)", letters: "Letters (A1 M2 D1 R1)", symbols: "Symbols (!2 +1 ✘1 ?1)" },
      "project.path.dir": { current: "Current directory", launch: "Where Claude Code started" },
    } as Record<string, Record<string, string>>,
  },
};

export type Messages = typeof en;
