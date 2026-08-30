const hre = require("hardhat");
const deployment = require("../src/contracts/deployment.local.json");

async function registerIfNeeded(escrow, signer, name, role) {
  const profile = await escrow.getProfile(signer.address);
  if (Number(profile.role) === 0) {
    await (await escrow.connect(signer).register(name, role)).wait();
  }
}

async function main() {
  const network = await hre.ethers.provider.getNetwork();
  if (Number(network.chainId) !== 31337 || Number(deployment.chainId) !== 31337) {
    throw new Error("Local seeding requires chain 31337 and deployment.local.json.");
  }
  if (!hre.ethers.isAddress(deployment.address || "")) {
    throw new Error("No local deployment is recorded. Run npm run deploy:local first.");
  }
  const [arbitrator, shipper, carrier] = await hre.ethers.getSigners();
  const code = await hre.ethers.provider.getCode(deployment.address);
  if (code === "0x") {
    throw new Error("No escrow contract found. Run npm run deploy:local first.");
  }

  const escrow = await hre.ethers.getContractAt(
    "LogisticsEscrow",
    deployment.address,
  );
  await registerIfNeeded(escrow, shipper, "Demo Shipper", 1);
  await registerIfNeeded(escrow, carrier, "Demo Carrier", 2);

  let agreementId = Number(await escrow.agreementCount());
  if (agreementId === 0) {
    const latestBlock = await hre.ethers.provider.getBlock("latest");
    const now = Number(latestBlock.timestamp);
    const payouts = [
      hre.ethers.parseEther("0.03"),
      hre.ethers.parseEther("0.07"),
    ];

    await (
      await escrow.connect(shipper).createAgreement(
        "Demo Port-to-Warehouse Shipment",
        carrier.address,
        now + 14 * 24 * 60 * 60,
        "Seeded for the live MetaMask coursework demonstration.",
        ["Cargo pickup", "Final delivery"],
        ["Signed pickup note", "Signed proof of delivery"],
        payouts,
        [now + 3 * 24 * 60 * 60, now + 10 * 24 * 60 * 60],
        { value: hre.ethers.parseEther("0.1") },
      )
    ).wait();
    agreementId = 0;
  } else {
    agreementId -= 1;
  }

  console.log("Local demo is ready.");
  console.log(`Arbitrator: ${arbitrator.address}`);
  console.log(`Shipper:    ${shipper.address}`);
  console.log(`Carrier:    ${carrier.address}`);
  console.log(`Agreement:  #${agreementId}`);
  console.log("Import the matching development accounts shown by npm run chain into MetaMask.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
