import { useState } from "react";
import { usePrograms } from "../lib/hooks";
import { programPhase } from "../lib/contract";
import ProgramCard from "../components/ProgramCard";
import { Loading, ErrorBox, Empty } from "../components/ui";

export default function Programs() {
  const { data, loading, error } = usePrograms();
  const [q, setQ] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(true);
  const list = (data || []).filter((p) => {
    if (onlyOpen && programPhase(p) !== "Open") return false;
    const hay = `${p.title} ${p.meta?.organizationName || ""} ${p.meta?.description || ""}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Explore programs</h1>
          <p className="muted">Live bounty programs read directly from the BountyPlatform contract.</p>
        </div>
        <div className="filters">
          <input className="input" placeholder="Search programs…" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="check">
            <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Open only
          </label>
        </div>
      </div>
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : list.length ? (
        <div className="grid-cards">
          {list.map((p) => (
            <ProgramCard key={p.id} p={p} />
          ))}
        </div>
      ) : (
        <Empty title="No programs found" icon="🔍">
          {data?.length ? "Try clearing the filters." : "No organization has published a bounty program yet."}
        </Empty>
      )}
    </div>
  );
}
