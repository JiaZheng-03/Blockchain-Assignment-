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
    const { escrow, shipper } = await deployFixture();
    const profile = await escrow.getProfile(shipper.address);
    expect(profile.name).to.equal("Acme Imports");
    expect(profile.role).to.equal(1);
    await expect(escrow.connect(shipper).register("Again", 1))
      .to.be.revertedWithCustomError(escrow, "AlreadyRegistered");
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

    await expect(escrow.connect(shipper).approveMilestone(0, 0))
      .to.changeEtherBalances(
        [escrow, carrier],
        [-payouts[0], payouts[0]],
      );

    const agreement = await escrow.getAgreement(0);
    expect(agreement.remainingAmount).to.equal(payouts[1]);
    expect(agreement.nextMilestone).to.equal(1);
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
  });

  it("allows only the arbitrator to resolve a disputed remaining balance", async function () {
    const { escrow, arbitrator, shipper, carrier, outsider } = await deployFixture();
    await createAgreement(escrow, shipper, carrier);
    await escrow.connect(carrier).openDispute(0, "Cargo condition disputed");

    await expect(escrow.connect(outsider).resolveDispute(0, 1))
      .to.be.revertedWithCustomError(escrow, "Unauthorized");
    await escrow.connect(arbitrator).resolveDispute(0, ethers.parseEther("4"));

    const agreement = await escrow.getAgreement(0);
    expect(agreement.status).to.equal(4);
    expect(agreement.remainingAmount).to.equal(0);
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
});
