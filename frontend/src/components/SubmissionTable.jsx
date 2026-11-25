import { Link } from "react-router-dom";
import { fmtEth, fmtDate } from "../lib/contract";
import { StatusBadge, SeverityBadge, Addr, Empty } from "./ui";
import Icon from "./icons";

/** titles: optional { [id]: { title } } from backend (only for authorized users). */
export default function SubmissionTable({ subs, titles = {}, programs = {}, actions, empty = "No submissions yet." }) {
  if (!subs?.length) return <Empty title={empty} icon="file" />;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Report</th>
            <th>Program</th>
            <th>Researcher</th>
            <th>Submitted</th>
            <th>Status</th>
            <th>Severity</th>
            <th>Reward</th>
            {actions && <th />}
          </tr>
        </thead>
        <tbody>
          {subs.map((s) => (
            <tr key={s.id}>
              <td className="mono">{s.id}</td>
              <td>
                <Link to={`/submissions/${s.id}`}>{titles[s.id]?.title || <span className="muted confidential"><Icon name="lock" size={13} /> Confidential report</span>}</Link>
              </td>
              <td>{programs[s.programId]?.title || `#${s.programId}`}</td>
              <td>
                <Addr address={s.researcher} />
              </td>
              <td className="muted">{fmtDate(s.submittedAt)}</td>
              <td>
                <StatusBadge status={s.status} />
              </td>
              <td>
                <SeverityBadge severity={s.severity} />
              </td>
              <td>{s.reward > 0n ? fmtEth(s.reward) : <span className="muted">—</span>}</td>
              {actions && <td>{actions(s)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
