import { Link } from "react-router-dom";
import { useWeb3 } from "../context/Web3Context";
import { useAsync } from "../lib/hooks";
import { fmtEth, deployment, short, CHAINS } from "../lib/contract";
import { Stat, Loading, ErrorBox } from "../components/ui";

export default function Home() {
  const { readContract, account, connect, roles, hasMetaMask } = useWeb3();
  const stats = useAsync(async () => {
    const s = await readContract.getStats();
    return { orgs: Number(s.orgs), programs: Number(s.programs), submissions: Number(s.submissions), disputes: Number(s.disputes), distributed: s.distributed };
  }, [readContract]);

  return (
    <div className="page">
      <section className="hero">
        <div className="hero-text">
          <div className="eyebrow">Decentralized vulnerability disclosure</div>
          <h1>
            Bug bounties with <span className="grad">on-chain accountability</span>.
          </h1>
          <p>
            Organizations lock rewards in a smart contract. Researchers submit encrypted reports anchored by a hash. Authorized verifiers decide,
            the contract pays exactly the predefined tier, and disputes are resolved transparently.
          </p>
          <div className="hero-cta">
            <Link className="btn btn-primary" to="/programs">
              Explore programs
            </Link>
            {!account && hasMetaMask && (
              <button className="btn btn-outline" onClick={connect}>
                Connect wallet
              </button>
            )}
            {roles.isOrg && (
              <Link className="btn btn-outline" to="/organization">
                Launch a program
              </Link>
            )}
          </div>
        </div>
        <div className="hero-panel mono">
          <div><span className="muted">contract</span> {short(deployment.address, 6)}</div>
          <div><span className="muted">network</span> {CHAINS[deployment.chainId]?.name || deployment.chainId}</div>
          <div><span className="muted">reports</span> hash-anchored · AES-256-GCM off-chain</div>
          <div><span className="muted">payouts</span> pull-based · nonReentrant</div>
        </div>
      </section>

      <ErrorBox error={stats.error && `Cannot read contract: ${stats.error}. Is the local node running and the contract deployed?`} />
      {stats.loading && !stats.data ? (
        <Loading />
      ) : stats.data ? (
        <div className="stats">
          <Stat label="Organizations" value={stats.data.orgs} />
          <Stat label="Bounty programs" value={stats.data.programs} />
          <Stat label="Reports submitted" value={stats.data.submissions} />
          <Stat label="Disputes" value={stats.data.disputes} />
          <Stat label="Rewards paid" value={fmtEth(stats.data.distributed, 3)} />
        </div>
      ) : null}

      <section className="steps">
        {[
          ["01", "Fund", "An authorized organization publishes scope & rules and locks a reward pool with four severity tiers."],
          ["02", "Report", "A researcher's report is encrypted on the server; only its keccak256 hash is recorded on-chain."],
          ["03", "Verify", "An assigned verifier approves with a severity — the contract reserves exactly that tier's reward."],
          ["04", "Claim / Dispute", "The researcher pulls the reward, or disputes a rejection for the resolver to decide on-chain."],
        ].map(([n, t, d]) => (
          <div className="step" key={n}>
            <div className="step-n">{n}</div>
            <h3>{t}</h3>
            <p className="muted">{d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
