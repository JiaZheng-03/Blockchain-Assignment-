// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ChainCargo milestone-based logistics escrow
/// @notice Wallet addresses authenticate users. Shipment evidence is committed as a hash.
contract LogisticsEscrow {
    enum Role {
        None,
        Shipper,
        Carrier
    }

    enum AgreementStatus {
        Active,
        Completed,
        Refunded,
        Disputed,
        Resolved
    }

    enum MilestoneState {
        Pending,
        Submitted,
        Approved
    }

    struct UserProfile {
        string name;
        Role role;
        uint64 registeredAt;
    }

    struct Agreement {
        address shipper;
        address carrier;
        string title;
        string notes;
        uint256 totalAmount;
        uint256 remainingAmount;
        uint64 deadline;
        uint64 createdAt;
        AgreementStatus status;
        uint32 nextMilestone;
    }

    struct Milestone {
        string name;
        string details;
        uint256 payout;
        uint64 dueAt;
        bytes32 proofHash;
        string proofURI;
        uint64 submittedAt;
        uint64 approvedAt;
        MilestoneState state;
    }

    error Unauthorized();
    error InvalidInput();
    error InvalidRole();
    error AlreadyRegistered();
    error NotRegistered();
    error InvalidStatus();
    error InvalidMilestone();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error TransferFailed();
    error ReentrantCall();
    error AgreementNotFound(uint256 agreementId);
    error InvalidCarrier(address carrier);
    error SameParticipant();
    error EmptyTitle();
    error ZeroFunding();
    error InvalidDeadline(uint64 provided, uint64 currentTime);
    error InvalidMilestoneCount(uint256 count);
    error MilestoneArrayLengthMismatch();
    error EmptyMilestoneName(uint256 milestoneIndex);
    error ZeroMilestonePayout(uint256 milestoneIndex);
    error MilestoneDeadlineNotSequential(uint256 milestoneIndex);
    error MilestoneDeadlineAfterAgreement(uint256 milestoneIndex);
    error PayoutTotalMismatch(uint256 payoutTotal, uint256 depositedAmount);

    address public immutable arbitrator;
    uint256 public constant MAX_MILESTONES = 20;
    uint256 public agreementCount;

    mapping(address => UserProfile) private profiles;
    mapping(uint256 => Agreement) private agreements;
    mapping(uint256 => Milestone[]) private milestones;
    mapping(address => uint256[]) private userAgreementIds;

    uint256 private unlocked = 1;

    event UserRegistered(address indexed account, Role indexed role, string name);
    event AgreementCreated(
        uint256 indexed agreementId,
        address indexed shipper,
        address indexed carrier,
        uint256 amount,
        uint64 deadline
    );
    event MilestoneProofSubmitted(
        uint256 indexed agreementId,
        uint256 indexed milestoneIndex,
        bytes32 indexed proofHash,
        string proofURI
    );
    event MilestoneApproved(
        uint256 indexed agreementId,
        uint256 indexed milestoneIndex,
        uint256 payout
    );
    event AgreementCompleted(uint256 indexed agreementId);
    event Refunded(uint256 indexed agreementId, address indexed shipper, uint256 amount);
    event DisputeOpened(uint256 indexed agreementId, address indexed openedBy, string reason);
    event DisputeResolved(
        uint256 indexed agreementId,
        uint256 shipperAmount,
        uint256 carrierAmount
    );

    modifier nonReentrant() {
        if (unlocked != 1) revert ReentrantCall();
        unlocked = 2;
        _;
        unlocked = 1;
    }

    modifier agreementExists(uint256 agreementId) {
        if (agreementId >= agreementCount) revert AgreementNotFound(agreementId);
        _;
    }

    constructor() {
        arbitrator = msg.sender;
    }

    function register(string calldata name, Role role) external {
        if (profiles[msg.sender].role != Role.None) revert AlreadyRegistered();
        if (bytes(name).length == 0) revert InvalidInput();
        if (role != Role.Shipper && role != Role.Carrier) revert InvalidRole();

        profiles[msg.sender] = UserProfile(name, role, uint64(block.timestamp));
        emit UserRegistered(msg.sender, role, name);
    }

    function getProfile(address account) external view returns (UserProfile memory) {
        return profiles[account];
    }

    function createAgreement(
        string calldata title,
        address carrier,
        uint64 deadline,
        string calldata notes,
        string[] calldata milestoneNames,
        string[] calldata milestoneDetails,
        uint256[] calldata payouts,
        uint64[] calldata dueDates
    ) external payable returns (uint256 agreementId) {
        if (profiles[msg.sender].role != Role.Shipper) revert Unauthorized();
        if (profiles[carrier].role != Role.Carrier) revert InvalidCarrier(carrier);
        if (carrier == msg.sender) revert SameParticipant();
        if (bytes(title).length == 0) revert EmptyTitle();
        if (msg.value == 0) revert ZeroFunding();
        if (deadline <= block.timestamp) {
            revert InvalidDeadline(deadline, uint64(block.timestamp));
        }
        if (milestoneNames.length == 0 || milestoneNames.length > MAX_MILESTONES) {
            revert InvalidMilestoneCount(milestoneNames.length);
        }
        if (
            milestoneNames.length != milestoneDetails.length ||
            milestoneNames.length != payouts.length ||
            milestoneNames.length != dueDates.length
        ) revert MilestoneArrayLengthMismatch();

        uint256 payoutTotal;
        uint64 previousDueDate = uint64(block.timestamp);
        for (uint256 i; i < payouts.length; ++i) {
            if (bytes(milestoneNames[i]).length == 0) revert EmptyMilestoneName(i);
            if (payouts[i] == 0) revert ZeroMilestonePayout(i);
            if (dueDates[i] <= previousDueDate) {
                revert MilestoneDeadlineNotSequential(i);
            }
            if (dueDates[i] > deadline) revert MilestoneDeadlineAfterAgreement(i);
            payoutTotal += payouts[i];
            previousDueDate = dueDates[i];
        }
        if (payoutTotal != msg.value) revert PayoutTotalMismatch(payoutTotal, msg.value);

        agreementId = agreementCount++;
        agreements[agreementId] = Agreement({
            shipper: msg.sender,
            carrier: carrier,
            title: title,
            notes: notes,
            totalAmount: msg.value,
            remainingAmount: msg.value,
            deadline: deadline,
            createdAt: uint64(block.timestamp),
            status: AgreementStatus.Active,
            nextMilestone: 0
        });

        for (uint256 i; i < payouts.length; ++i) {
            milestones[agreementId].push(
                Milestone({
                    name: milestoneNames[i],
                    details: milestoneDetails[i],
                    payout: payouts[i],
                    dueAt: dueDates[i],
                    proofHash: bytes32(0),
                    proofURI: "",
                    submittedAt: 0,
                    approvedAt: 0,
                    state: MilestoneState.Pending
                })
            );
        }

        userAgreementIds[msg.sender].push(agreementId);
        userAgreementIds[carrier].push(agreementId);
        emit AgreementCreated(agreementId, msg.sender, carrier, msg.value, deadline);
    }

    function submitMilestoneProof(
        uint256 agreementId,
        uint256 milestoneIndex,
        bytes32 proofHash,
        string calldata proofURI
    ) external agreementExists(agreementId) {
        Agreement storage agreement = agreements[agreementId];
        if (agreement.carrier != msg.sender) revert Unauthorized();
        if (agreement.status != AgreementStatus.Active) revert InvalidStatus();
        if (milestoneIndex != agreement.nextMilestone) revert InvalidMilestone();
        if (block.timestamp > agreement.deadline) revert DeadlinePassed();

        Milestone storage milestone = milestones[agreementId][milestoneIndex];
        if (
            milestone.state != MilestoneState.Pending ||
            block.timestamp > milestone.dueAt ||
            proofHash == bytes32(0)
        ) revert InvalidMilestone();

        milestone.proofHash = proofHash;
        milestone.proofURI = proofURI;
        milestone.submittedAt = uint64(block.timestamp);
        milestone.state = MilestoneState.Submitted;
        emit MilestoneProofSubmitted(agreementId, milestoneIndex, proofHash, proofURI);
    }

    function approveMilestone(
        uint256 agreementId,
        uint256 milestoneIndex
    ) external agreementExists(agreementId) nonReentrant {
        Agreement storage agreement = agreements[agreementId];
        if (agreement.shipper != msg.sender) revert Unauthorized();
        if (agreement.status != AgreementStatus.Active) revert InvalidStatus();
        if (milestoneIndex != agreement.nextMilestone) revert InvalidMilestone();
        if (block.timestamp > agreement.deadline) revert DeadlinePassed();

        Milestone storage milestone = milestones[agreementId][milestoneIndex];
        if (milestone.state != MilestoneState.Submitted) revert InvalidMilestone();

        uint256 payout = milestone.payout;
        milestone.state = MilestoneState.Approved;
        milestone.approvedAt = uint64(block.timestamp);
        agreement.nextMilestone += 1;
        agreement.remainingAmount -= payout;

        if (agreement.nextMilestone == milestones[agreementId].length) {
            agreement.status = AgreementStatus.Completed;
            emit AgreementCompleted(agreementId);
        }
        emit MilestoneApproved(agreementId, milestoneIndex, payout);
        _sendValue(agreement.carrier, payout);
    }

    /// @notice Anyone can trigger an eligible refund; funds always return to the shipper.
    function claimRefundAfterDeadline(
        uint256 agreementId
    ) external agreementExists(agreementId) nonReentrant {
        Agreement storage agreement = agreements[agreementId];
        if (agreement.status != AgreementStatus.Active) revert InvalidStatus();

        Milestone storage current = milestones[agreementId][agreement.nextMilestone];
        bool missedOverallDeadline = block.timestamp > agreement.deadline;
        bool missedUnsubmittedMilestone =
            current.state == MilestoneState.Pending && block.timestamp > current.dueAt;
        if (!missedOverallDeadline && !missedUnsubmittedMilestone) {
            revert DeadlineNotPassed();
        }

        uint256 refund = agreement.remainingAmount;
        agreement.remainingAmount = 0;
        agreement.status = AgreementStatus.Refunded;
        emit Refunded(agreementId, agreement.shipper, refund);
        _sendValue(agreement.shipper, refund);
    }

    function openDispute(
        uint256 agreementId,
        string calldata reason
    ) external agreementExists(agreementId) {
        Agreement storage agreement = agreements[agreementId];
        if (msg.sender != agreement.shipper && msg.sender != agreement.carrier) {
            revert Unauthorized();
        }
        if (agreement.status != AgreementStatus.Active) revert InvalidStatus();
        if (bytes(reason).length == 0) revert InvalidInput();

        agreement.status = AgreementStatus.Disputed;
        emit DisputeOpened(agreementId, msg.sender, reason);
    }

    function resolveDispute(
        uint256 agreementId,
        uint256 shipperAmount
    ) external agreementExists(agreementId) nonReentrant {
        if (msg.sender != arbitrator) revert Unauthorized();
        Agreement storage agreement = agreements[agreementId];
        if (agreement.status != AgreementStatus.Disputed) revert InvalidStatus();
        if (shipperAmount > agreement.remainingAmount) revert InvalidInput();

        uint256 carrierAmount = agreement.remainingAmount - shipperAmount;
        agreement.remainingAmount = 0;
        agreement.status = AgreementStatus.Resolved;
        emit DisputeResolved(agreementId, shipperAmount, carrierAmount);

        if (shipperAmount != 0) _sendValue(agreement.shipper, shipperAmount);
        if (carrierAmount != 0) _sendValue(agreement.carrier, carrierAmount);
    }

    function getAgreement(
        uint256 agreementId
    ) external view agreementExists(agreementId) returns (Agreement memory) {
        return agreements[agreementId];
    }

    function getMilestones(
        uint256 agreementId
    ) external view agreementExists(agreementId) returns (Milestone[] memory) {
        return milestones[agreementId];
    }

    function getUserAgreementIds(address account) external view returns (uint256[] memory) {
        return userAgreementIds[account];
    }

    function canRefund(
        uint256 agreementId
    ) external view agreementExists(agreementId) returns (bool) {
        Agreement storage agreement = agreements[agreementId];
        if (agreement.status != AgreementStatus.Active) return false;
        Milestone storage current = milestones[agreementId][agreement.nextMilestone];
        return
            block.timestamp > agreement.deadline ||
            (current.state == MilestoneState.Pending && block.timestamp > current.dueAt);
    }

    function _sendValue(address recipient, uint256 amount) private {
        (bool success, ) = payable(recipient).call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    receive() external payable {
        revert InvalidInput();
    }
}
