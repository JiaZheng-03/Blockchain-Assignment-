const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("LogisticsEscrow", function () {
  async function deployFixture() {
    const [arbitrator, shipper, carrier, outsider, secondShipper] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("LogisticsEscrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await escrow.connect(arbitrator).register("ChainCargo Arbitration", 3);
    await escrow.connect(shipper).register("Acme Imports", 1);
    await escrow.connect(carrier).register("Swift Freight", 2);
    await escrow.connect(secondShipper).register("Second Shipper", 1);

    return { escrow, arbitrator, shipper, carrier, outsider, secondShipper };
  }

  async function createAgreement(
    escrow,
    shipper,
    carrier,
    { title = "Port Klang delivery", total = "10" } = {},
  ) {
    const now = await time.latest();
    const totalWei = ethers.parseEther(total);
    const pickupPayout = (totalWei * 30n) / 100n;
    const payouts = [pickupPayout, totalWei - pickupPayout];
    const dueDates = [now + 1_800, now + 5_400];
    const deadline = now + 7_200;
    const tx = await escrow.connect(shipper).createAgreement(
      title,
      carrier.address,
      deadline,
      "Handle with care",
      ["Cargo pickup", "Final delivery"],
      ["Pickup document", "Delivery document"],
      payouts,
      dueDates,
      { value: totalWei },
    );
    await tx.wait();
    return { deadline, dueDates, now, payouts, totalWei };
  }

  it("registers only the two participant roles", async function () {
    const { escrow, shipper, carrier, outsider } = await deployFixture();
    expect((await escrow.getProfile(shipper.address)).role).to.equal(1);
    expect((await escrow.getProfile(carrier.address)).role).to.equal(2);
    await expect(escrow.connect(outsider).register("Invalid", 0))
      .to.be.revertedWithCustomError(escrow, "InvalidRole");
  });

  it("prevents duplicate agreement names for one Shipper after normalization", async function () {
    const { escrow, shipper, carrier, secondShipper } = await deployFixture();
    await createAgreement(escrow, shipper, carrier, { title: "  Port   Klang Shipment  " });

    expect(await escrow.isAgreementNameAvailable(shipper.address, "port klang shipment"))
      .to.equal(false);
    await expect(createAgreement(escrow, shipper, carrier, { title: "PORT KLANG SHIPMENT" }))
      .to.be.revertedWithCustomError(escrow, "DuplicateAgreementName");

    expect(await escrow.isAgreementNameAvailable(secondShipper.address, "port klang shipment"))
      .to.equal(true);
    await createAgreement(escrow, secondShipper, carrier, { title: "port klang shipment" });
    expect(await escrow.agreementCount()).to.equal(2);
  });

  it("enforces exactly two fixed milestones and the 30%/70% allocation", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    const now = await time.latest();
    const total = ethers.parseEther("10");

    await expect(
      escrow.connect(shipper).createAgreement(
        "Wrong count",
        carrier.address,
        now + 7_200,
        "",
        ["Cargo pickup"],
        ["Pickup"],
        [total],
        [now + 1_800],
        { value: total },
      ),
    ).to.be.revertedWithCustomError(escrow, "InvalidMilestoneCount").withArgs(1);

    await expect(
      escrow.connect(shipper).createAgreement(
        "Wrong names",
        carrier.address,
        now + 7_200,
        "",
        ["Pickup", "Delivery"],
        ["Pickup", "Delivery"],
        [ethers.parseEther("3"), ethers.parseEther("7")],
        [now + 1_800, now + 5_400],
        { value: total },
      ),
    ).to.be.revertedWithCustomError(escrow, "FixedMilestonesRequired");

    await expect(
      escrow.connect(shipper).createAgreement(
        "Wrong allocation",
        carrier.address,
        now + 7_200,
        "",
        ["Cargo pickup", "Final delivery"],
        ["Pickup", "Delivery"],
        [ethers.parseEther("4"), ethers.parseEther("6")],
        [now + 1_800, now + 5_400],
        { value: total },
      ),
    ).to.be.revertedWithCustomError(escrow, "InvalidMilestonePayout")
      .withArgs(0, ethers.parseEther("3"), ethers.parseEther("4"));
  });

  it("allows the Carrier to submit the assignment evidence hash", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    await createAgreement(escrow, shipper, carrier);
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("pickup evidence"));

    await expect(escrow.connect(carrier).submitEvidence(0, 0, evidenceHash))
      .to.emit(escrow, "MilestoneProofSubmitted")
      .withArgs(0, 0, evidenceHash, "");
    const [pickup] = await escrow.getMilestones(0);
    expect(pickup.proofHash).to.equal(evidenceHash);
    expect(pickup.state).to.equal(1);
    expect(pickup.paid).to.equal(false);
  });

  it("stores a validated Supabase reference for frontend evidence", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    await createAgreement(escrow, shipper, carrier);
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("pickup photo"));
    const proofURI = "supabase://abcdefghijklmnopqrst/chaincargo-evidence/0/pickup.pdf";

    await escrow.connect(carrier).submitMilestoneProof(0, 0, evidenceHash, proofURI);
    expect((await escrow.getMilestones(0))[0].proofURI).to.equal(proofURI);
    await expect(
      escrow.connect(carrier).submitMilestoneProof(0, 0, evidenceHash, "https://attacker.test/file"),
    ).to.be.revertedWithCustomError(escrow, "InvalidProofURI");
  });

  it("rejects evidence submitted by the Shipper or unrelated wallets", async function () {
    const { escrow, shipper, carrier, outsider } = await deployFixture();
    await createAgreement(escrow, shipper, carrier);
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("pickup evidence"));

    await expect(escrow.connect(shipper).submitEvidence(0, 0, evidenceHash))
      .to.be.revertedWithCustomError(escrow, "Unauthorized");
    await expect(escrow.connect(outsider).submitEvidence(0, 0, evidenceHash))
      .to.be.revertedWithCustomError(escrow, "Unauthorized");
  });

  it("lets only the fixed Shipper confirm matching evidence and releases pickup 30%", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    const { payouts } = await createAgreement(escrow, shipper, carrier);
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("pickup evidence"));
    await escrow.connect(carrier).submitEvidence(0, 0, evidenceHash);

    const contractBalanceBefore = await ethers.provider.getBalance(await escrow.getAddress());
    const carrierBalanceBefore = await ethers.provider.getBalance(carrier.address);
    const confirmation = await escrow.connect(shipper).confirmMilestone(0, 0, evidenceHash);
    await expect(confirmation).to.emit(escrow, "MilestoneConfirmed")
      .withArgs(0, 0, evidenceHash, shipper.address, payouts[0]);
    await confirmation.wait();
    expect(await ethers.provider.getBalance(await escrow.getAddress()))
      .to.equal(contractBalanceBefore - payouts[0]);
    expect(await ethers.provider.getBalance(carrier.address))
      .to.equal(carrierBalanceBefore + payouts[0]);

    const agreement = await escrow.getAgreement(0);
    const [pickup] = await escrow.getMilestones(0);
    expect(agreement.shipper).to.equal(shipper.address);
    expect(agreement.remainingAmount).to.equal(payouts[1]);
    expect(pickup.state).to.equal(2);
    expect(pickup.paid).to.equal(true);
  });

  it("rejects milestone confirmation by the Carrier and unrelated wallets", async function () {
    const { escrow, shipper, carrier, outsider } = await deployFixture();
    await createAgreement(escrow, shipper, carrier);
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("pickup evidence"));
    await escrow.connect(carrier).submitEvidence(0, 0, evidenceHash);

    await expect(escrow.connect(carrier).confirmMilestone(0, 0, evidenceHash))
      .to.be.revertedWithCustomError(escrow, "Unauthorized");
    await expect(escrow.connect(outsider).confirmMilestone(0, 0, evidenceHash))
      .to.be.revertedWithCustomError(escrow, "Unauthorized");
  });

  it("rejects missing and mismatched evidence", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    await createAgreement(escrow, shipper, carrier);
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("pickup evidence"));
    const wrongHash = ethers.keccak256(ethers.toUtf8Bytes("different evidence"));

    await expect(escrow.connect(shipper).confirmMilestone(0, 0, evidenceHash))
      .to.be.revertedWithCustomError(escrow, "EvidenceMissing");
    await escrow.connect(carrier).submitEvidence(0, 0, evidenceHash);
    await expect(escrow.connect(shipper).confirmMilestone(0, 0, wrongHash))
      .to.be.revertedWithCustomError(escrow, "EvidenceHashMismatch")
      .withArgs(evidenceHash, wrongHash);
  });

  it("rejects duplicate confirmation and duplicate payment", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    await createAgreement(escrow, shipper, carrier);
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("pickup evidence"));
    await escrow.connect(carrier).submitEvidence(0, 0, evidenceHash);
    await escrow.connect(shipper).confirmMilestone(0, 0, evidenceHash);

    await expect(escrow.connect(shipper).confirmMilestone(0, 0, evidenceHash))
      .to.be.revertedWithCustomError(escrow, "PaymentAlreadyReleased");
    expect(await escrow.carrierReputation(carrier.address)).to.equal(10);
  });

  it("prevents Final delivery confirmation before Cargo pickup", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    await createAgreement(escrow, shipper, carrier);
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("delivery evidence"));

    await expect(escrow.connect(carrier).submitEvidence(0, 1, evidenceHash))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestone");
    await expect(escrow.connect(shipper).confirmMilestone(0, 1, evidenceHash))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestone");
  });

  it("releases the remaining 70% for Final delivery and completes the agreement", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    const { payouts } = await createAgreement(escrow, shipper, carrier);
    const pickupHash = ethers.keccak256(ethers.toUtf8Bytes("pickup evidence"));
    const deliveryHash = ethers.keccak256(ethers.toUtf8Bytes("delivery evidence"));

    await escrow.connect(carrier).submitEvidence(0, 0, pickupHash);
    await escrow.connect(shipper).confirmMilestone(0, 0, pickupHash);
    await escrow.connect(carrier).submitEvidence(0, 1, deliveryHash);
    const contractBalanceBefore = await ethers.provider.getBalance(await escrow.getAddress());
    const carrierBalanceBefore = await ethers.provider.getBalance(carrier.address);
    const confirmation = await escrow.connect(shipper).confirmMilestone(0, 1, deliveryHash);
    await expect(confirmation).to.emit(escrow, "AgreementCompleted").withArgs(0);
    await confirmation.wait();
    expect(await ethers.provider.getBalance(await escrow.getAddress()))
      .to.equal(contractBalanceBefore - payouts[1]);
    expect(await ethers.provider.getBalance(carrier.address))
      .to.equal(carrierBalanceBefore + payouts[1]);

    const agreement = await escrow.getAgreement(0);
    const delivery = (await escrow.getMilestones(0))[1];
    expect(agreement.status).to.equal(1);
    expect(agreement.remainingAmount).to.equal(0);
    expect(delivery.paid).to.equal(true);
    expect(await escrow.carrierReputation(carrier.address)).to.equal(20);
  });

  it("keeps the original Shipper as the permanent authorized confirmer", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    await createAgreement(escrow, shipper, carrier);
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("pickup evidence"));
    await escrow.connect(carrier).submitEvidence(0, 0, evidenceHash);
    await escrow.connect(shipper).confirmMilestone(0, 0, evidenceHash);

    expect((await escrow.getAgreement(0)).shipper).to.equal(shipper.address);
    expect(escrow.interface.getFunction("changeConfirmer")).to.equal(null);
  });

  it("allows anyone to settle a missed deadline but always refunds the Shipper", async function () {
    const { escrow, shipper, carrier, outsider } = await deployFixture();
    const { dueDates, totalWei } = await createAgreement(escrow, shipper, carrier);
    await time.increaseTo(dueDates[0] + 1);

    expect(await escrow.canRefund(0)).to.equal(true);
    const contractBalanceBefore = await ethers.provider.getBalance(await escrow.getAddress());
    const shipperBalanceBefore = await ethers.provider.getBalance(shipper.address);
    const refund = await escrow.connect(outsider).claimRefundAfterDeadline(0);
    await expect(refund).to.emit(escrow, "Refunded")
      .withArgs(0, shipper.address, totalWei);
    await refund.wait();
    expect(await ethers.provider.getBalance(await escrow.getAddress()))
      .to.equal(contractBalanceBefore - totalWei);
    expect(await ethers.provider.getBalance(shipper.address))
      .to.equal(shipperBalanceBefore + totalWei);
    expect((await escrow.getAgreement(0)).status).to.equal(2);
  });

  it("refunds only the remaining 70% when Final delivery evidence misses its deadline", async function () {
    const { escrow, shipper, carrier, outsider } = await deployFixture();
    const { dueDates, payouts } = await createAgreement(escrow, shipper, carrier);
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("pickup evidence"));
    await escrow.connect(carrier).submitEvidence(0, 0, evidenceHash);
    await escrow.connect(shipper).confirmMilestone(0, 0, evidenceHash);
    await time.increaseTo(dueDates[1] + 1);

    await expect(escrow.connect(outsider).claimRefundAfterDeadline(0))
      .to.changeEtherBalances([escrow, shipper], [-payouts[1], payouts[1]]);
  });

  it("protects timely submitted evidence from a deadline refund", async function () {
    const { escrow, shipper, carrier, outsider } = await deployFixture();
    const { dueDates } = await createAgreement(escrow, shipper, carrier);
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("pickup evidence"));
    await escrow.connect(carrier).submitEvidence(0, 0, evidenceHash);
    await time.increaseTo(dueDates[0] + 1);

    expect(await escrow.canRefund(0)).to.equal(false);
    await expect(escrow.connect(outsider).claimRefundAfterDeadline(0))
      .to.be.revertedWithCustomError(escrow, "DeadlineNotPassed");
    await expect(escrow.connect(shipper).confirmMilestone(0, 0, evidenceHash))
      .to.emit(escrow, "MilestoneConfirmed");
  });

  it("preserves participant disputes and deployer arbitration", async function () {
    const { escrow, arbitrator, shipper, carrier, outsider } = await deployFixture();
    await createAgreement(escrow, shipper, carrier);
    await escrow.connect(carrier).openDispute(0, "Cargo condition disputed");

    await expect(escrow.connect(outsider).resolveDispute(0, 1))
      .to.be.revertedWithCustomError(escrow, "Unauthorized");
    await expect(escrow.connect(arbitrator).resolveDispute(0, ethers.parseEther("4")))
      .to.changeEtherBalances(
        [escrow, shipper, carrier],
        [-ethers.parseEther("10"), ethers.parseEther("4"), ethers.parseEther("6")],
      );
  });

  it("rejects invalid agreement IDs and expired evidence", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    const { dueDates } = await createAgreement(escrow, shipper, carrier);
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("pickup evidence"));

    await expect(escrow.connect(carrier).submitEvidence(99, 0, evidenceHash))
      .to.be.revertedWithCustomError(escrow, "AgreementNotFound");
    await time.increaseTo(dueDates[0] + 1);
    await expect(escrow.connect(carrier).submitEvidence(0, 0, evidenceHash))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestone");
  });
});
