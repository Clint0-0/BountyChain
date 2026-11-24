import { Link } from "react-router-dom";
import { fmtEth, fmtDate, programPhase, SEVERITY } from "../lib/contract";
import { PhaseBadge, Badge } from "./ui";

export default function ProgramCard({ p, to }) {
  const phase = programPhase(p);
  return (
    <Link to={to || `/programs/${p.id}`} className="program-card">
      <div className="pc-head">
        <div>
          <div className="pc-org">{p.meta?.organizationName || "Unknown organization"}</div>
          <h3>{p.title}</h3>
        </div>
        <PhaseBadge phase={phase} />
      </div>
      <p className="pc-desc">{p.meta?.description?.slice(0, 140) || <span className="muted">Off-chain description unavailable</span>}{p.meta?.description?.length > 140 ? "…" : ""}</p>
      <div className="tiers">
        {p.rewards.map((r, i) => (
          <div key={i} className={`tier tier-${i + 1}`}>
            <span>{SEVERITY[i + 1]}</span>
            <b>{fmtEth(r, 3)}</b>
          </div>
        ))}
      </div>
      <div className="pc-foot">
        <span>
          Pool <b>{fmtEth(p.availableBalance, 3)}</b>
        </span>
        <span className="muted">Ends {fmtDate(p.endTime)}</span>
        <Badge>{p.submissionCount} reports</Badge>
      </div>
    </Link>
  );
}
