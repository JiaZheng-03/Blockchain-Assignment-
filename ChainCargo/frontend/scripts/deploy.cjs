const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  if (hre.network.name === "sepolia" && !process.env.DEPLOYER_PRIVATE_KEY) {
    throw new Error(
      "DEPLOYER_PRIVATE_KEY is missing. Copy .env.example to .env and add the funded Sepolia deployer wallet key.",
    );
  }
  if (hre.network.name === "sepolia" && !process.env.SEPOLIA_RPC_URL) {
    throw new Error(
      "SEPOLIA_RPC_URL is missing. Copy .env.example to .env and add your Sepolia RPC endpoint.",
    );
  }

  const network = await hre.ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const isSepolia = chainId === 11155111;
  if (hre.network.name === "sepolia" && !isSepolia) {
    throw new Error(`Refusing deployment: expected Sepolia chain 11155111, received ${chainId}.`);
  }

  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error("No deployer signer is configured.");
  const deployerBalance = await hre.ethers.provider.getBalance(deployer.address);
  if (deployerBalance === 0n) {
    throw new Error("The deployer wallet has no Sepolia ETH for contract deployment gas.");
  }

  const Escrow = await hre.ethers.getContractFactory("LogisticsEscrow");
  const escrow = await Escrow.deploy();
  await escrow.waitForDeployment();
  const deploymentReceipt = await escrow.deploymentTransaction().wait();

  const address = await escrow.getAddress();
  const artifact = await hre.artifacts.readArtifact("LogisticsEscrow");
  const output = {
    address,
    chainId,
    deploymentBlock: deploymentReceipt.blockNumber,
    abi: artifact.abi,
  };

  const target = path.join(__dirname, "..", "src", "contracts", "deployment.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`);

  console.log(`LogisticsEscrow deployed by ${deployer.address}`);
  console.log(`Contract address: ${address}`);
  if (isSepolia) console.log(`Explorer: https://sepolia.etherscan.io/address/${address}`);
  console.log(`Frontend deployment written to ${target}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
