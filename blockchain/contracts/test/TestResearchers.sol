// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// TEST-ONLY helper contracts. Not deployed by the deploy script.

interface IBountyPlatform {
    function submitReport(uint256 programId, bytes32 reportHash) external returns (uint256);
    function claimReward(uint256 submissionId) external;
}

/// Researcher contract that cannot receive ETH -> transfer must fail cleanly.
contract RejectingResearcher {
    IBountyPlatform public immutable platform;
    constructor(address p) { platform = IBountyPlatform(p); }
    function submit(uint256 programId, bytes32 h) external { platform.submitReport(programId, h); }
    function claim(uint256 id) external { platform.claimReward(id); }
    receive() external payable { revert("no ETH"); }
}

/// Researcher contract that tries to re-enter claimReward from receive().
contract ReentrantResearcher {
    IBountyPlatform public immutable platform;
    uint256 public target;
    constructor(address p) { platform = IBountyPlatform(p); }
    function submit(uint256 programId, bytes32 h) external { platform.submitReport(programId, h); }
    function attack(uint256 id) external { target = id; platform.claimReward(id); }
    receive() external payable { platform.claimReward(target); }
}
