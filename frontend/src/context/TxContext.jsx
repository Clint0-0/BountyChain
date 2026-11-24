// Transaction lifecycle UI: awaiting signature -> pending (hash) -> confirmed / failed.
// Every status shown comes from the real wallet / RPC response.
import { createContext, useCallback, useContext, useState } from "react";
import { decodeError, explorerTx } from "../lib/contract";
import { useWeb3 } from "./Web3Context";

const TxCtx = createContext(null);
export const useTx = () => useContext(TxCtx);

let nextId = 1;

export function TxProvider({ children }) {
  const { chainId, refresh } = useWeb3();
  const [toasts, setToasts] = useState([]);
  const [history, setHistory] = useState([]);

  const update = (id, patch) => setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const dismiss = useCallback((id) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);

  /**
   * @param label  human description
   * @param send   () => Promise<TransactionResponse>
   * @returns receipt on success, null on failure (error already shown)
   */
  const runTx = useCallback(
    async (label, send) => {
      const id = nextId++;
      setToasts((ts) => [...ts, { id, label, state: "signing" }]);
      let tx;
      try {
        tx = await send();
        update(id, { state: "pending", hash: tx.hash, link: explorerTx(chainId, tx.hash) });
        const receipt = await tx.wait();
        if (receipt.status !== 1) throw new Error("Transaction reverted");
        update(id, { state: "success", block: receipt.blockNumber });
        setHistory((h) => [{ label, hash: tx.hash, block: receipt.blockNumber, ok: true, at: Date.now() }, ...h].slice(0, 30));
        setTimeout(() => dismiss(id), 9000);
        refresh();
        return receipt;
      } catch (e) {
        const msg = decodeError(e);
        update(id, { state: "failed", error: msg });
        if (tx) setHistory((h) => [{ label, hash: tx.hash, ok: false, error: msg, at: Date.now() }, ...h].slice(0, 30));
        return null;
      }
    },
    [chainId, refresh, dismiss]
  );

  return <TxCtx.Provider value={{ runTx, toasts, dismiss, history }}>{children}</TxCtx.Provider>;
}
