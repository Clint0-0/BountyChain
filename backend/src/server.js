const { loadConfig } = require("./config");
const { initDb, openDb } = require("./db");
const { createChainReader } = require("./chain");
const { createApp } = require("./app");

async function main() {
  const config = loadConfig();
  await initDb();
  const db = openDb(config.dbPath);
  const chain = createChainReader(config);
  try {
    const net = await chain.provider.send("eth_chainId", []);
    if (Number(net) !== chain.chainId) {
      console.warn(`WARNING: RPC chainId ${Number(net)} != deployment chainId ${chain.chainId}`);
    }
    // Common mistake: Hardhat node restarted (chain wiped) without redeploying.
    if ((await chain.provider.getCode(chain.address)) === "0x") {
      console.warn(`WARNING: no contract code at ${chain.address}. Redeploy (blockchain: npm run deploy:local) and delete backend/data.`);
    }
  } catch {
    console.warn(`WARNING: cannot reach RPC at ${config.rpcUrl}. Is the Hardhat node running?`);
  }
  const app = createApp({ db, chain, config });
  app.listen(config.port, () => {
    console.log(`BountyChain backend listening on http://localhost:${config.port}`);
    console.log(`Contract ${chain.address} on chain ${chain.chainId} via ${config.rpcUrl}`);
  });
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
