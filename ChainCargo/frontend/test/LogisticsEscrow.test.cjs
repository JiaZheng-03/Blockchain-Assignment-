const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("LogisticsEscrow", function () {
  async function deployFixture() {
    const [arbitrator, shipper, carrier, outsider, secondShipper] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("LogisticsEscrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await escrow.connect(arbitrator).register("CargoSeal Arbitration", 3);
    await escrow.connect(shipper).register("Acme Imports", 1);
    await escrow.connect(carrier).register("Swift Freight", 2);
    await escrow.connect(secondShipper).register("Second Shipper", 1);

    return { escrow, arbitrator, shipper, carrier, outsider, secondShipper };
  }

  async function createAgreement(
    escrow,
    shipper,
    carrier,
    { title = "Port Klang delivery", total = "10", pickupPercent = 30, autoAccept = true } = {},
  ) {
    const now = await time.latest();
    const totalWei = ethers.parseEther(total);
    const pickupPayout = (totalWei * BigInt(pickupPercent)) / 100n;
    const payouts = [pickupPayout, totalWei - pickupPayout];
    const dueDates = [now + (2 * 86_400), now + (4 * 86_400)];
    const deadline = now + (6 * 86_400);
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
    const agreementId = (await escrow.agreementCount()) - 1n;
    if (autoAccept) await escrow.connect(carrier).acceptAgreement(agreementId);
    return { agreementId, deadline, dueDates, now, payouts, totalWei };
  }

  it("requires the assigned Carrier to accept a funded agreement before work begins", async function () {
    const { escrow, shipper, carrier, outsider } = await deployFixture();
    const { agreementId, dueDates } = await createAgreement(escrow, shipper, carrier, {
      autoAccept: false,
    });

    const agreement = await escrow.getAgreement(agreementId);
    expect(agreement.status).to.equal(5);
    expect(await escrow.carrierAcceptanceDeadline(agreementId)).to.equal(
      agreement.createdAt + 86_400n < BigInt(dueDates[0])
        ? agreement.createdAt + 86_400n
        : BigInt(dueDates[0] - 1),
    );
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("pickup evidence"));
    await expect(escrow.connect(carrier).submitEvidence(agreementId, 0, evidenceHash))
      .to.be.revertedWithCustomError(escrow, "InvalidStatus");
    await expect(escrow.connect(outsider).acceptAgreement(agreementId))
      .to.be.revertedWithCustomError(escrow, "Unauthorized");
    await expect(escrow.connect(carrier).acceptAgreement(agreementId))
      .to.emit(escrow, "AgreementAccepted")
      .withArgs(agreementId, carrier.address);
    expect((await escrow.getAgreement(agreementId)).status).to.equal(0);
  });

  it("lets the assigned Carrier reject and fully refund an agreement", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    const { agreementId, totalWei } = await createAgreement(escrow, shipper, carrier, {
      autoAccept: false,
    });

    await expect(escrow.connect(carrier).rejectAgreement(agreementId, "No transport capacity"))
      .to.changeEtherBalances([escrow, shipper], [-totalWei, totalWei]);
    expect(await escrow.agreementRejectionReason(agreementId)).to.equal("No transport capacity");
    expect((await escrow.getAgreement(agreementId)).status).to.equal(6);
    expect((await escrow.getAgreement(agreementId)).remainingAmount).to.equal(0);
  });

  it("requires a bounded rejection reason and only allows the assigned Carrier to reject once", async function () {
    const { escrow, shipper, carrier, outsider } = await deployFixture();
    const { agreementId, totalWei } = await createAgreement(escrow, shipper, carrier, { autoAccept: false });
    for (const reason of ["", " \t\n", "x".repeat(1001)]) {
      await expect(escrow.connect(carrier).rejectAgreement(agreementId, reason))
        .to.be.revertedWithCustomError(escrow, "InvalidInput");
    }
    for (const user of [shipper, outsider]) {
      await expect(escrow.connect(user).rejectAgreement(agreementId, "Unavailable"))
        .to.be.revertedWithCustomError(escrow, "Unauthorized");
    }
    expect((await escrow.getAgreement(agreementId)).remainingAmount).to.equal(totalWei);
    expect(await escrow.agreementRejectionReason(agreementId)).to.equal("");
    await expect(escrow.connect(carrier).rejectAgreement(agreementId, "Unavailable"))
      .to.emit(escrow, "AgreementRejected").withArgs(agreementId, carrier.address, totalWei, "Unavailable");
    await expect(escrow.connect(carrier).rejectAgreement(agreementId, "Changed reason"))
      .to.be.revertedWithCustomError(escrow, "InvalidStatus");
    expect(await escrow.agreementRejectionReason(agreementId)).to.equal("Unavailable");
  });

  it("does not allow rejecting an already accepted agreement", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    const { agreementId } = await createAgreement(escrow, shipper, carrier);
    await expect(escrow.connect(carrier).rejectAgreement(agreementId, "Unavailable"))
      .to.be.revertedWithCustomError(escrow, "InvalidStatus");
  });

  it("lets the Shipper cancel and refund after the Carrier response deadline", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    const { agreementId, totalWei } = await createAgreement(escrow, shipper, carrier, {
      autoAccept: false,
    });
    const acceptanceDeadline = await escrow.carrierAcceptanceDeadline(agreementId);

    await expect(escrow.connect(shipper).cancelUnacceptedAgreement(agreementId))
      .to.be.revertedWithCustomError(escrow, "AcceptancePeriodActive")
      .withArgs(acceptanceDeadline + 1n);
    await time.increaseTo(acceptanceDeadline + 1n);
    await expect(escrow.connect(carrier).acceptAgreement(agreementId))
      .to.be.revertedWithCustomError(escrow, "AcceptancePeriodClosed");
    await expect(escrow.connect(shipper).cancelUnacceptedAgreement(agreementId))
      .to.changeEtherBalances([escrow, shipper], [-totalWei, totalWei]);
    expect((await escrow.getAgreement(agreementId)).status).to.equal(2);
  });

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

  it("enforces two named milestones whose payouts equal the escrow", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    const now = await time.latest();
    const total = ethers.parseEther("10");

    await expect(
      escrow.connect(shipper).createAgreement(
        "Wrong count",
        carrier.address,
        now + 14_400,
        "",
        ["Cargo pickup"],
        ["Pickup"],
        [total],
        [now + 7_200],
        { value: total },
      ),
    ).to.be.revertedWithCustomError(escrow, "InvalidMilestoneCount").withArgs(1);

    await expect(
      escrow.connect(shipper).createAgreement(
        "Wrong names",
        carrier.address,
        now + 14_400,
        "",
        ["Pickup", "Delivery"],
        ["Pickup", "Delivery"],
        [ethers.parseEther("3"), ethers.parseEther("7")],
        [now + 7_200, now + 10_800],
        { value: total },
      ),
    ).to.be.revertedWithCustomError(escrow, "FixedMilestonesRequired");

    await expect(
      escrow.connect(shipper).createAgreement(
        "Wrong total",
        carrier.address,
        now + 14_400,
        "",
        ["Cargo pickup", "Final delivery"],
        ["Pickup", "Delivery"],
        [ethers.parseEther("4"), ethers.parseEther("5")],
        [now + 7_200, now + 10_800],
        { value: total },
      ),
    ).to.be.revertedWithCustomError(escrow, "PayoutTotalMismatch")
      .withArgs(ethers.parseEther("9"), total);
  });

  it("stores and releases a Shipper-selected 40%/60% allocation", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    const { payouts } = await createAgreement(
      escrow,
      shipper,
      carrier,
      { pickupPercent: 40 },
    );
    const milestones = await escrow.getMilestones(0);
    expect(milestones[0].payout).to.equal(payouts[0]);
    expect(milestones[1].payout).to.equal(payouts[1]);

    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("custom allocation evidence"));
    await escrow.connect(carrier).submitEvidence(0, 0, evidenceHash);
    await expect(escrow.connect(shipper).confirmMilestone(0, 0, evidenceHash))
      .to.emit(escrow, "MilestoneConfirmed")
      .withArgs(0, 0, evidenceHash, shipper.address, payouts[0]);
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
    const proofURI = "supabase://abcdefghijklmnopqrst/cargoseal-evidence/0/pickup.pdf";

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

  it("lets only the Shipper reject evidence and lets the Carrier submit a replacement", async function () {
    const { escrow, shipper, carrier, outsider } = await deployFixture();
    const { totalWei } = await createAgreement(escrow, shipper, carrier);
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("rejected evidence"));
    await escrow.connect(carrier).submitEvidence(0, 0, evidenceHash);

    await expect(escrow.connect(outsider).rejectEvidence(0, 0))
      .to.be.revertedWithCustomError(escrow, "Unauthorized");
    await expect(escrow.connect(shipper).rejectEvidence(0, 0))
      .to.emit(escrow, "EvidenceRevisionRequested");

    const agreement = await escrow.getAgreement(0);
    const [pickup] = await escrow.getMilestones(0);
    expect(agreement.status).to.equal(0);
    expect(agreement.remainingAmount).to.equal(totalWei);
    expect(pickup.state).to.equal(0);
    expect(pickup.proofHash).to.equal(ethers.ZeroHash);
    expect(pickup.submittedAt).to.equal(0);
    expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(totalWei);

    const replacementHash = ethers.keccak256(ethers.toUtf8Bytes("replacement evidence"));
    await expect(escrow.connect(carrier).submitEvidence(0, 0, replacementHash))
      .to.emit(escrow, "MilestoneProofSubmitted")
      .withArgs(0, 0, replacementHash, "");
  });

  it("only allows the contract deployer to register as Arbitrator", async function () {
    const [deployer, other] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("LogisticsEscrow");

    for (const participantRole of [1, 2]) {
      const escrow = await Escrow.connect(deployer).deploy();
      await escrow.waitForDeployment();
      await expect(escrow.connect(deployer).register("Developer", participantRole))
        .to.be.revertedWithCustomError(escrow, "InvalidRole");
    }

    const escrow = await Escrow.connect(deployer).deploy();
    await escrow.waitForDeployment();
    await expect(escrow.connect(other).register("Fake Arbitrator", 3))
      .to.be.revertedWithCustomError(escrow, "Unauthorized");
    await expect(escrow.connect(deployer).register("CargoSeal Arbitration", 3))
      .to.emit(escrow, "UserRegistered").withArgs(deployer.address, 3, "CargoSeal Arbitration");
  });

  it("lets only the Carrier request arbitration after one hour without Shipper action", async function () {
    const { escrow, shipper, carrier, outsider } = await deployFixture();
    const { totalWei } = await createAgreement(escrow, shipper, carrier);
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("timed out review"));
    await escrow.connect(carrier).submitEvidence(0, 0, evidenceHash);
    const submittedAt = (await escrow.getMilestones(0))[0].submittedAt;
    const availableAt = submittedAt + (60n * 60n);

    await expect(escrow.connect(outsider).requestArbitrationAfterReviewTimeout(0, 0))
      .to.be.revertedWithCustomError(escrow, "Unauthorized");

    await expect(escrow.connect(carrier).requestArbitrationAfterReviewTimeout(0, 0))
      .to.be.revertedWithCustomError(escrow, "ReviewPeriodActive")
      .withArgs(availableAt);

    await time.increaseTo(availableAt);
    await expect(escrow.connect(carrier).requestArbitrationAfterReviewTimeout(0, 0))
      .to.emit(escrow, "ArbitrationRequested")
      .withArgs(0, 0, carrier.address)
      .and.to.emit(escrow, "DisputeOpened")
      .withArgs(0, carrier.address, "Shipper did not review submitted evidence within 1 hour.");

    const agreement = await escrow.getAgreement(0);
    expect(agreement.status).to.equal(3);
    expect(agreement.nextMilestone).to.equal(0);
    expect(agreement.remainingAmount).to.equal(totalWei);
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

  it("allows later evidence early but keeps milestone confirmation sequential", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    await createAgreement(escrow, shipper, carrier);
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("delivery evidence"));

    await expect(escrow.connect(carrier).submitEvidence(0, 1, evidenceHash))
      .to.emit(escrow, "MilestoneProofSubmitted")
      .withArgs(0, 1, evidenceHash, "");
    await expect(escrow.connect(shipper).confirmMilestone(0, 1, evidenceHash))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestone");
    expect((await escrow.getMilestones(0))[1].state).to.equal(1);
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

  it("allows one fixed 24-hour extension request only during the final 24 hours", async function () {
    const { escrow, shipper, carrier, outsider } = await deployFixture();
    const { dueDates } = await createAgreement(escrow, shipper, carrier);
    const requestOpensAt = BigInt(dueDates[0] - 86_400);
    const proposedDueAt = BigInt(dueDates[0] + 86_400);

    await expect(escrow.connect(carrier).requestDeadlineExtension(0, 0, "Port congestion"))
      .to.be.revertedWithCustomError(escrow, "ExtensionRequestTooEarly")
      .withArgs(requestOpensAt);
    await time.increaseTo(requestOpensAt);
    await expect(escrow.connect(outsider).requestDeadlineExtension(0, 0, "Not my shipment"))
      .to.be.revertedWithCustomError(escrow, "Unauthorized");
    await expect(escrow.connect(carrier).requestDeadlineExtension(0, 0, "Port congestion"))
      .to.emit(escrow, "DeadlineExtensionRequested")
      .withArgs(0, 0, carrier.address, proposedDueAt, "Port congestion");

    const request = await escrow.getExtensionRequest(0, 0);
    expect(request.proposedDueAt).to.equal(proposedDueAt);
    expect(request.pending).to.equal(true);
    await expect(escrow.connect(carrier).requestDeadlineExtension(0, 0, "Again"))
      .to.be.revertedWithCustomError(escrow, "ExtensionAlreadyRequested");
  });

  it("charges 5% of the milestone payout when the Shipper approves an extension", async function () {
    const { escrow, shipper, carrier, outsider } = await deployFixture();
    const { deadline, dueDates, payouts } = await createAgreement(escrow, shipper, carrier);
    await time.increaseTo(dueDates[0] - 86_400);
    await escrow.connect(carrier).requestDeadlineExtension(0, 0, "Customs delay");
    const compensation = payouts[0] * 5n / 100n;

    await expect(escrow.connect(outsider).approveDeadlineExtension(0, 0))
      .to.be.revertedWithCustomError(escrow, "Unauthorized");
    await expect(escrow.connect(shipper).approveDeadlineExtension(0, 0))
      .to.emit(escrow, "DeadlineExtensionApproved")
      .withArgs(0, 0, dueDates[0] + 86_400, compensation);

    const pickup = (await escrow.getMilestones(0))[0];
    expect(pickup.dueAt).to.equal(dueDates[0] + 86_400);
    expect(pickup.extensionCompensation).to.equal(compensation);
    expect(pickup.extensionApproved).to.equal(true);
    expect((await escrow.getAgreement(0)).deadline).to.equal(deadline);

    await time.increaseTo(dueDates[0] + 1);
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("extended pickup evidence"));
    await escrow.connect(carrier).submitEvidence(0, 0, evidenceHash);
    await expect(escrow.connect(shipper).confirmMilestone(0, 0, evidenceHash))
      .to.changeEtherBalances(
        [escrow, shipper, carrier],
        [-payouts[0], compensation, payouts[0] - compensation],
      );
  });

  it("lets the Shipper reject an extension and refund after the original deadline", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    const { dueDates, totalWei } = await createAgreement(escrow, shipper, carrier);
    await time.increaseTo(dueDates[0] - 86_400);
    await escrow.connect(carrier).requestDeadlineExtension(0, 0, "Traffic delay");
    await expect(escrow.connect(shipper).rejectDeadlineExtension(0, 0))
      .to.emit(escrow, "DeadlineExtensionRejected")
      .withArgs(0, 0);

    await time.increaseTo(dueDates[0] + 1);
    await expect(escrow.connect(shipper).claimRefundAfterDeadline(0))
      .to.changeEtherBalances([escrow, shipper], [-totalWei, totalWei]);
  });

  it("expires an unanswered extension request when the original deadline enables a refund", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    const { dueDates, totalWei } = await createAgreement(escrow, shipper, carrier);
    await time.increaseTo(dueDates[0] - 86_400);
    await escrow.connect(carrier).requestDeadlineExtension(0, 0, "Awaiting port slot");

    await time.increaseTo(dueDates[0] + 1);
    expect((await escrow.getExtensionRequest(0, 0)).pending).to.equal(true);
    await expect(escrow.connect(shipper).claimRefundAfterDeadline(0))
      .to.changeEtherBalances([escrow, shipper], [-totalWei, totalWei]);
    expect((await escrow.getExtensionRequest(0, 0)).pending).to.equal(false);
  });

  it("grants up to 24 hours for replacement evidence without crossing the next deadline", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    const { dueDates } = await createAgreement(escrow, shipper, carrier);
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("late rejected evidence"));
    await escrow.connect(carrier).submitEvidence(0, 0, evidenceHash);
    await time.increaseTo(dueDates[0] + 1);

    const rejection = await escrow.connect(shipper).rejectEvidence(0, 0);
    const receipt = await rejection.wait();
    const rejectionBlock = await ethers.provider.getBlock(receipt.blockNumber);
    const [pickup] = await escrow.getMilestones(0);
    expect(pickup.dueAt).to.equal(BigInt(rejectionBlock.timestamp + 86_400));
    expect(pickup.dueAt).to.be.lessThan(BigInt(dueDates[1]));
  });

  it("allows only the Shipper to refund a missed deadline", async function () {
    const { escrow, shipper, carrier, outsider } = await deployFixture();
    const { dueDates, totalWei } = await createAgreement(escrow, shipper, carrier);
    await time.increaseTo(dueDates[0] + 1);

    expect(await escrow.canRefund(0)).to.equal(true);
    await expect(escrow.connect(outsider).claimRefundAfterDeadline(0))
      .to.be.revertedWithCustomError(escrow, "Unauthorized");
    await expect(escrow.connect(shipper).claimRefundAfterDeadline(0))
      .to.changeEtherBalances([escrow, shipper], [-totalWei, totalWei]);
    expect((await escrow.getAgreement(0)).status).to.equal(2);
  });

  it("refunds only the remaining 70% when Final delivery evidence misses its deadline", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    const { dueDates, payouts } = await createAgreement(escrow, shipper, carrier);
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("pickup evidence"));
    await escrow.connect(carrier).submitEvidence(0, 0, evidenceHash);
    await escrow.connect(shipper).confirmMilestone(0, 0, evidenceHash);
    await time.increaseTo(dueDates[1] + 1);

    await expect(escrow.connect(shipper).claimRefundAfterDeadline(0))
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
      .to.be.revertedWithCustomError(escrow, "Unauthorized");
    await expect(escrow.connect(shipper).claimRefundAfterDeadline(0))
      .to.be.revertedWithCustomError(escrow, "DeadlineNotPassed");
    await expect(escrow.connect(shipper).confirmMilestone(0, 0, evidenceHash))
      .to.emit(escrow, "MilestoneConfirmed");
  });

  it("lets either participant request a dispute with details", async function () {
    const { escrow, shipper, carrier, outsider } = await deployFixture();
    await createAgreement(escrow, shipper, carrier);

    await expect(escrow.connect(outsider).requestDispute(0, "Not my agreement"))
      .to.be.revertedWithCustomError(escrow, "Unauthorized");
    await expect(escrow.connect(shipper).requestDispute(0, ""))
      .to.be.revertedWithCustomError(escrow, "InvalidInput");
    await expect(escrow.connect(shipper).requestDispute(0, "Delivery disputed"))
      .to.emit(escrow, "DisputeOpened")
      .withArgs(0, shipper.address, "Delivery disputed");
  });

  it("lets only the other participant submit one dispute response", async function () {
    const { escrow, shipper, carrier, outsider } = await deployFixture();
    await createAgreement(escrow, shipper, carrier);
    await escrow.connect(shipper).requestDispute(0, "Delivery condition disputed");

    await expect(escrow.connect(outsider).respondToDispute(0, "Outside response"))
      .to.be.revertedWithCustomError(escrow, "Unauthorized");
    await expect(escrow.connect(shipper).respondToDispute(0, "Second statement"))
      .to.be.revertedWithCustomError(escrow, "Unauthorized");
    await expect(escrow.connect(carrier).respondToDispute(0, ""))
      .to.be.revertedWithCustomError(escrow, "InvalidInput");
    await expect(escrow.connect(carrier).respondToDispute(0, "Cargo was delivered intact"))
      .to.emit(escrow, "DisputeResponseSubmitted")
      .withArgs(0, carrier.address, "Cargo was delivered intact");

    const dispute = await escrow.getDisputeRequest(0);
    expect(dispute.respondedBy).to.equal(carrier.address);
    expect(dispute.responseDetails).to.equal("Cargo was delivered intact");
    expect(dispute.respondedAt).to.be.greaterThan(0);
    await expect(escrow.connect(carrier).respondToDispute(0, "Replacement response"))
      .to.be.revertedWithCustomError(escrow, "DisputeResponseAlreadySubmitted");
  });

  it("lets the Shipper respond when the Carrier opened the dispute", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    await createAgreement(escrow, shipper, carrier);
    await escrow.connect(carrier).requestDispute(0, "Payment decision disputed");

    await expect(escrow.connect(shipper).respondToDispute(0, "Evidence does not match the cargo"))
      .to.emit(escrow, "DisputeResponseSubmitted")
      .withArgs(0, shipper.address, "Evidence does not match the cargo");
  });

  it("lets the Carrier request a dispute and the Arbitrator resolve it", async function () {
    const { escrow, arbitrator, shipper, carrier, outsider } = await deployFixture();
    await createAgreement(escrow, shipper, carrier);

    await expect(escrow.connect(carrier).requestDispute(0, "Cargo condition disputed"))
      .to.emit(escrow, "DisputeOpened")
      .withArgs(0, carrier.address, "Cargo condition disputed");

    await expect(escrow.connect(outsider).resolveDispute(0, 1))
      .to.be.revertedWithCustomError(escrow, "Unauthorized");
    await expect(escrow.connect(arbitrator).resolveDispute(0, ethers.parseEther("4")))
      .to.changeEtherBalances(
        [escrow, shipper, carrier],
        [-ethers.parseEther("10"), ethers.parseEther("4"), ethers.parseEther("6")],
      );
  });

  it("pauses deadlines, allows later evidence, and continues after Arbitrator approval", async function () {
    const { escrow, arbitrator, shipper, carrier } = await deployFixture();
    const { deadline, dueDates } = await createAgreement(escrow, shipper, carrier);
    const pickupHash = ethers.keccak256(ethers.toUtf8Bytes("disputed pickup"));
    const deliveryHash = ethers.keccak256(ethers.toUtf8Bytes("delivery during dispute"));
    await escrow.connect(carrier).submitEvidence(0, 0, pickupHash);
    await escrow.connect(shipper).requestDispute(0, "Pickup evidence needs review");
    const dispute = await escrow.getDisputeRequest(0);

    await time.increaseTo(dueDates[1] + 60);
    await expect(escrow.connect(carrier).submitEvidence(0, 1, deliveryHash))
      .to.emit(escrow, "MilestoneProofSubmitted");

    const resolvedAt = await time.latest();
    const pausedSeconds = BigInt(resolvedAt) - dispute.openedAt + 1n;
    await expect(escrow.connect(arbitrator).resolveDisputeAndContinue(
      0,
      true,
      "The submitted evidence proves pickup",
    ))
      .to.emit(escrow, "DisputeContinued");

    const agreement = await escrow.getAgreement(0);
    const milestones = await escrow.getMilestones(0);
    expect(agreement.status).to.equal(0);
    expect(agreement.nextMilestone).to.equal(1);
    expect(agreement.deadline).to.be.at.least(BigInt(deadline) + pausedSeconds);
    expect(milestones[1].dueAt).to.be.at.least(BigInt(dueDates[1]) + pausedSeconds);
    expect(milestones[1].proofHash).to.equal(deliveryHash);
    expect((await escrow.getDisputeRequest(0)).resolutionReason)
      .to.equal("The submitted evidence proves pickup");
  });

  it("lets the Arbitrator request replacement evidence and resume the agreement", async function () {
    const { escrow, arbitrator, shipper, carrier } = await deployFixture();
    await createAgreement(escrow, shipper, carrier);
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("contested pickup"));
    await escrow.connect(carrier).submitEvidence(0, 0, evidenceHash);
    await escrow.connect(carrier).requestDispute(0, "Shipper and Carrier need arbitration");

    await time.increase(3_600);
    await expect(escrow.connect(arbitrator).resolveDisputeAndContinue(
      0,
      false,
      "A clearer receipt is required",
    ))
      .to.emit(escrow, "EvidenceRevisionRequested");

    const agreement = await escrow.getAgreement(0);
    const milestone = (await escrow.getMilestones(0))[0];
    expect(agreement.status).to.equal(0);
    expect(milestone.state).to.equal(0);
    expect(milestone.proofHash).to.equal(ethers.ZeroHash);
    expect((await escrow.getDisputeRequest(0)).active).to.equal(false);
  });

  it("requires the Arbitrator to record a bounded continuation reason", async function () {
    const { escrow, arbitrator, shipper, carrier } = await deployFixture();
    await createAgreement(escrow, shipper, carrier);
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("contested pickup"));
    await escrow.connect(carrier).submitEvidence(0, 0, evidenceHash);
    await escrow.connect(shipper).requestDispute(0, "Please review pickup evidence");

    for (const reason of ["", "x".repeat(1001)]) {
      await expect(escrow.connect(arbitrator).resolveDisputeAndContinue(0, true, reason))
        .to.be.revertedWithCustomError(escrow, reason ? "InputTooLong" : "InvalidInput");
    }
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
