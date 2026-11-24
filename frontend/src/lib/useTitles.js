// Fetches report titles for list views from the backend (authorised only).
// Does not prompt for a signature automatically: user clicks "Unlock titles".
import { useEffect, useState, useCallback } from "react";
import { useWeb3 } from "../context/Web3Context";
import { api } from "./api";

export function useTitles(ids) {
  const { token, authedApi, refreshKey } = useWeb3();
  const [titles, setTitles] = useState({});
  const [expired, setExpired] = useState(false);
  const key = (ids || []).join(",");
  useEffect(() => {
    if (!token || !key) return;
    setExpired(false);
    api(`/api/submissions/titles?ids=${key}`, { token })
      .then(setTitles)
      .catch((e) => e.status === 401 && setExpired(true)); // expired session -> show unlock button again
  }, [token, key, refreshKey]);
  const unlock = useCallback(async () => {
    if (!key) return;
    setTitles(await authedApi(`/api/submissions/titles?ids=${key}`));
    setExpired(false);
  }, [authedApi, key]);
  return { titles, unlock, unlocked: !!token && !expired };
}
