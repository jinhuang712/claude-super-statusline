import { useEffect, useState } from "react";
import { api, type DoctorReport } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import { Drawer } from "./Drawer";

/**
 * A skipped project widget folder `<root>/.claude/claude-super-statusline/widgets` → its project
 * root. `claude-code-ssp` is the folder's pre-0.4.0 name, still loaded where a project has it.
 */
function projectRootOf(dir: string): string {
  return dir.replace(/[\\/]\.claude[\\/]claude-code-(?:super-statusline|ssp)[\\/]widgets[\\/]?$/, "");
}

/** Where every setting came from, which custom widgets loaded (or were refused), and raw inputs. */
function DoctorReportView() {
  const t = useT();
  const cwd = useStore((s) => s.projectCwd);
  const trustProject = useStore((s) => s.trustProject);
  const [r, setR] = useState<DoctorReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => api.doctor(cwd).then(setR).catch((e) => setErr(String(e)));
  useEffect(() => {
    void load();
    // Reload when the previewed project changes: layers and skipped widgets are per project.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);
  if (err) return <p className="hint">{t.doctor.failed(err)}</p>;
  if (!r) return <p className="hint">{t.doctor.loading}</p>;
  const skipped = r.plugins.skipped ?? [];
  return (
    <div className="flex flex-col gap-3">
      <div className="row">
        <span>{t.doctor.layers}</span>
        <button className="btn" onClick={() => void load()}>
          {t.doctor.refresh}
        </button>
      </div>
      <div>
        {r.layers.map((l) => (
          <div key={l.name} className="mono text-xs flex gap-2">
            <span style={{ color: l.exists ? "var(--fg)" : "var(--muted)" }}>{l.exists ? "✓" : "–"}</span>
            <span className="w-20 shrink-0">{t.doctor.layerNames[l.name] ?? l.name}</span>
            <span className="hint truncate" title={l.path ?? undefined}>
              {l.path ?? t.doctor.builtIn}
            </span>
            {l.error && <span style={{ color: "var(--danger)" }}>{l.error}</span>}
          </div>
        ))}
      </div>
      <div>
        <div className="hint mb-1">{t.doctor.pluginDirs}</div>
        {r.plugins.dirs.map((d) => (
          <div key={d} className="mono text-xs hint truncate" title={d}>
            {d}
          </div>
        ))}
        {r.plugins.loaded.map((p) => (
          <div key={p.file} className="mono text-xs">
            ✓ {p.file} → {p.ids.join(", ")}
          </div>
        ))}
        {r.plugins.errors.map((e) => (
          <div key={e.file} className="mono text-xs" style={{ color: "var(--danger)" }}>
            ✗ {e.file}: {e.message}
          </div>
        ))}
        {skipped.map((sk) => (
          <div key={sk.dir} className="skipped">
            <div className="mono text-xs">
              <span style={{ color: "var(--warn)" }}>
                ⊘ {t.doctor.skipped}: {sk.dir}
              </span>{" "}
              <span className="hint">({sk.reason})</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button className="btn" onClick={() => void trustProject(projectRootOf(sk.dir)).then(load)}>
                {t.doctor.trust}
              </button>
              <span className="hint">{t.doctor.trustHint}</span>
            </div>
          </div>
        ))}
        {!r.plugins.loaded.length && !r.plugins.errors.length && !skipped.length && <div className="hint text-xs">{t.doctor.noPlugins}</div>}
      </div>
      <details className="text-xs">
        <summary className="hint cursor-pointer">{t.doctor.statusLine(r.settings.path)}</summary>
        <pre className="mono mt-1 max-h-40 overflow-auto p-2 text-xs" style={{ background: "var(--bg-deep)", borderRadius: "var(--r-1)" }}>
          {r.settings.error ?? JSON.stringify(r.settings.statusLine, null, 2)}
        </pre>
      </details>
      <details className="text-xs">
        <summary className="hint cursor-pointer">{t.doctor.lastStdin(r.lastPayload?.capturedAt ? new Date(r.lastPayload.capturedAt).toLocaleTimeString() : "")}</summary>
        <pre className="mono mt-1 max-h-72 overflow-auto p-2 text-xs" style={{ background: "var(--bg-deep)", borderRadius: "var(--r-1)" }}>
          {r.lastPayload ? JSON.stringify(r.lastPayload.payload, null, 2) : t.doctor.notCaptured}
        </pre>
      </details>
    </div>
  );
}

/**
 * Diagnostics as a dialog opened from the header menu. It used to be a page section, but it is for
 * debugging (config layers, plugin loading, raw stdin), not for shaping the statusline — the page
 * now only holds what people edit.
 */
export function Diagnostics({ onClose }: { onClose: () => void }) {
  const t = useT();
  const c = useStore((s) => s.config!);
  const [pluginsA, pluginsB] = t.doctor.pluginsHint;
  return (
    <Drawer label={t.doctor.title} onClose={onClose}>
      <div className="sheet-head">
        <h3 className="sheet-title">{t.doctor.title}</h3>
        <button className="btn ml-auto" onClick={onClose}>
          {t.doctor.close}
        </button>
      </div>
      <div className="sheet-body">
        <DoctorReportView />
        <details className="text-xs">
          <summary className="hint cursor-pointer">{t.doctor.configJson}</summary>
          <pre className="mono mt-1 max-h-64 overflow-auto p-2 text-xs" style={{ background: "var(--bg-deep)", borderRadius: "var(--r-1)" }}>
            {JSON.stringify(c, null, 2)}
          </pre>
        </details>
        <p className="hint">
          {pluginsA}
          <code className="mono">~/.config/claude-super-statusline/widgets/</code>
          {pluginsB}
        </p>
      </div>
    </Drawer>
  );
}
