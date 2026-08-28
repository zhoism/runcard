import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import * as $3Dmol from "3dmol";

function hasWebGL(): boolean {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

export function Viewer({ url, ligand }: { url: string; ligand: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    if (!hasWebGL()) { setErr("WebGL is not available in this browser"); return; }
    let alive = true, v: any;
    try { v = $3Dmol.createViewer(ref.current, { backgroundColor: "#0b0f14" }); }
    catch (e: any) { setErr(`viewer failed: ${e?.message ?? e}`); return; }
    fetch(url).then(r => r.text()).then(pdb => {
      if (!alive) return;
      try {
        v.addModel(pdb, "pdb");
        v.setStyle({}, { cartoon: { color: "spectrum" } });
        if (ligand) { v.setStyle({ resn: ligand }, { stick: { radius: 0.25 } }); v.addSurface($3Dmol.SurfaceType.VDW, { opacity: 0.25, color: "white" }, { resn: ligand }); }
        v.zoomTo(); v.render();
      } catch (e: any) { setErr(`render failed: ${e?.message ?? e}`); }
    }).catch(e => alive && setErr(`could not load structure: ${e?.message ?? e}`));
    return () => { alive = false; };
  }, [url, ligand]);
  if (err) return <div className="viewer fallback"><span className="dim">3D view unavailable — {err}.</span> <a href={url} target="_blank" rel="noreferrer">download structure.pdb</a></div>;
  return <div ref={ref} className="viewer" />;
}

// Any card that throws renders a small notice instead of blanking the page.
export class Boundary extends Component<{ label: string; children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: any) { return { err: String(e?.message ?? e) }; }
  render() { return this.state.err ? <div className="card"><h2>{this.props.label}</h2><p className="dim">could not render: {this.state.err}</p></div> : this.props.children; }
}
