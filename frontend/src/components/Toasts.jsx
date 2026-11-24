import { useTx } from "../context/TxContext";
import { TxHash } from "./ui";

const ICON = { signing: "✍", pending: "⏳", success: "✔", failed: "✖" };
const TEXT = { signing: "Confirm in MetaMask…", pending: "Pending confirmation…", success: "Confirmed", failed: "Failed" };

export default function Toasts() {
  const { toasts, dismiss } = useTx();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.state}`}>
          <div className="toast-icon">{t.state === "pending" || t.state === "signing" ? <span className="spinner" /> : ICON[t.state]}</div>
          <div className="toast-body">
            <div className="toast-title">{t.label}</div>
            <div className="toast-sub">
              {TEXT[t.state]}
              {t.block ? ` in block #${t.block}` : ""}
            </div>
            {t.hash && (
              <div className="toast-sub">
                Tx: <TxHash hash={t.hash} />
              </div>
            )}
            {t.error && <div className="toast-err">{t.error}</div>}
          </div>
          <button className="toast-x" onClick={() => dismiss(t.id)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
