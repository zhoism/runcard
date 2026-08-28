import { useEffect, useRef } from "react";
import * as $3Dmol from "3dmol";
export function Viewer({ url, ligand }: { url: string; ligand: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const v = $3Dmol.createViewer(ref.current, { backgroundColor: "#0b0f14" });
    let alive = true;
    fetch(url).then(r => r.text()).then(pdb => {
      if (!alive) return;
      v.addModel(pdb, "pdb");
      v.setStyle({}, { cartoon: { color: "spectrum" } });
      if (ligand) { v.setStyle({ resn: ligand }, { stick: { radius: 0.25 } }); v.addSurface($3Dmol.SurfaceType.VDW, { opacity: 0.25, color: "white" }, { resn: ligand }); }
      v.zoomTo(); v.render();
    });
    return () => { alive = false; };
  }, [url, ligand]);
  return <div ref={ref} className="viewer" />;
}
