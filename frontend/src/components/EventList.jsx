import { describeEvent } from "../lib/hooks";
import { fmtDate } from "../lib/contract";
import { TxHash, Empty } from "./ui";

/** Vertical timeline of on-chain events with tx hashes. */
export default function EventList({ events, empty = "No on-chain events yet." }) {
  if (!events?.length) return <Empty title={empty} icon="⧗" />;
  return (
    <ol className="timeline">
      {events.map((e) => (
        <li key={`${e.hash}-${e.index}`} className={`tl-${e.name}`}>
          <div className="tl-dot" />
          <div className="tl-body">
            <div className="tl-title">{describeEvent(e)}</div>
            <div className="tl-meta">
              <span className="muted">{fmtDate(e.time)}</span> · block #{e.block} · <TxHash hash={e.hash} /> · <code>{e.name}</code>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
