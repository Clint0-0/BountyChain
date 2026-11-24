import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useWeb3 } from "../context/Web3Context";
import { short, CHAINS, deployment } from "../lib/contract";
import { Badge } from "./ui";

export default function Navbar() {
  const { account, chainId, correctNetwork, roles, connect, disconnect, switchNetwork, connecting, hasMetaMask } = useWeb3();
  const [open, setOpen] = useState(false);

  // Navigation filtered by ON-CHAIN role (contract still enforces everything).
  const links = [
    { to: "/", label: "Home", show: true },
    { to: "/programs", label: "Explore Programs", show: true },
    { to: "/submissions", label: "My Submissions", show: !!account && !roles.isAdmin },
    { to: "/organization", label: "Organization", show: roles.isOrg },
    { to: "/verifier", label: "Verifier", show: roles.isVerifier },
    { to: "/disputes", label: "Dispute Resolution", show: roles.isResolver },
    { to: "/admin", label: "Admin Panel", show: roles.isAdmin },
  ].filter((l) => l.show);

  const roleBadges = [
    roles.isAdmin && "Admin",
    roles.isOrg && "Organization",
    roles.isVerifier && `Verifier (${roles.verifierProgramCount})`,
    roles.isResolver && "Dispute Resolver",
  ].filter(Boolean);

  return (
    <header className="nav">
      <div className="nav-inner">
        <NavLink to="/" className="brand" onClick={() => setOpen(false)}>
          <img src="/shield.svg" alt="" width="26" height="26" />
          <span>
            Bounty<b>Chain</b>
          </span>
        </NavLink>
        <button className="nav-toggle" onClick={() => setOpen(!open)} aria-label="Toggle menu">
          ☰
        </button>
        <nav className={`nav-links ${open ? "open" : ""}`}>
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.to === "/"} onClick={() => setOpen(false)}>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="wallet">
          {account && (
            <span className={`net ${correctNetwork ? "ok" : "bad"}`} title={`chainId ${chainId}`}>
              <span className="dot" />
              {CHAINS[chainId]?.name || `Chain ${chainId}`}
            </span>
          )}
          {account && !correctNetwork && deployment && (
            <button className="btn btn-warn btn-sm" onClick={switchNetwork}>
              Switch to {CHAINS[deployment.chainId]?.name}
            </button>
          )}
          {account ? (
            <div className="wallet-chip">
              <span className="mono">{short(account)}</span>
              {roleBadges.length ? roleBadges.map((r) => <Badge key={r} tone="accent">{r}</Badge>) : <Badge>Researcher</Badge>}
              <button className="btn btn-ghost btn-sm" onClick={disconnect} title="Disconnect">
                ⏏
              </button>
            </div>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={connect} disabled={connecting || !hasMetaMask}>
              {hasMetaMask ? (connecting ? "Connecting…" : "Connect MetaMask") : "MetaMask not found"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
