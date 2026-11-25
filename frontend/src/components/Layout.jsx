// App shell: left sidebar (brand, wallet, navigation) + top bar (title, search, tx history).
import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation, useNavigate, Link } from "react-router-dom";
import { useWeb3 } from "../context/Web3Context";
import { useTx } from "../context/TxContext";
import { short, CHAINS, deployment, explorerTx } from "../lib/contract";
import Icon, { Logo, AddressAvatar } from "./icons";

const REPO = "https://github.com/Clint0-0/BountyChain";

const TITLES = [
  [/^\/$/, "Overview"],
  [/^\/programs\/\d+/, "Program details"],
  [/^\/programs/, "Bounty programs"],
  [/^\/submissions\/\d+/, "Report details"],
  [/^\/submissions/, "My submissions"],
  [/^\/organization/, "Organization console"],
  [/^\/verifier/, "Verifier console"],
  [/^\/disputes/, "Dispute resolution"],
  [/^\/admin/, "Platform administration"],
];

function Sidebar({ open, onNavigate }) {
  const { account, chainId, correctNetwork, roles, connect, disconnect, switchNetwork, connecting, hasMetaMask } = useWeb3();
  const [copied, setCopied] = useState(false);

  const links = [
    { to: "/", label: "Overview", icon: "dashboard", show: true },
    { to: "/programs", label: "Bounty programs", icon: "search", show: true },
    { to: "/submissions", label: "My submissions", icon: "file", show: !!account && !roles.isAdmin },
    { to: "/organization", label: "Organization", icon: "building", show: roles.isOrg },
    { to: "/verifier", label: "Verifier", icon: "shield", show: roles.isVerifier },
    { to: "/disputes", label: "Disputes", icon: "scale", show: roles.isResolver },
    { to: "/admin", label: "Administration", icon: "settings", show: roles.isAdmin },
  ].filter((l) => l.show);

  const roleText = roles.isAdmin
    ? "Administrator"
    : [roles.isOrg && "Organization", roles.isVerifier && "Verifier", roles.isResolver && "Resolver"].filter(Boolean).join(" · ") || "Researcher";

  return (
    <aside className={`sidebar ${open ? "open" : ""}`}>
      <Link to="/" className="brand" onClick={onNavigate}>
        <Logo />
        <span>
          Bounty<b>Chain</b>
        </span>
      </Link>

      <div className="wallet-card">
        {account ? (
          <>
            <AddressAvatar address={account} />
            <div className="wallet-info">
              <div className="wallet-addr">{short(account)}</div>
              <div className="wallet-role">{roleText}</div>
            </div>
            <div className="wallet-actions">
              <button
                title={copied ? "Copied" : "Copy address"}
                onClick={() => navigator.clipboard?.writeText(account).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {})}
              >
                <Icon name={copied ? "check" : "copy"} size={15} />
              </button>
              <button title="Disconnect" onClick={disconnect}>
                <Icon name="logout" size={15} />
              </button>
            </div>
          </>
        ) : (
          <div className="wallet-empty">
            <Icon name="wallet" size={20} />
            <span>{hasMetaMask ? "No wallet connected" : "MetaMask not detected"}</span>
          </div>
        )}
      </div>

      <div className="side-label">Workspace</div>
      <nav className="side-nav">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.to === "/" || l.to === "/submissions"} onClick={onNavigate}>
            <span className="side-icon">
              <Icon name={l.icon} />
            </span>
            {l.label}
          </NavLink>
        ))}
      </nav>

      <div className="side-label">More</div>
      <nav className="side-links">
        <a href={`${REPO}#readme`} target="_blank" rel="noreferrer">Documentation</a>
        <a href={`${REPO}/blob/main/docs/PROJECT_REPORT.md`} target="_blank" rel="noreferrer">Project report</a>
        <a href={`${REPO}/blob/main/blockchain/contracts/BountyPlatform.sol`} target="_blank" rel="noreferrer">Smart contract</a>
        <a href={`${REPO}/blob/main/docs/PROJECT_REPORT.md#11-security-measures`} target="_blank" rel="noreferrer">Security model</a>
      </nav>

      <div className="side-status">
        <span>Network</span>
        <span className={`net ${account ? (correctNetwork ? "ok" : "bad") : ""}`}>
          <span className="dot" />
          {account ? CHAINS[chainId]?.name || `Chain ${chainId}` : CHAINS[deployment.chainId]?.name}
        </span>
      </div>

      {!account ? (
        <button className="btn btn-primary btn-block" onClick={connect} disabled={connecting || !hasMetaMask}>
          {connecting ? "Connecting…" : "Connect MetaMask"}
        </button>
      ) : !correctNetwork ? (
        <button className="btn btn-warn btn-block" onClick={switchNetwork}>
          Switch to {CHAINS[deployment.chainId]?.name}
        </button>
      ) : (
        <Link className="btn btn-primary btn-block" to="/programs" onClick={onNavigate}>
          Browse programs
        </Link>
      )}
      <p className="side-copy">© {new Date().getFullYear()} BountyChain. Academic blockchain project.</p>
    </aside>
  );
}

function TxBell() {
  const { history } = useTx();
  const { chainId } = useWeb3();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  return (
    <div className="bell" ref={ref}>
      <button className="icon-btn" onClick={() => setOpen(!open)} title="Transactions this session">
        <Icon name="bell" />
        {history.length > 0 && <span className="bell-count">{history.length}</span>}
      </button>
      {open && (
        <div className="bell-menu">
          <div className="bell-head">Transactions this session</div>
          {history.length === 0 && <div className="bell-empty">No transactions sent yet.</div>}
          {history.map((h) => {
            const link = explorerTx(chainId, h.hash);
            return (
              <div key={h.hash} className="bell-item">
                <span className={`status-dot ${h.ok ? "ok" : "bad"}`} />
                <div>
                  <div>{h.label}</div>
                  <div className="muted small mono">
                    {link ? <a href={link} target="_blank" rel="noreferrer">{short(h.hash, 6)}</a> : short(h.hash, 6)}
                    {h.block ? ` · block ${h.block}` : ""} {h.error ? ` · ${h.error}` : ""}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Topbar({ onMenu }) {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const title = TITLES.find(([re]) => re.test(pathname))?.[1] || "BountyChain";
  return (
    <header className="topbar">
      <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Open menu">
        <Icon name="menu" />
      </button>
      <h1 className="top-title">{title}</h1>
      <form
        className="top-search"
        onSubmit={(e) => {
          e.preventDefault();
          nav(`/programs?q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <Icon name="search" size={16} />
        <input placeholder="Search programs by title, organization or scope" value={q} onChange={(e) => setQ(e.target.value)} />
      </form>
      <TxBell />
    </header>
  );
}

export default function Layout({ children }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return (
    <div className="shell">
      <Sidebar open={open} onNavigate={() => setOpen(false)} />
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <div className="main">
        <Topbar onMenu={() => setOpen(true)} />
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
