// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title  BountyPlatform
 * @notice Decentralised bug bounty platform (academic demonstration).
 *
 * What lives ON-CHAIN (needs immutability / verifiable authorisation / fund custody):
 *   - organisation authorisation, verifier assignment, dispute resolver
 *   - program identifiers, metadata hash, reward tiers, reward pool accounting
 *   - submission identifiers, report hashes, review decisions, severity, reward
 *   - dispute decisions and all important events
 *
 * What lives OFF-CHAIN (backend, encrypted): full report text, PoC, steps to
 * reproduce, verifier notes, dispute evidence. Only keccak256 hashes of those
 * documents are stored here so their integrity can be checked later.
 *
 * Roles
 *   - Admin (contract owner): registers organisations, sets dispute resolver.
 *     Admin has NO review power and cannot be made dispute resolver.
 *   - Organisation: creates / funds programs, assigns verifiers.
 *   - Researcher: any address; submits report hashes, claims rewards, disputes.
 *   - Verifier: per-program reviewer assigned by the program owner.
 *   - Dispute resolver: single address set by admin, finalises disputes.
 */
contract BountyPlatform is Ownable2Step, ReentrancyGuard {
    // ------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------

    enum Severity {
        None, // 0 - not set
        Low, // 1
        Medium, // 2
        High, // 3
        Critical // 4
    }

    /// Submission state machine:
    /// Submitted -> Approved -> Claimed
    /// Submitted -> Rejected -> Disputed -> Approved (overturned) -> Claimed
    ///                                   -> RejectionUpheld (final)
    enum SubmissionStatus {
        None,
        Submitted,
        Approved,
        Rejected,
        Disputed,
        RejectionUpheld,
        Claimed
    }

    enum DisputeStatus {
        None,
        Open,
        Upheld, // original rejection upheld
        Overturned // rejection overturned, report approved
    }

    struct Organization {
        string name;
        bool authorized;
        uint64 registeredAt;
    }

    struct Program {
        uint256 id;
        address owner; // organisation wallet
        string title;
        bytes32 metadataHash; // hash of full off-chain description/scope/rules
        uint64 startTime;
        uint64 endTime;
        bool active;
        uint256[4] rewards; // wei for Low, Medium, High, Critical
        uint256 availableBalance; // funded and not reserved
        uint256 reservedBalance; // reserved for approved, unclaimed rewards
        uint256 totalPaid;
        uint256 submissionCount;
        uint256 openItems; // submissions in Submitted or Disputed state
        uint64 disputeLockUntil; // latest dispute deadline of any rejection -> funds stay locked until then
    }

    struct Submission {
        uint256 id;
        uint256 programId;
        address researcher;
        bytes32 reportHash;
        uint64 submittedAt;
        SubmissionStatus status;
        Severity severity;
        uint256 reward;
        address reviewer;
        uint64 reviewedAt;
        bytes32 reviewNoteHash;
    }

    struct Dispute {
        uint256 submissionId;
        address researcher;
        bytes32 evidenceHash;
        uint64 raisedAt;
        DisputeStatus status;
        address resolver;
        uint64 resolvedAt;
        bytes32 resolutionNoteHash;
    }

    // ------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------

    uint64 public constant MIN_DISPUTE_WINDOW = 1 hours;
    uint64 public constant MAX_DISPUTE_WINDOW = 90 days;

    address public disputeResolver;
    uint64 public disputeWindow = 7 days;

    uint256 public programCount;
    uint256 public submissionCount;
    uint256 public disputeCount;
    uint256 public totalRewardsDistributed;

    mapping(address => Organization) private _organizations;
    address[] private _organizationList;

    mapping(uint256 => Program) private _programs;
    mapping(address => uint256[]) private _orgPrograms;

    // programId => verifier => assigned
    mapping(uint256 => mapping(address => bool)) public isVerifier;
    mapping(uint256 => address[]) private _programVerifiers;
    mapping(address => uint256[]) private _verifierPrograms;

    mapping(uint256 => Submission) private _submissions;
    mapping(uint256 => uint256[]) private _programSubmissions;
    mapping(address => uint256[]) private _researcherSubmissions;
    mapping(bytes32 => bool) public reportHashUsed;

    mapping(uint256 => Dispute) private _disputes; // keyed by submissionId
    /// Dispute deadline fixed at rejection time, so later changes to
    /// disputeWindow never shorten (or extend) an already-running window.
    mapping(uint256 => uint64) public disputeDeadline;
    uint256[] private _disputedSubmissionIds;

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    event OrganizationRegistered(address indexed org, string name);
    event OrganizationRevoked(address indexed org);
    event DisputeResolverChanged(address indexed previous, address indexed current);
    event DisputeWindowChanged(uint64 newWindow);

    event ProgramCreated(uint256 indexed programId, address indexed owner, string title, bytes32 metadataHash, uint256[4] rewards);
    event ProgramFunded(uint256 indexed programId, address indexed from, uint256 amount, uint256 newAvailable);
    event ProgramStatusChanged(uint256 indexed programId, bool active);
    event FundsWithdrawn(uint256 indexed programId, address indexed to, uint256 amount);

    event VerifierAssigned(uint256 indexed programId, address indexed verifier);
    event VerifierRemoved(uint256 indexed programId, address indexed verifier);

    event ReportSubmitted(uint256 indexed submissionId, uint256 indexed programId, address indexed researcher, bytes32 reportHash);
    event ReportApproved(uint256 indexed submissionId, address indexed reviewer, Severity severity, bytes32 noteHash);
    event ReportRejected(uint256 indexed submissionId, address indexed reviewer, bytes32 noteHash);
    event RewardReserved(uint256 indexed submissionId, address indexed researcher, uint256 amount);
    event RewardClaimed(uint256 indexed submissionId, address indexed researcher, uint256 amount);

    event DisputeRaised(uint256 indexed submissionId, address indexed researcher, bytes32 evidenceHash);
    event DisputeResolved(uint256 indexed submissionId, address indexed resolver, bool overturned, Severity severity, bytes32 noteHash);

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------

    error ZeroAddress();
    error EmptyValue();
    error NotOrganization();
    error NotProgramOwner();
    error NotVerifier();
    error NotDisputeResolver();
    error NotResearcher();
    error AlreadyRegistered();
    error AlreadyAssigned();
    error NotAssigned();
    error InvalidTimeRange();
    error InvalidRewardTiers();
    error ProgramNotFound();
    error SubmissionNotFound();
    error ProgramNotOpen();
    error DuplicateReport();
    error ConflictOfInterest();
    error InvalidStatus();
    error InvalidSeverity();
    error InsufficientPool();
    error DisputeWindowClosed();
    error DisputeAlreadyExists();
    error FundsLocked();
    error TransferFailed();
    error InvalidWindow();

    // ------------------------------------------------------------------
    // Modifiers
    // ------------------------------------------------------------------

    modifier onlyOrganization() {
        if (!_organizations[msg.sender].authorized) revert NotOrganization();
        _;
    }

    modifier programExists(uint256 programId) {
        if (programId == 0 || programId > programCount) revert ProgramNotFound();
        _;
    }

    modifier onlyProgramOwner(uint256 programId) {
        if (programId == 0 || programId > programCount) revert ProgramNotFound();
        if (_programs[programId].owner != msg.sender) revert NotProgramOwner();
        _;
    }

    modifier submissionExists(uint256 submissionId) {
        if (submissionId == 0 || submissionId > submissionCount) revert SubmissionNotFound();
        _;
    }

    modifier onlyDisputeResolver() {
        if (msg.sender != disputeResolver || msg.sender == address(0)) revert NotDisputeResolver();
        _;
    }

    constructor(address admin) Ownable(admin) {}

    /// Admin role (incl. 2-step acceptance) may not land on a wallet that is an
    /// organisation, the dispute resolver or a verifier -> admin never reviews.
    function _transferOwnership(address newOwner) internal override {
        if (
            newOwner != address(0) &&
            (_organizations[newOwner].authorized || newOwner == disputeResolver || _verifierPrograms[newOwner].length != 0)
        ) revert ConflictOfInterest();
        super._transferOwnership(newOwner);
    }

    // ------------------------------------------------------------------
    // Admin functions
    // ------------------------------------------------------------------

    function registerOrganization(address org, string calldata name) external onlyOwner {
        if (org == address(0)) revert ZeroAddress();
        if (bytes(name).length == 0) revert EmptyValue();
        if (org == owner()) revert ConflictOfInterest();
        Organization storage o = _organizations[org];
        if (o.authorized) revert AlreadyRegistered();
        if (o.registeredAt == 0) _organizationList.push(org); // first time ever
        o.name = name;
        o.authorized = true;
        o.registeredAt = uint64(block.timestamp);
        emit OrganizationRegistered(org, name);
    }

    /// @notice Revoking stops new programs; existing programs keep running so
    ///         researchers' reserved rewards are never put at risk.
    function revokeOrganization(address org) external onlyOwner {
        if (!_organizations[org].authorized) revert NotOrganization();
        _organizations[org].authorized = false;
        emit OrganizationRevoked(org);
    }

    function setDisputeResolver(address resolver) external onlyOwner {
        if (resolver == address(0)) revert ZeroAddress();
        // Admin must not be able to approve reports, even indirectly.
        if (resolver == owner()) revert ConflictOfInterest();
        emit DisputeResolverChanged(disputeResolver, resolver);
        disputeResolver = resolver;
    }

    function setDisputeWindow(uint64 newWindow) external onlyOwner {
        if (newWindow < MIN_DISPUTE_WINDOW || newWindow > MAX_DISPUTE_WINDOW) revert InvalidWindow();
        disputeWindow = newWindow;
        emit DisputeWindowChanged(newWindow);
    }

    // ------------------------------------------------------------------
    // Organisation / program functions
    // ------------------------------------------------------------------

    /**
     * @param rewards wei amounts for [Low, Medium, High, Critical]. Must be
     *        non-zero and non-decreasing.
     * @dev   msg.value is the initial reward pool funding (must be > 0).
     */
    function createProgram(
        string calldata title,
        bytes32 metadataHash,
        uint64 startTime,
        uint64 endTime,
        uint256[4] calldata rewards
    ) external payable onlyOrganization returns (uint256 programId) {
        if (bytes(title).length == 0 || metadataHash == bytes32(0)) revert EmptyValue();
        if (endTime <= startTime || endTime <= block.timestamp) revert InvalidTimeRange();
        if (rewards[0] == 0) revert InvalidRewardTiers();
        for (uint256 i = 1; i < 4; i++) {
            if (rewards[i] < rewards[i - 1]) revert InvalidRewardTiers();
        }
        if (msg.value == 0) revert InsufficientPool();

        programId = ++programCount;
        Program storage p = _programs[programId];
        p.id = programId;
        p.owner = msg.sender;
        p.title = title;
        p.metadataHash = metadataHash;
        p.startTime = startTime;
        p.endTime = endTime;
        p.active = true;
        p.rewards = rewards;
        p.availableBalance = msg.value;
        _orgPrograms[msg.sender].push(programId);

        emit ProgramCreated(programId, msg.sender, title, metadataHash, rewards);
        emit ProgramFunded(programId, msg.sender, msg.value, msg.value);
    }

    function fundProgram(uint256 programId) external payable onlyProgramOwner(programId) {
        if (msg.value == 0) revert EmptyValue();
        Program storage p = _programs[programId];
        p.availableBalance += msg.value;
        emit ProgramFunded(programId, msg.sender, msg.value, p.availableBalance);
    }

    function setProgramActive(uint256 programId, bool active) external onlyProgramOwner(programId) {
        _programs[programId].active = active;
        emit ProgramStatusChanged(programId, active);
    }

    /**
     * @notice Organisation recovers unreserved funds once the program is closed
     *         (inactive or past end), no review/dispute is pending and the
     *         dispute window of the latest rejection has passed. Reserved
     *         rewards can never be withdrawn by the organisation.
     */
    function withdrawUnreserved(uint256 programId, uint256 amount) external nonReentrant onlyProgramOwner(programId) {
        Program storage p = _programs[programId];
        bool closed = !p.active || block.timestamp > p.endTime;
        if (!closed || p.openItems != 0 || block.timestamp <= p.disputeLockUntil) {
            revert FundsLocked();
        }
        if (amount == 0) revert EmptyValue();
        if (amount > p.availableBalance) revert InsufficientPool();

        p.availableBalance -= amount; // effects before interaction
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit FundsWithdrawn(programId, msg.sender, amount);
    }

    function assignVerifier(uint256 programId, address verifier) external onlyProgramOwner(programId) {
        if (verifier == address(0)) revert ZeroAddress();
        // keep admin out of review; separation of duties: owner funds, verifier reviews
        if (verifier == owner() || verifier == msg.sender) revert ConflictOfInterest();
        if (isVerifier[programId][verifier]) revert AlreadyAssigned();
        isVerifier[programId][verifier] = true;
        _programVerifiers[programId].push(verifier);
        _verifierPrograms[verifier].push(programId);
        emit VerifierAssigned(programId, verifier);
    }

    function removeVerifier(uint256 programId, address verifier) external onlyProgramOwner(programId) {
        if (!isVerifier[programId][verifier]) revert NotAssigned();
        isVerifier[programId][verifier] = false;
        _removeFromArray(_programVerifiers[programId], verifier);
        _removeIdFromArray(_verifierPrograms[verifier], programId);
        emit VerifierRemoved(programId, verifier);
    }

    // ------------------------------------------------------------------
    // Researcher functions
    // ------------------------------------------------------------------

    /// @param reportHash keccak256 of the canonical off-chain report JSON.
    function submitReport(uint256 programId, bytes32 reportHash)
        external
        programExists(programId)
        returns (uint256 submissionId)
    {
        Program storage p = _programs[programId];
        if (!p.active || block.timestamp < p.startTime || block.timestamp > p.endTime) revert ProgramNotOpen();
        if (reportHash == bytes32(0)) revert EmptyValue();
        if (reportHashUsed[reportHash]) revert DuplicateReport();
        // program owner and its verifiers may not farm their own bounty
        if (msg.sender == p.owner || isVerifier[programId][msg.sender]) revert ConflictOfInterest();

        reportHashUsed[reportHash] = true;
        submissionId = ++submissionCount;
        _submissions[submissionId] = Submission({
            id: submissionId,
            programId: programId,
            researcher: msg.sender,
            reportHash: reportHash,
            submittedAt: uint64(block.timestamp),
            status: SubmissionStatus.Submitted,
            severity: Severity.None,
            reward: 0,
            reviewer: address(0),
            reviewedAt: 0,
            reviewNoteHash: bytes32(0)
        });
        p.submissionCount++;
        p.openItems++;
        _programSubmissions[programId].push(submissionId);
        _researcherSubmissions[msg.sender].push(submissionId);

        emit ReportSubmitted(submissionId, programId, msg.sender, reportHash);
    }

    /// @notice Pull-payment: researcher withdraws own reserved reward once.
    function claimReward(uint256 submissionId) external nonReentrant submissionExists(submissionId) {
        Submission storage s = _submissions[submissionId];
        if (s.researcher != msg.sender) revert NotResearcher();
        if (s.status != SubmissionStatus.Approved) revert InvalidStatus();

        Program storage p = _programs[s.programId];
        uint256 amount = s.reward;

        // Effects
        s.status = SubmissionStatus.Claimed;
        p.reservedBalance -= amount;
        p.totalPaid += amount;
        totalRewardsDistributed += amount;

        // Interaction (if it fails the whole tx reverts -> accounting untouched)
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit RewardClaimed(submissionId, msg.sender, amount);
    }

    function raiseDispute(uint256 submissionId, bytes32 evidenceHash) external submissionExists(submissionId) {
        Submission storage s = _submissions[submissionId];
        if (s.researcher != msg.sender) revert NotResearcher();
        if (_disputes[submissionId].status != DisputeStatus.None) revert DisputeAlreadyExists();
        if (s.status != SubmissionStatus.Rejected) revert InvalidStatus();
        if (block.timestamp > disputeDeadline[submissionId]) revert DisputeWindowClosed();
        if (evidenceHash == bytes32(0)) revert EmptyValue();

        s.status = SubmissionStatus.Disputed;
        _programs[s.programId].openItems++;
        _disputes[submissionId] = Dispute({
            submissionId: submissionId,
            researcher: msg.sender,
            evidenceHash: evidenceHash,
            raisedAt: uint64(block.timestamp),
            status: DisputeStatus.Open,
            resolver: address(0),
            resolvedAt: 0,
            resolutionNoteHash: bytes32(0)
        });
        _disputedSubmissionIds.push(submissionId);
        disputeCount++;
        emit DisputeRaised(submissionId, msg.sender, evidenceHash);
    }

    // ------------------------------------------------------------------
    // Verifier functions
    // ------------------------------------------------------------------

    function approveReport(uint256 submissionId, Severity severity, bytes32 noteHash)
        external
        submissionExists(submissionId)
    {
        Submission storage s = _checkReviewable(submissionId);
        uint256 reward = _approve(s, severity);
        s.reviewer = msg.sender;
        s.reviewedAt = uint64(block.timestamp);
        s.reviewNoteHash = noteHash;
        _programs[s.programId].openItems--;
        emit ReportApproved(submissionId, msg.sender, severity, noteHash);
        emit RewardReserved(submissionId, s.researcher, reward);
    }

    function rejectReport(uint256 submissionId, bytes32 noteHash) external submissionExists(submissionId) {
        Submission storage s = _checkReviewable(submissionId);
        if (noteHash == bytes32(0)) revert EmptyValue(); // a rejection must have a reason
        s.status = SubmissionStatus.Rejected;
        s.reviewer = msg.sender;
        s.reviewedAt = uint64(block.timestamp);
        s.reviewNoteHash = noteHash;
        uint64 deadline = uint64(block.timestamp) + disputeWindow;
        disputeDeadline[submissionId] = deadline;
        Program storage p = _programs[s.programId];
        p.openItems--;
        if (deadline > p.disputeLockUntil) p.disputeLockUntil = deadline;
        emit ReportRejected(submissionId, msg.sender, noteHash);
    }

    // ------------------------------------------------------------------
    // Dispute resolver
    // ------------------------------------------------------------------

    function resolveDispute(uint256 submissionId, bool overturn, Severity severity, bytes32 noteHash)
        external
        onlyDisputeResolver
        submissionExists(submissionId)
    {
        Submission storage s = _submissions[submissionId];
        Dispute storage d = _disputes[submissionId];
        if (d.status != DisputeStatus.Open || s.status != SubmissionStatus.Disputed) revert InvalidStatus();
        // resolver must be independent of every party to this submission
        if (
            s.researcher == msg.sender ||
            s.reviewer == msg.sender ||
            _programs[s.programId].owner == msg.sender ||
            isVerifier[s.programId][msg.sender]
        ) revert ConflictOfInterest();
        if (noteHash == bytes32(0)) revert EmptyValue();

        uint256 reward;
        if (overturn) {
            reward = _approve(s, severity); // sets Approved + reserves reward
            d.status = DisputeStatus.Overturned;
        } else {
            if (severity != Severity.None) revert InvalidSeverity();
            s.status = SubmissionStatus.RejectionUpheld;
            d.status = DisputeStatus.Upheld;
        }
        d.resolver = msg.sender;
        d.resolvedAt = uint64(block.timestamp);
        d.resolutionNoteHash = noteHash;
        _programs[s.programId].openItems--;
        emit DisputeResolved(submissionId, msg.sender, overturn, severity, noteHash);
        if (overturn) emit RewardReserved(submissionId, s.researcher, reward);
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    function _checkReviewable(uint256 submissionId) internal view returns (Submission storage s) {
        s = _submissions[submissionId];
        if (!isVerifier[s.programId][msg.sender]) revert NotVerifier();
        if (s.researcher == msg.sender) revert ConflictOfInterest();
        if (s.status != SubmissionStatus.Submitted) revert InvalidStatus();
    }

    /// Reward comes ONLY from the program's predefined tier -> no arbitrary amounts.
    function _approve(Submission storage s, Severity severity) internal returns (uint256 reward) {
        if (severity == Severity.None) revert InvalidSeverity();
        Program storage p = _programs[s.programId];
        reward = p.rewards[uint256(severity) - 1];
        if (p.availableBalance < reward) revert InsufficientPool();
        p.availableBalance -= reward;
        p.reservedBalance += reward;
        s.status = SubmissionStatus.Approved;
        s.severity = severity;
        s.reward = reward;
    }

    function _removeFromArray(address[] storage arr, address value) private {
        uint256 len = arr.length;
        for (uint256 i = 0; i < len; i++) {
            if (arr[i] == value) {
                arr[i] = arr[len - 1];
                arr.pop();
                return;
            }
        }
    }

    function _removeIdFromArray(uint256[] storage arr, uint256 value) private {
        uint256 len = arr.length;
        for (uint256 i = 0; i < len; i++) {
            if (arr[i] == value) {
                arr[i] = arr[len - 1];
                arr.pop();
                return;
            }
        }
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function getOrganization(address org) external view returns (Organization memory) {
        return _organizations[org];
    }

    function isOrganization(address org) external view returns (bool) {
        return _organizations[org].authorized;
    }

    function getOrganizations() external view returns (address[] memory) {
        return _organizationList;
    }

    function getProgram(uint256 programId) external view programExists(programId) returns (Program memory) {
        return _programs[programId];
    }

    function getProgramVerifiers(uint256 programId) external view returns (address[] memory) {
        return _programVerifiers[programId];
    }

    function getProgramSubmissions(uint256 programId) external view returns (uint256[] memory) {
        return _programSubmissions[programId];
    }

    function getOrganizationPrograms(address org) external view returns (uint256[] memory) {
        return _orgPrograms[org];
    }

    function getVerifierPrograms(address verifier) external view returns (uint256[] memory) {
        return _verifierPrograms[verifier];
    }

    function getSubmission(uint256 submissionId)
        external
        view
        submissionExists(submissionId)
        returns (Submission memory)
    {
        return _submissions[submissionId];
    }

    function getResearcherSubmissions(address researcher) external view returns (uint256[] memory) {
        return _researcherSubmissions[researcher];
    }

    function getDispute(uint256 submissionId) external view returns (Dispute memory) {
        return _disputes[submissionId];
    }

    function getDisputedSubmissions() external view returns (uint256[] memory) {
        return _disputedSubmissionIds;
    }

    /// Convenience for the frontend: on-chain role flags for an address.
    function getRoles(address account)
        external
        view
        returns (bool isAdmin, bool isOrg, bool isResolver, uint256 verifierProgramCount)
    {
        isAdmin = account == owner();
        isOrg = _organizations[account].authorized;
        isResolver = account == disputeResolver && account != address(0);
        verifierProgramCount = _verifierPrograms[account].length;
    }

    function getStats()
        external
        view
        returns (uint256 orgs, uint256 programs, uint256 submissions, uint256 disputes, uint256 distributed)
    {
        return (_organizationList.length, programCount, submissionCount, disputeCount, totalRewardsDistributed);
    }

    /// Reject plain ETH transfers: funds must go through createProgram/fundProgram.
    receive() external payable {
        revert EmptyValue();
    }
}
