import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { Web3Provider } from "./context/Web3Context";
import { TxProvider } from "./context/TxContext";
import { deployment } from "./lib/contract";
import "./styles.css";

function SetupNeeded() {
  return (
    <div className="setup">
      <img src="/shield.svg" width="56" alt="" />
      <h1>Contract not deployed yet</h1>
      <p>The frontend could not find <code>src/contracts/BountyPlatform.json</code>. Start the local chain and deploy:</p>
      <pre className="code">{`cd blockchain\nnpx hardhat node            # terminal 1\nnpm run deploy:local        # terminal 2`}</pre>
      <p>Then restart <code>npm run dev</code>.</p>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {deployment ? (
      <BrowserRouter>
        <Web3Provider>
          <TxProvider>
            <App />
          </TxProvider>
        </Web3Provider>
      </BrowserRouter>
    ) : (
      <SetupNeeded />
    )}
  </React.StrictMode>
);
