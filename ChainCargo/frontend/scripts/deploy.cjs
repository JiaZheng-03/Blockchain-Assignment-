const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const Escrow = await hre.ethers.getContractFactory("LogisticsEscrow");
  const escrow = await Escrow.deploy();
  await escrow.waitForDeployment();

  const address = await escrow.getAddress();
  const network = await hre.ethers.provider.getNetwork();
  const artifact = await hre.artifacts.readArtifact("LogisticsEscrow");
  const output = {
    address,
    chainId: Number(network.chainId),
    abi: artifact.abi,
  };

  const target = path.join(__dirname, "..", "src", "contracts", "deployment.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`);

  console.log(`LogisticsEscrow deployed to ${address}`);
  console.log(`Frontend deployment written to ${target}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
