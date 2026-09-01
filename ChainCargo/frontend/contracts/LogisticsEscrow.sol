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
        Confirmed
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
        bool paid;
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
    error DuplicateAgreementName();
    error FixedMilestonesRequired();
    error EvidenceMissing();
    error EvidenceHashMismatch(bytes32 storedHash, bytes32 suppliedHash);
    error PaymentAlreadyReleased();
    error ReviewPeriodActive(uint64 availableAt);

    address public immutable arbitrator;
    uint256 public constant CONTRACT_VERSION = 4;
    string public constant EVIDENCE_URI_SCHEME = "supabase://";
    uint256 public constant MAX_MILESTONES = 2;
    uint256 public constant REPUTATION_POINTS_PER_MILESTONE = 10;
    uint256 public constant MIN_SCHEDULE_DELAY = 1 hours;
    uint256 public constant EVIDENCE_REVIEW_PERIOD = 2 days;
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
    mapping(address => mapping(bytes32 => bool)) private usedAgreementNames;
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
    event MilestoneConfirmed(
        uint256 indexed agreementId,
        uint256 indexed milestoneIndex,
        bytes32 indexed evidenceHash,
        address confirmer,
        uint256 paymentAmount
    );
    event CarrierReputationAwarded(
        address indexed carrier,
        uint256 indexed agreementId,
        uint256 indexed milestoneIndex,
        uint256 points,
        uint256 totalPoints
    );
    event EvidenceRejected(
        uint256 indexed agreementId,
        uint256 indexed milestoneIndex,
        address indexed shipper,
        uint256 refundAmount
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
        bytes32 agreementNameKey = _agreementNameKey(title);
        if (usedAgreementNames[msg.sender][agreementNameKey]) {
            revert DuplicateAgreementName();
        }
        _requireMaximumLength(notes, MAX_AGREEMENT_NOTES_LENGTH);
        if (msg.value == 0) revert ZeroFunding();
        if (deadline < block.timestamp + MIN_SCHEDULE_DELAY) {
            revert InvalidDeadline(deadline, uint64(block.timestamp));
        }
        if (milestoneNames.length != MAX_MILESTONES) {
            revert InvalidMilestoneCount(milestoneNames.length);
        }
        if (
            milestoneNames.length != milestoneDetails.length ||
            milestoneNames.length != payouts.length ||
            milestoneNames.length != dueDates.length
        ) revert MilestoneArrayLengthMismatch();

        if (
            keccak256(bytes(milestoneNames[0])) != keccak256("Cargo pickup") ||
            keccak256(bytes(milestoneNames[1])) != keccak256("Final delivery")
        ) revert FixedMilestonesRequired();

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

        usedAgreementNames[msg.sender][agreementNameKey] = true;
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
                    state: MilestoneState.Pending,
                    paid: false
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
        if (!_isValidProofURI(proofURI)) revert InvalidProofURI();
        _submitEvidence(agreementId, milestoneIndex, proofHash, proofURI);
    }

    /// @notice Minimal evidence commitment required by the assignment interface.
    /// @dev The Supabase-aware frontend uses submitMilestoneProof to include the file reference.
    function submitEvidence(
        uint256 agreementId,
        uint256 milestoneIndex,
        bytes32 evidenceHash
    ) external agreementExists(agreementId) {
        _submitEvidence(agreementId, milestoneIndex, evidenceHash, "");
    }

    function _submitEvidence(
        uint256 agreementId,
        uint256 milestoneIndex,
        bytes32 evidenceHash,
        string memory evidenceURI
    ) private {
        Agreement storage agreement = agreements[agreementId];
        if (agreement.carrier != msg.sender) revert Unauthorized();
        if (agreement.status != AgreementStatus.Active) revert InvalidStatus();
        if (milestoneIndex != agreement.nextMilestone) revert InvalidMilestone();
        if (block.timestamp > agreement.deadline) revert DeadlinePassed();

        Milestone storage milestone = milestones[agreementId][milestoneIndex];
        if (
            milestone.state != MilestoneState.Pending ||
            block.timestamp > milestone.dueAt ||
            evidenceHash == bytes32(0)
        ) revert InvalidMilestone();

        milestone.proofHash = evidenceHash;
        milestone.proofURI = evidenceURI;
        milestone.submittedAt = uint64(block.timestamp);
        milestone.state = MilestoneState.Submitted;
        emit MilestoneProofSubmitted(agreementId, milestoneIndex, evidenceHash, evidenceURI);
    }

    function confirmMilestone(
        uint256 agreementId,
        uint256 milestoneIndex,
        bytes32 expectedEvidenceHash
    ) external agreementExists(agreementId) nonReentrant {
        _confirmMilestone(agreementId, milestoneIndex, expectedEvidenceHash, true);
    }

    /// @notice Compatibility wrapper for clients deployed before confirmMilestone was introduced.
    function approveMilestone(
        uint256 agreementId,
        uint256 milestoneIndex
    ) external agreementExists(agreementId) nonReentrant {
        if (milestoneIndex >= milestones[agreementId].length) revert InvalidMilestone();
        bytes32 expectedEvidenceHash = milestones[agreementId][milestoneIndex].proofHash;
        _confirmMilestone(agreementId, milestoneIndex, expectedEvidenceHash, true);
    }

    /// @notice The Shipper may reject submitted evidence and recover all remaining escrow.
    function rejectEvidence(
        uint256 agreementId,
        uint256 milestoneIndex
    ) external agreementExists(agreementId) nonReentrant {
        Agreement storage agreement = agreements[agreementId];
        if (agreement.shipper != msg.sender) revert Unauthorized();
        if (agreement.status != AgreementStatus.Active) revert InvalidStatus();
        if (milestoneIndex != agreement.nextMilestone) revert InvalidMilestone();
        if (milestoneIndex >= milestones[agreementId].length) revert InvalidMilestone();

        Milestone storage milestone = milestones[agreementId][milestoneIndex];
        if (milestone.state != MilestoneState.Submitted) revert EvidenceMissing();

        uint256 refund = agreement.remainingAmount;
        agreement.remainingAmount = 0;
        agreement.status = AgreementStatus.Refunded;
        emit EvidenceRejected(agreementId, milestoneIndex, msg.sender, refund);
        emit Refunded(agreementId, agreement.shipper, refund);
        _sendValue(agreement.shipper, refund);
    }

    /// @notice Anyone may release a submitted milestone after the Shipper's review window expires.
    function finalizeMilestoneAfterReviewTimeout(
        uint256 agreementId,
        uint256 milestoneIndex
    ) external agreementExists(agreementId) nonReentrant {
        if (milestoneIndex >= milestones[agreementId].length) revert InvalidMilestone();
        Milestone storage milestone = milestones[agreementId][milestoneIndex];
        if (milestone.state != MilestoneState.Submitted || milestone.submittedAt == 0) {
            revert EvidenceMissing();
        }
        uint64 availableAt = milestone.submittedAt + uint64(EVIDENCE_REVIEW_PERIOD);
        if (block.timestamp < availableAt) revert ReviewPeriodActive(availableAt);
        _confirmMilestone(agreementId, milestoneIndex, milestone.proofHash, false);
    }

    function _confirmMilestone(
        uint256 agreementId,
        uint256 milestoneIndex,
        bytes32 expectedEvidenceHash,
        bool requireShipper
    ) private {
        Agreement storage agreement = agreements[agreementId];
        if (requireShipper && agreement.shipper != msg.sender) revert Unauthorized();
        if (agreement.status != AgreementStatus.Active) revert InvalidStatus();
        if (agreement.totalAmount == 0 || agreement.remainingAmount == 0) revert InvalidStatus();
        if (milestoneIndex >= milestones[agreementId].length) revert InvalidMilestone();

        Milestone storage milestone = milestones[agreementId][milestoneIndex];
        if (milestone.paid || milestone.state == MilestoneState.Confirmed) {
            revert PaymentAlreadyReleased();
        }
        if (milestoneIndex != agreement.nextMilestone) revert InvalidMilestone();
        if (milestone.state != MilestoneState.Submitted || milestone.proofHash == bytes32(0)) {
            revert EvidenceMissing();
        }
        if (expectedEvidenceHash != milestone.proofHash) {
            revert EvidenceHashMismatch(milestone.proofHash, expectedEvidenceHash);
        }

        uint256 payout = milestone.payout;
        if (payout > agreement.remainingAmount) {
            revert InvalidStatus();
        }

        // Checks-effects-interactions: confirmation and payment state are final before transfer.
        milestone.state = MilestoneState.Confirmed;
        milestone.paid = true;
        milestone.approvedAt = uint64(block.timestamp);
        agreement.nextMilestone += 1;
        agreement.remainingAmount -= payout;
        carrierReputation[agreement.carrier] += REPUTATION_POINTS_PER_MILESTONE;

        if (agreement.nextMilestone == milestones[agreementId].length) {
            agreement.status = AgreementStatus.Completed;
            emit AgreementCompleted(agreementId);
        }
        emit MilestoneConfirmed(
            agreementId,
            milestoneIndex,
            milestone.proofHash,
            msg.sender,
            payout
        );
        emit CarrierReputationAwarded(
            agreement.carrier,
            agreementId,
            milestoneIndex,
            REPUTATION_POINTS_PER_MILESTONE,
            carrierReputation[agreement.carrier]
        );
        _sendValue(agreement.carrier, payout);
    }

    function isAgreementNameAvailable(
        address shipper,
        string calldata title
    ) external view returns (bool) {
        if (bytes(title).length == 0) return false;
        return !usedAgreementNames[shipper][_agreementNameKey(title)];
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

    /// @dev New evidence uses a self-contained Supabase reference. Legacy IPFS references remain
    /// readable so agreements created before the storage migration do not lose their evidence.
    /// More detailed path/CID validation happens before the frontend fetches either location.
    function _isValidProofURI(string calldata proofURI) private pure returns (bool) {
        bytes calldata value = bytes(proofURI);
        if (value.length <= 7 || value.length > MAX_PROOF_URI_LENGTH) return false;
        bool isLegacyIpfs =
            value[0] == "i" &&
            value[1] == "p" &&
            value[2] == "f" &&
            value[3] == "s" &&
            value[4] == ":" &&
            value[5] == "/" &&
            value[6] == "/";
        bool isSupabase =
            value.length > 11 &&
            value[0] == "s" &&
            value[1] == "u" &&
            value[2] == "p" &&
            value[3] == "a" &&
            value[4] == "b" &&
            value[5] == "a" &&
            value[6] == "s" &&
            value[7] == "e" &&
            value[8] == ":" &&
            value[9] == "/" &&
            value[10] == "/";
        return isSupabase || isLegacyIpfs;
    }

    /// @dev Agreement names are unique per Shipper after trimming/collapsing ASCII whitespace
    /// and converting ASCII letters to lowercase.
    function _agreementNameKey(string calldata title) private pure returns (bytes32) {
        bytes calldata source = bytes(title);
        bytes memory normalized = new bytes(source.length);
        uint256 writeIndex;
        bool pendingSpace;

        for (uint256 i; i < source.length; ++i) {
            uint8 character = uint8(source[i]);
            bool isWhitespace =
                character == 32 || character == 9 || character == 10 || character == 13;
            if (isWhitespace) {
                if (writeIndex != 0) pendingSpace = true;
                continue;
            }
            if (pendingSpace) {
                normalized[writeIndex++] = bytes1(uint8(32));
                pendingSpace = false;
            }
            if (character >= 65 && character <= 90) character += 32;
            normalized[writeIndex++] = bytes1(character);
        }
        if (writeIndex == 0) revert EmptyTitle();
        assembly ("memory-safe") {
            mstore(normalized, writeIndex)
        }
        return keccak256(normalized);
    }

    receive() external payable {
        revert InvalidInput();
    }
}
