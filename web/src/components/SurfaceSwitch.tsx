import { useT } from "../i18n";
import { useStore, type Surface } from "../store";

const SURFACES: Surface[] = ["terminal", "desktop"];

/**
 * Which layout the page is about: the terminal statusline, or the desktop app's band (drawn by the
 * mod). It sits in the masthead beside the preview because it changes the preview too, and the masthead
 * stays in view while the layout below is edited. The desktop has no statusLine, so it gets its own lines.
 */
export function SurfaceSwitch() {
  const t = useT();
  const surface = useStore((s) => s.surface);
  const setSurface = useStore((s) => s.setSurface);
  return (
    <span className="seg" role="group" aria-label={t.layout.surface}>
      {SURFACES.map((o) => (
        <button key={o} type="button" aria-pressed={surface === o} onClick={() => setSurface(o)}>
          {t.layout.surfaces[o]}
        </button>
      ))}
    </span>
  );
}
