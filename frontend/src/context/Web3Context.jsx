// Wallet connection, network detection, on-chain roles and backend session.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { deployment, getContract, RPC_URL, CHAINS } from "../lib/contract";
import { api } from "../lib/api";

const Web3Ctx = createContext(null);
export const useWeb3 = () => useContext(Web3Ctx);

// cacheTimeout -1: always fetch fresh state after a transaction (ethers caches identical calls for 250 ms by default)
const readProvider = deployment ? new ethers.JsonRpcProvider(RPC_URL, deployment.chainId, { staticNetwork: true, cacheTimeout: -1 }) : null;

function storageGet(k) {
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
}
function storageSet(k, v) {
  try {
    if (v === null) sessionStorage.removeItem(k);
    else sessionStorage.setItem(k, v);
  } catch {
    /* storage unavailable: session kept in memory only */
  }
}

const EMPTY_ROLES = { isAdmin: false, isOrg: false, isResolver: false, isVerifier: false, verifierProgramCount: 0, loaded: false };

export function Web3Provider({ children }) {
  const hasMetaMask = typeof window !== "undefined" && !!window.ethereum;
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [signer, setSigner] = useState(null);
  const [roles, setRoles] = useState(EMPTY_ROLES);
  const [token, setToken] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);

  const correctNetwork = deployment && chainId === deployment.chainId;
  const readContract = useMemo(() => (readProvider ? getContract(readProvider) : null), []);
  const writeContract = useMemo(() => (signer && correctNetwork ? getContract(signer) : null), [signer, correctNetwork]);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const syncWallet = useCallback(async () => {
    if (!window.ethereum) return;
    const provider = new ethers.BrowserProvider(window.ethereum);
    const accounts = await provider.send("eth_accounts", []);
    const net = await provider.getNetwork();
    setChainId(Number(net.chainId));
    if (accounts.length) {
      const addr = ethers.getAddress(accounts[0]);
      setAccount(addr);
      setSigner(await provider.getSigner(addr));
      setToken(storageGet(`bc_token_${addr.toLowerCase()}`));
    } else {
      setAccount(null);
      setSigner(null);
      setToken(null);
    }
  }, []);

  // Restore an existing permission silently (no popup) + listen to wallet events.
  useEffect(() => {
    if (!window.ethereum) return;
    syncWallet().catch(() => {});
    const onAccounts = () => {
      setRoles(EMPTY_ROLES);
      syncWallet().catch(() => {});
    };
    const onChain = () => syncWallet().catch(() => {});
    window.ethereum.on?.("accountsChanged", onAccounts);
    window.ethereum.on?.("chainChanged", onChain);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", onAccounts);
      window.ethereum.removeListener?.("chainChanged", onChain);
    };
  }, [syncWallet]);

  // Load on-chain roles whenever the account or chain state changes.
  useEffect(() => {
    if (!account || !readContract) return setRoles(EMPTY_ROLES);
    let cancelled = false;
    readContract
      .getRoles(account)
      .then(([isAdmin, isOrg, isResolver, vCount]) => {
        if (!cancelled)
          setRoles({ isAdmin, isOrg, isResolver, isVerifier: vCount > 0n, verifierProgramCount: Number(vCount), loaded: true });
      })
      .catch((e) => !cancelled && setError(`Cannot read roles from chain: ${e.shortMessage || e.message}`));
    return () => {
      cancelled = true;
    };
  }, [account, readContract, refreshKey]);

  const connect = useCallback(async () => {
    setError(null);
    if (!window.ethereum) return setError("MetaMask not detected. Install the MetaMask browser extension.");
    setConnecting(true);
    try {
      await window.ethereum.request({ method: "eth_requestAccounts" });
      await syncWallet();
    } catch (e) {
      setError(e.code === 4001 ? "Connection request rejected." : e.message);
    } finally {
      setConnecting(false);
    }
  }, [syncWallet]);

  const disconnect = useCallback(async () => {
    if (account) storageSet(`bc_token_${account.toLowerCase()}`, null);
    try {
      await window.ethereum?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
    } catch {
      /* older wallets: just clear local state */
    }
    setAccount(null);
    setSigner(null);
    setToken(null);
    setRoles(EMPTY_ROLES);
  }, [account]);

  const switchNetwork = useCallback(async () => {
    if (!deployment || !window.ethereum) return;
    const hex = "0x" + deployment.chainId.toString(16);
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch (e) {
      if (e.code === 4902) {
        const c = CHAINS[deployment.chainId] || {};
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: hex, chainName: c.name || "BountyChain", rpcUrls: [deployment.chainId === 31337 ? RPC_URL : c.rpc], nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 } }],
        });
      } else setError(e.message);
    }
  }, []);

  /** Wallet-signature login to the backend (no gas). Returns JWT. */
  const ensureSession = useCallback(async () => {
    if (token) return token;
    if (!signer || !account) throw new Error("Connect your wallet first.");
    const { message } = await api(`/api/auth/nonce?address=${account}`);
    let signature;
    try {
      signature = await signer.signMessage(message);
    } catch (e) {
      throw new Error(e.code === "ACTION_REJECTED" ? "Signature request rejected." : e.message);
    }
    const r = await api("/api/auth/verify", { method: "POST", body: { address: account, signature } });
    storageSet(`bc_token_${account.toLowerCase()}`, r.token);
    setToken(r.token);
    return r.token;
  }, [token, signer, account]);

  /** Calls the API with a session; re-authenticates once if the token expired. */
  const authedApi = useCallback(
    async (path, opts = {}) => {
      let t = await ensureSession();
      try {
        return await api(path, { ...opts, token: t });
      } catch (e) {
        if (e.status !== 401) throw e;
        storageSet(`bc_token_${account.toLowerCase()}`, null);
        setToken(null);
        const { message } = await api(`/api/auth/nonce?address=${account}`);
        const signature = await signer.signMessage(message);
        const r = await api("/api/auth/verify", { method: "POST", body: { address: account, signature } });
        storageSet(`bc_token_${account.toLowerCase()}`, r.token);
        setToken(r.token);
        return api(path, { ...opts, token: r.token });
      }
    },
    [ensureSession, account, signer]
  );

  const value = {
    hasMetaMask,
    account,
    chainId,
    correctNetwork,
    signer,
    roles,
    token,
    connecting,
    error,
    setError,
    connect,
    disconnect,
    switchNetwork,
    ensureSession,
    authedApi,
    readContract,
    writeContract,
    readProvider,
    refreshKey,
    refresh,
  };
  return <Web3Ctx.Provider value={value}>{children}</Web3Ctx.Provider>;
}
