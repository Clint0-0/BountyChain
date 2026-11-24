/**
 * OPTIONAL demo helper (local only). Uses Hardhat's default accounts:
 *   #0 admin, #1 organisation, #2 verifier, #3 researcher, #4 dispute resolver
 * Registers #1 as organisation and #4 as dispute resolver so you can jump
 * straight to the org/researcher part of a demo. During a viva you can skip
 * this and do the same steps in the Admin Panel instead.
 */
const { ethers } = require("hardhat");
const dep = require("../../backend/contract/BountyPlatform.json");

async function main() {
  const [admin, org, verifier, researcher, resolver] = await ethers.getSigners();
  const platform = await ethers.getContractAt("BountyPlatform", dep.address, admin);
  if (!(await platform.isOrganization(org.address))) {
    const tx = await platform.registerOrganization(org.address, "Acme Security Labs");
    console.log("registerOrganization tx", (await tx.wait()).hash);
  }
  if ((await platform.disputeResolver()) !== resolver.address) {
    const tx = await platform.setDisputeResolver(resolver.address);
    console.log("setDisputeResolver tx", (await tx.wait()).hash);
  }
  console.log({ admin: admin.address, org: org.address, verifier: verifier.address, researcher: researcher.address, resolver: resolver.address });
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
