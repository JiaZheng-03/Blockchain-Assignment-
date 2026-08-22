const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("LogisticsEscrow", function () {
  async function deployFixture() {
    const [arbitrator, shipper, carrier, outsider] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("LogisticsEscrow");
    const escrow = await Escrow.deploy();
    await escrow.waitForDeployment();

    await escrow.connect(shipper).register("Acme Imports", 1);
    await escrow.connect(carrier).register("Swift Freight", 2);

    return { escrow, arbitrator, shipper, carrier, outsider };
  }

  async function createAgreement(escrow, shipper, carrier) {
    const now = await time.latest();
    const payouts = [ethers.parseEther("3"), ethers.parseEther("7")];
    const tx = await escrow.connect(shipper).createAgreement(
      "Port Klang delivery",
      carrier.address,
      now + 7200,
      "Handle with care",
      ["Pickup", "Delivery"],
      ["Collect cargo", "Deliver cargo"],
      payouts,
      [now + 1800, now + 5400],
      { value: ethers.parseEther("10") },
    );
    await tx.wait();
    return { now, payouts };
  }

  it("registers wallet roles and prevents duplicate registration", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    const profile = await escrow.getProfile(shipper.address);
    expect(profile.name).to.equal("Acme Imports");
    expect(profile.role).to.equal(1);
    expect(await escrow.getUsersByRole(1)).to.deep.equal([shipper.address]);
    expect(await escrow.getUsersByRole(2)).to.deep.equal([carrier.address]);
    await expect(escrow.connect(shipper).register("Again", 1))
      .to.be.revertedWithCustomError(escrow, "AlreadyRegistered");
  });

  it("rejects role-directory queries that are not participant roles", async function () {
    const { escrow } = await deployFixture();
    await expect(escrow.getUsersByRole(0))
      .to.be.revertedWithCustomError(escrow, "InvalidRole");
  });

  it("requires milestone payouts to equal the funded escrow", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    const now = await time.latest();
    await expect(
      escrow.connect(shipper).createAgreement(
        "Invalid",
        carrier.address,
        now + 3600,
        "",
        ["Pickup"],
        ["Collect"],
        [ethers.parseEther("1")],
        [now + 1800],
        { value: ethers.parseEther("2") },
      ),
    ).to.be.revertedWithCustomError(escrow, "PayoutTotalMismatch")
      .withArgs(ethers.parseEther("1"), ethers.parseEther("2"));
  });

  it("holds funds then progressively pays approved milestones", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    const { payouts } = await createAgreement(escrow, shipper, carrier);
    expect(await ethers.provider.getBalance(await escrow.getAddress()))
      .to.equal(ethers.parseEther("10"));

    const proof = ethers.keccak256(ethers.toUtf8Bytes("signed pickup document"));
    await escrow.connect(carrier).submitMilestoneProof(0, 0, proof, "ipfs://pickup");
    expect(await escrow.carrierReputation(carrier.address)).to.equal(0);
    expect(await escrow.REPUTATION_POINTS_PER_MILESTONE()).to.equal(10);

    const approval = escrow.connect(shipper).approveMilestone(0, 0);
    await expect(approval)
      .to.changeEtherBalances(
        [escrow, carrier],
        [-payouts[0], payouts[0]],
      );
    await expect(approval)
      .to.emit(escrow, "CarrierReputationAwarded")
      .withArgs(carrier.address, 0, 0, 10, 10);

    const agreement = await escrow.getAgreement(0);
    expect(agreement.remainingAmount).to.equal(payouts[1]);
    expect(agreement.nextMilestone).to.equal(1);
    expect(await escrow.carrierReputation(carrier.address)).to.equal(10);

    await expect(escrow.connect(shipper).approveMilestone(0, 0))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestone");
    expect(await escrow.carrierReputation(carrier.address)).to.equal(10);
  });

  it("rejects empty and malformed proof URIs without changing milestone state", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    await createAgreement(escrow, shipper, carrier);
    const proof = ethers.keccak256(ethers.toUtf8Bytes("evidence bytes"));

    await expect(escrow.connect(carrier).submitMilestoneProof(0, 0, proof, ""))
      .to.be.revertedWithCustomError(escrow, "InvalidProofURI");
    await expect(
      escrow.connect(carrier).submitMilestoneProof(0, 0, proof, "https://attacker.example/evidence"),
    ).to.be.revertedWithCustomError(escrow, "InvalidProofURI");

    const [milestone] = await escrow.getMilestones(0);
    expect(milestone.state).to.equal(0);
    expect(milestone.proofHash).to.equal(ethers.ZeroHash);
    expect(milestone.proofURI).to.equal("");
  });

  it("accepts a bounded IPFS proof URI and stores the exact file hash", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    await createAgreement(escrow, shipper, carrier);
    const proof = ethers.keccak256(ethers.toUtf8Bytes("original file bytes"));
    const proofURI = `ipfs://b${"a".repeat(58)}`;

    await expect(escrow.connect(carrier).submitMilestoneProof(0, 0, proof, proofURI))
      .to.emit(escrow, "MilestoneProofSubmitted")
      .withArgs(0, 0, proof, proofURI);

    const [milestone] = await escrow.getMilestones(0);
    expect(milestone.state).to.equal(1);
    expect(milestone.proofHash).to.equal(proof);
    expect(milestone.proofURI).to.equal(proofURI);
    expect(await escrow.carrierReputation(carrier.address)).to.equal(0);
  });

  it("completes after the final verified milestone", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    await createAgreement(escrow, shipper, carrier);

    for (let index = 0; index < 2; index += 1) {
      const proof = ethers.keccak256(ethers.toUtf8Bytes(`proof-${index}`));
      await escrow.connect(carrier).submitMilestoneProof(0, index, proof, `ipfs://${index}`);
      await escrow.connect(shipper).approveMilestone(0, index);
    }

    const agreement = await escrow.getAgreement(0);
    expect(agreement.status).to.equal(1);
    expect(agreement.remainingAmount).to.equal(0);
    expect(await escrow.carrierReputation(carrier.address)).to.equal(20);
  });

  it("refunds remaining escrow after an unsubmitted milestone deadline", async function () {
    const { escrow, shipper, carrier, outsider } = await deployFixture();
    const { now } = await createAgreement(escrow, shipper, carrier);
    await time.increaseTo(now + 1801);

    await expect(escrow.connect(outsider).claimRefundAfterDeadline(0))
      .to.changeEtherBalances(
        [escrow, shipper],
        [-ethers.parseEther("10"), ethers.parseEther("10")],
      );
    expect((await escrow.getAgreement(0)).status).to.equal(2);
    expect(await escrow.carrierReputation(carrier.address)).to.equal(0);

    await expect(escrow.claimRefundAfterDeadline(0))
      .to.be.revertedWithCustomError(escrow, "InvalidStatus");
  });

  it("prevents a dispute from blocking an already-eligible deadline refund", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    const { now } = await createAgreement(escrow, shipper, carrier);
    await time.increaseTo(now + 1801);

    expect(await escrow.canRefund(0)).to.equal(true);
    await expect(escrow.connect(carrier).openDispute(0, "Delay disputed"))
      .to.be.revertedWithCustomError(escrow, "DeadlineRefundAvailable");
    expect((await escrow.getAgreement(0)).status).to.equal(0);
    expect(await escrow.canRefund(0)).to.equal(true);
  });

  it("allows participant disputes before missed-deadline refund eligibility", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    await createAgreement(escrow, shipper, carrier);

    await expect(escrow.connect(carrier).openDispute(0, "Cargo condition disputed"))
      .to.emit(escrow, "DisputeOpened")
      .withArgs(0, carrier.address, "Cargo condition disputed");
    expect((await escrow.getAgreement(0)).status).to.equal(3);
  });

  it("allows only the arbitrator to resolve a disputed remaining balance", async function () {
    const { escrow, arbitrator, shipper, carrier, outsider } = await deployFixture();
    await createAgreement(escrow, shipper, carrier);
    await escrow.connect(carrier).openDispute(0, "Cargo condition disputed");

    await expect(escrow.connect(outsider).resolveDispute(0, 1))
      .to.be.revertedWithCustomError(escrow, "Unauthorized");
    const resolution = escrow.connect(arbitrator).resolveDispute(0, ethers.parseEther("4"));
    await expect(resolution).to.changeEtherBalances(
      [escrow, shipper, carrier],
      [
        -ethers.parseEther("10"),
        ethers.parseEther("4"),
        ethers.parseEther("6"),
      ],
    );

    const agreement = await escrow.getAgreement(0);
    expect(agreement.status).to.equal(4);
    expect(agreement.remainingAmount).to.equal(0);
    expect(await escrow.carrierReputation(carrier.address)).to.equal(0);
  });

  it("rejects unauthorized agreement actions and invalid agreement IDs", async function () {
    const { escrow, shipper, carrier, outsider } = await deployFixture();
    await createAgreement(escrow, shipper, carrier);
    const proof = ethers.keccak256(ethers.toUtf8Bytes("evidence"));

    await expect(
      escrow.connect(outsider).submitMilestoneProof(0, 0, proof, "ipfs://evidence"),
    ).to.be.revertedWithCustomError(escrow, "Unauthorized");
    await expect(escrow.connect(outsider).approveMilestone(0, 0))
      .to.be.revertedWithCustomError(escrow, "Unauthorized");
    await expect(escrow.connect(outsider).openDispute(0, "Not a participant"))
      .to.be.revertedWithCustomError(escrow, "Unauthorized");
    await expect(escrow.getAgreement(99))
      .to.be.revertedWithCustomError(escrow, "AgreementNotFound")
      .withArgs(99);
    await expect(escrow.connect(carrier).submitMilestoneProof(99, 0, proof, "ipfs://evidence"))
      .to.be.revertedWithCustomError(escrow, "AgreementNotFound")
      .withArgs(99);
  });

  it("bounds user-controlled strings while accepting useful boundary values", async function () {
    const { escrow, shipper, carrier, outsider } = await deployFixture();
    await expect(escrow.connect(outsider).register("x".repeat(100), 2))
      .to.emit(escrow, "UserRegistered");

    const signers = await ethers.getSigners();
    await expect(escrow.connect(signers[4]).register("x".repeat(101), 1))
      .to.be.revertedWithCustomError(escrow, "InputTooLong")
      .withArgs(101, 100);

    const now = await time.latest();
    await expect(
      escrow.connect(shipper).createAgreement(
        "x".repeat(201),
        carrier.address,
        now + 3600,
        "",
        ["Pickup"],
        ["Collect"],
        [ethers.parseEther("1")],
        [now + 1800],
        { value: ethers.parseEther("1") },
      ),
    ).to.be.revertedWithCustomError(escrow, "InputTooLong")
      .withArgs(201, 200);

    await expect(
      escrow.connect(shipper).createAgreement(
        "Valid",
        carrier.address,
        now + 3600,
        "",
        ["Pickup"],
        ["x".repeat(1001)],
        [ethers.parseEther("1")],
        [now + 1800],
        { value: ethers.parseEther("1") },
      ),
    ).to.be.revertedWithCustomError(escrow, "InputTooLong")
      .withArgs(1001, 1000);
  });

  it("bounds proof URIs and dispute reasons", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    await createAgreement(escrow, shipper, carrier);
    const proof = ethers.keccak256(ethers.toUtf8Bytes("evidence"));
    const tooLongURI = `ipfs://${"a".repeat(194)}`;

    await expect(escrow.connect(carrier).submitMilestoneProof(0, 0, proof, tooLongURI))
      .to.be.revertedWithCustomError(escrow, "InvalidProofURI");
    await expect(escrow.connect(shipper).openDispute(0, "x".repeat(1001)))
      .to.be.revertedWithCustomError(escrow, "InputTooLong")
      .withArgs(1001, 1000);

    const maximumURI = `ipfs://${"a".repeat(193)}`;
    await expect(escrow.connect(carrier).submitMilestoneProof(0, 0, proof, maximumURI))
      .to.emit(escrow, "MilestoneProofSubmitted");
    expect((await escrow.getMilestones(0))[0].proofURI).to.equal(maximumURI);
  });

  it("rejects past final and milestone deadlines with specific errors", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    const now = await time.latest();

    await expect(
      escrow.connect(shipper).createAgreement(
        "Expired agreement",
        carrier.address,
        now,
        "",
        ["Pickup"],
        ["Collect"],
        [ethers.parseEther("1")],
        [now],
        { value: ethers.parseEther("1") },
      ),
    ).to.be.revertedWithCustomError(escrow, "InvalidDeadline");

    await expect(
      escrow.connect(shipper).createAgreement(
        "Expired milestone",
        carrier.address,
        now + 3600,
        "",
        ["Pickup"],
        ["Collect"],
        [ethers.parseEther("1")],
        [now],
        { value: ethers.parseEther("1") },
      ),
    ).to.be.revertedWithCustomError(escrow, "MilestoneDeadlineNotSequential")
      .withArgs(0);
  });

  it("rejects non-sequential milestones and milestones after the final deadline", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    const now = await time.latest();
    const common = [
      "Invalid dates",
      carrier.address,
      now + 3600,
      "",
      ["Pickup", "Delivery"],
      ["Collect", "Deliver"],
      [ethers.parseEther("0.5"), ethers.parseEther("0.5")],
    ];

    await expect(
      escrow.connect(shipper).createAgreement(
        ...common,
        [now + 1800, now + 1800],
        { value: ethers.parseEther("1") },
      ),
    ).to.be.revertedWithCustomError(escrow, "MilestoneDeadlineNotSequential")
      .withArgs(1);

    await expect(
      escrow.connect(shipper).createAgreement(
        ...common,
        [now + 1800, now + 3700],
        { value: ethers.parseEther("1") },
      ),
    ).to.be.revertedWithCustomError(escrow, "MilestoneDeadlineAfterAgreement")
      .withArgs(1);
  });

  it("rejects missing agreements instead of panicking in refund checks", async function () {
    const { escrow } = await deployFixture();
    await expect(escrow.canRefund(99))
      .to.be.revertedWithCustomError(escrow, "AgreementNotFound")
      .withArgs(99);
  });

  it("blocks premature refunds and out-of-order or unauthorized proofs", async function () {
    const { escrow, shipper, carrier, outsider } = await deployFixture();
    await createAgreement(escrow, shipper, carrier);
    const proof = ethers.keccak256(ethers.toUtf8Bytes("evidence"));

    await expect(escrow.claimRefundAfterDeadline(0))
      .to.be.revertedWithCustomError(escrow, "DeadlineNotPassed");
    await expect(escrow.connect(outsider).submitMilestoneProof(0, 0, proof, ""))
      .to.be.revertedWithCustomError(escrow, "Unauthorized");
    await expect(escrow.connect(carrier).submitMilestoneProof(0, 1, proof, ""))
      .to.be.revertedWithCustomError(escrow, "InvalidMilestone");
  });

  it("preserves a timely submitted proof after its milestone due date", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    const { now } = await createAgreement(escrow, shipper, carrier);
    const proof = ethers.keccak256(ethers.toUtf8Bytes("timely evidence"));
    await escrow.connect(carrier).submitMilestoneProof(0, 0, proof, "ipfs://timely");
    await time.increaseTo(now + 1801);

    await expect(escrow.claimRefundAfterDeadline(0))
      .to.be.revertedWithCustomError(escrow, "DeadlineNotPassed");
    await expect(escrow.connect(shipper).approveMilestone(0, 0))
      .to.emit(escrow, "MilestoneApproved");
  });

  it("protects timely submitted evidence after the overall deadline", async function () {
    const { escrow, shipper, carrier } = await deployFixture();
    const { now } = await createAgreement(escrow, shipper, carrier);
    const proof = ethers.keccak256(ethers.toUtf8Bytes("final timely evidence"));

    await escrow.connect(carrier).submitMilestoneProof(0, 0, proof, "ipfs://pickup");
    await escrow.connect(shipper).approveMilestone(0, 0);
    await escrow.connect(carrier).submitMilestoneProof(0, 1, proof, "ipfs://delivery");
    await time.increaseTo(now + 7201);

    expect(await escrow.canRefund(0)).to.equal(false);
    await expect(escrow.claimRefundAfterDeadline(0))
      .to.be.revertedWithCustomError(escrow, "DeadlineNotPassed");
    await expect(escrow.connect(shipper).approveMilestone(0, 1))
      .to.emit(escrow, "AgreementCompleted");
  });
});
