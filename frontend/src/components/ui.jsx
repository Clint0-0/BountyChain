// Small shared UI pieces.
import { useState } from "react";
import { Link } from "react-router-dom";
import { short, explorerTx, explorerAddress, STATUS_LABEL } from "../lib/contract";
import { useWeb3 } from "../context/Web3Context";
import Icon from "./icons";

export function Badge({ children, tone = "neutral", title }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

const STATUS_TONE = { Submitted: "info", Approved: "success", Rejected: "danger", Disputed: "warn", RejectionUpheld: "danger", Claimed: "accent" };
export function StatusBadge({ status }) {
  return <Badge tone={STATUS_TONE[status] || "neutral"}>{STATUS_LABEL[status] || status}</Badge>;
}
const PHASE_TONE = { Open: "success", Upcoming: "info", Ended: "neutral", Inactive: "danger" };
export function PhaseBadge({ phase }) {
  return <Badge tone={PHASE_TONE[phase]}>{phase}</Badge>;
}
const SEV_TONE = { Low: "sev-low", Medium: "sev-med", High: "sev-high", Critical: "sev-crit" };
export function SeverityBadge({ severity }) {
  if (!severity || severity === "None") return <span className="muted">—</span>;
  return <Badge tone={SEV_TONE[severity]}>{severity}</Badge>;
}

export function CopyText({ text, display }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      className="mono copy"
      title={`${text} (click to copy)`}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setOk(true);
          setTimeout(() => setOk(false), 1200);
        }).catch(() => {});
      }}
    >
      {display || short(text)} <Icon name={ok ? "check" : "copy"} size={12} />
    </button>
  );
}

export function Addr({ address, label }) {
  const { chainId, account } = useWeb3();
  if (!address) return <span className="muted">—</span>;
  const link = explorerAddress(chainId, address);
  const you = account && address.toLowerCase() === account.toLowerCase();
  return (
    <span className="addr">
      {label && <span className="muted">{label} </span>}
      {link ? (
        <a className="mono" href={link} target="_blank" rel="noreferrer">
          {short(address)}
        </a>
      ) : (
        <CopyText text={address} />
      )}
      {you && <Badge tone="accent">you</Badge>}
    </span>
  );
}

export function TxHash({ hash }) {
  const { chainId } = useWeb3();
  const link = explorerTx(chainId, hash);
  return link ? (
    <a className="mono" href={link} target="_blank" rel="noreferrer">
      {short(hash, 6)} <Icon name="external" size={12} />
    </a>
  ) : (
    <CopyText text={hash} display={short(hash, 6)} />
  );
}

export function Empty({ title, children, icon = "grid" }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={26} /></div>
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
    </div>
  );
}

export function Loading({ text = "Loading on-chain data…" }) {
  return (
    <div className="loading">
      <span className="spinner" /> {text}
    </div>
  );
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="alert alert-danger">{String(error)}</div>;
}

export function Stat({ label, value, sub }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

/** Blocks a page unless a wallet is connected (and optionally holds a role). */
export function Gate({ need, roleName, children }) {
  const { account, correctNetwork, connect, switchNetwork, roles, hasMetaMask } = useWeb3();
  if (!hasMetaMask)
    return (
      <Empty title="MetaMask required" icon="wallet">
        Install the MetaMask extension to interact with BountyChain.
      </Empty>
    );
  if (!account)
    return (
      <Empty title="Connect your wallet" icon="wallet">
        <button className="btn btn-primary" onClick={connect}>
          Connect MetaMask
        </button>
      </Empty>
    );
  if (!correctNetwork)
    return (
      <Empty title="Wrong network" icon="chain">
        <button className="btn btn-primary" onClick={switchNetwork}>
          Switch network
        </button>
      </Empty>
    );
  if (need && !roles.loaded) return <Loading text="Reading your on-chain roles…" />;
  if (need && !need(roles))
    return (
      <Empty title="Not authorized" icon="lock">
        The connected wallet does not hold the on-chain <b>{roleName}</b> role. The smart contract would reject these actions.{" "}
        <Link to="/">Back home</Link>
      </Empty>
    );
  return children;
}

export function Section({ title, actions, children }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        {actions && <div className="card-actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
