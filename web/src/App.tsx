import { useEffect, useRef, useState } from "react";
import { Header, PromptMark } from "./components/Header";
import { Layout } from "./components/Layout";
import { Preview } from "./components/Preview";
import { Style } from "./components/Style";
import { HTML_LANG, useLang, useT } from "./i18n";
import { useStore } from "./store";
import { useTheme } from "./theme";

/** First-run guide: shown until dismissed, and only while nothing has been saved yet. */
function Welcome() {
  const t = useT();
  const firstRun = useStore((s) => !s.layers.some((l) => l.name !== "defaults" && l.exists));
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem("ssp.welcomed") === "1";
    } catch {
      return false;
    }
  });
  if (!firstRun || dismissed) return null;
  return (
    <section className="section welcome" aria-labelledby="welcome-title">
      <h2 id="welcome-title" className="h2">
        <PromptMark />
        {t.welcome.title}
      </h2>
      <ol>
        {t.welcome.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      <button
        className="btn btn-primary"
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem("ssp.welcomed", "1");
          } catch {
            /* shown again next visit; harmless */
          }
        }}
      >
        {t.welcome.dismiss}
      </button>
    </section>
  );
}

/* Mirror the resolved panel scheme to <html data-theme>; index.html sets the first value pre-paint. */
function useSchemeAttr() {
  const scheme = useTheme((s) => s.scheme);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", scheme);
  }, [scheme]);
}

/* Keep <html lang> in step with the UI language: screen readers and CJK font fallback both read it. */
function useHtmlLang() {
  const lang = useLang((s) => s.lang);
  useEffect(() => {
    document.documentElement.lang = HTML_LANG[lang];
  }, [lang]);
}

function useMastheadHeight(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = () => document.documentElement.style.setProperty("--mast-h", `${el.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  });
}

export default function App() {
  const t = useT();
  const { loading, error, config, init, toast, notify, surface } = useStore();
  const mast = useRef<HTMLDivElement>(null);
  useSchemeAttr();
  useHtmlLang();
  useMastheadHeight(mast);

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => notify(null), 5000);
    return () => clearTimeout(timer);
  }, [toast, notify]);

  if (loading) return <div className="p-10 text-sm opacity-60">{t.app.loading}</div>;
  if (error || !config) {
    const [a, b, c] = t.app.unreachableHint;
    return (
      <div className="mx-auto max-w-xl p-10 text-sm">
        <p style={{ color: "var(--danger)" }}>{t.app.unreachable(error ?? "")}</p>
        <p className="mt-2 opacity-70">
          {a}
          <code className="mono">/super-statusline:config</code>
          {b}
          <code className="mono">bun run serve</code>
          {c}
        </p>
      </div>
    );
  }

  // The masthead spans the window (its bottom rule reaches both edges) while its content and the
  // page share one centred column (.wrap).
  return (
    <>
      <div className="masthead" ref={mast}>
        <div className="wrap">
          <Header />
          <Preview />
        </div>
      </div>
      <main className="wrap page">
        <Welcome />
        {/* Style first: three short summaries, then the layout (presets, and the editor in Custom), which can run long. */}
        {/* Theme, bars and separator style the terminal's statusline; the desktop band is drawn by a mod, so they rest while it is edited. */}
        <div className="surface-rest" inert={surface === "desktop"}>
          <Style />
        </div>
        <Layout />
      </main>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </>
  );
}
