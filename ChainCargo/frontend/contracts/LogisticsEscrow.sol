// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ChainCargo milestone-based logistics escrow
/// @notice Wallet addresses authenticate users. Shipment evidence is committed as a hash.
contract LogisticsEscrow {
    enum Role {
        None,
        Shipper,
        Carrier,
        Arbitrator
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
    error InputTooLong(uint256 providedLength, uint256 maximumLength);
    error InvalidProofURI();
    error DeadlineRefundAvailable();

    address public immutable arbitrator;
    uint256 public constant MAX_MILESTONES = 20;
    uint256 public constant REPUTATION_POINTS_PER_MILESTONE = 10;
    uint256 public constant MAX_PROFILE_NAME_LENGTH = 100;
    uint256 public constant MAX_AGREEMENT_TITLE_LENGTH = 200;
    uint256 public constant MAX_AGREEMENT_NOTES_LENGTH = 2_000;
    uint256 public constant MAX_MILESTONE_NAME_LENGTH = 120;
    uint256 public constant MAX_MILESTONE_DETAILS_LENGTH = 1_000;
    uint256 public constant MAX_PROOF_URI_LENGTH = 200;
    uint256 public constant MAX_DISPUTE_REASON_LENGTH = 1_000;
    uint256 public agreementCount;

    mapping(address => UserProfile) private profiles;
    mapping(Role => address[]) private roleAccounts;
    mapping(uint256 => Agreement) private agreements;
    mapping(uint256 => Milestone[]) private milestones;
    mapping(address => uint256[]) private userAgreementIds;
    mapping(address => uint256) public carrierReputation;

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
    event CarrierReputationAwarded(
        address indexed carrier,
        uint256 indexed agreementId,
        uint256 indexed milestoneIndex,
        uint256 points,
        uint256 totalPoints
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
        _requireMaximumLength(name, MAX_PROFILE_NAME_LENGTH);
        if (role == Role.Arbitrator) {
            if (msg.sender != arbitrator) revert Unauthorized();
        } else if (role != Role.Shipper && role != Role.Carrier) {
            revert InvalidRole();
        }

        profiles[msg.sender] = UserProfile(name, role, uint64(block.timestamp));
        roleAccounts[role].push(msg.sender);
        emit UserRegistered(msg.sender, role, name);
    }

    function getProfile(address account) external view returns (UserProfile memory) {
        return profiles[account];
    }

    function getUsersByRole(Role role) external view returns (address[] memory) {
        if (role == Role.None) revert InvalidRole();
        return roleAccounts[role];
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
        _requireMaximumLength(title, MAX_AGREEMENT_TITLE_LENGTH);
        _requireMaximumLength(notes, MAX_AGREEMENT_NOTES_LENGTH);
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
            _requireMaximumLength(milestoneNames[i], MAX_MILESTONE_NAME_LENGTH);
            _requireMaximumLength(milestoneDetails[i], MAX_MILESTONE_DETAILS_LENGTH);
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
        if (!_isValidProofURI(proofURI)) revert InvalidProofURI();

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

        Milestone storage milestone = milestones[agreementId][milestoneIndex];
        if (milestone.state != MilestoneState.Submitted) revert InvalidMilestone();

        uint256 payout = milestone.payout;
        milestone.state = MilestoneState.Approved;
        milestone.approvedAt = uint64(block.timestamp);
        agreement.nextMilestone += 1;
        agreement.remainingAmount -= payout;
        carrierReputation[agreement.carrier] += REPUTATION_POINTS_PER_MILESTONE;

        if (agreement.nextMilestone == milestones[agreementId].length) {
            agreement.status = AgreementStatus.Completed;
            emit AgreementCompleted(agreementId);
        }
        emit MilestoneApproved(agreementId, milestoneIndex, payout);
        emit CarrierReputationAwarded(
            agreement.carrier,
            agreementId,
            milestoneIndex,
            REPUTATION_POINTS_PER_MILESTONE,
            carrierReputation[agreement.carrier]
        );
        _sendValue(agreement.carrier, payout);
    }

    /// @notice Anyone can trigger an eligible refund; funds always return to the shipper.
    function claimRefundAfterDeadline(
        uint256 agreementId
    ) external agreementExists(agreementId) nonReentrant {
        Agreement storage agreement = agreements[agreementId];
        if (agreement.status != AgreementStatus.Active) revert InvalidStatus();

        Milestone storage current = milestones[agreementId][agreement.nextMilestone];
        bool missedUnsubmittedMilestone =
            current.state == MilestoneState.Pending && block.timestamp > current.dueAt;
        if (!missedUnsubmittedMilestone) {
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
        _requireMaximumLength(reason, MAX_DISPUTE_REASON_LENGTH);

        Milestone storage current = milestones[agreementId][agreement.nextMilestone];
        if (current.state == MilestoneState.Pending && block.timestamp > current.dueAt) {
            revert DeadlineRefundAvailable();
        }

        agreement.status = AgreementStatus.Disputed;
        emit DisputeOpened(agreementId, msg.sender, reason);
    }

    function resolveDispute(
        uint256 agreementId,
        uint256 shipperAmount
    ) external agreementExists(agreementId) nonReentrant {
        if (msg.sender != arbitrator || profiles[msg.sender].role != Role.Arbitrator) {
            revert Unauthorized();
        }
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
        return current.state == MilestoneState.Pending && block.timestamp > current.dueAt;
    }

    function _sendValue(address recipient, uint256 amount) private {
        (bool success, ) = payable(recipient).call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    function _requireMaximumLength(string calldata value, uint256 maximumLength) private pure {
        uint256 length = bytes(value).length;
        if (length > maximumLength) revert InputTooLong(length, maximumLength);
    }

    /// @dev Keep on-chain validation cheap: require the workflow scheme, a non-empty CID,
    /// and a bounded URI. CID syntax is validated more strictly before the frontend fetches it.
    function _isValidProofURI(string calldata proofURI) private pure returns (bool) {
        bytes calldata value = bytes(proofURI);
        if (value.length <= 7 || value.length > MAX_PROOF_URI_LENGTH) return false;
        return
            value[0] == "i" &&
            value[1] == "p" &&
            value[2] == "f" &&
            value[3] == "s" &&
            value[4] == ":" &&
            value[5] == "/" &&
            value[6] == "/";
    }

    receive() external payable {
        revert InvalidInput();
    }
}
