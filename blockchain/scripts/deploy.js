/**
 * Deploys BountyPlatform and writes { address, abi, chainId } for the
 * frontend and backend so neither needs hand-editing.
 */
const { ethers, network, artifacts } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const admin = process.env.ADMIN_ADDRESS || deployer.address;
  console.log(`Network: ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Admin:    ${admin}`);

  const Platform = await ethers.getContractFactory("BountyPlatform");
  const platform = await Platform.deploy(admin);
  await platform.waitForDeployment();
  const address = await platform.getAddress();
  const receipt = await platform.deploymentTransaction().wait();
  const { chainId } = await ethers.provider.getNetwork();
  console.log(`BountyPlatform deployed at ${address} (tx ${receipt.hash}, block ${receipt.blockNumber})`);

  const artifact = await artifacts.readArtifact("BountyPlatform");
  const out = {
    address,
    chainId: Number(chainId),
    network: network.name,
    deployBlock: receipt.blockNumber,
    abi: artifact.abi,
  };
  const targets = [
    path.join(__dirname, "..", "..", "frontend", "src", "contracts", "BountyPlatform.json"),
    path.join(__dirname, "..", "..", "backend", "contract", "BountyPlatform.json"),
  ];
  for (const t of targets) {
    fs.mkdirSync(path.dirname(t), { recursive: true });
    fs.writeFileSync(t, JSON.stringify(out, null, 2));
    console.log(`Wrote ${path.relative(process.cwd(), t)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
