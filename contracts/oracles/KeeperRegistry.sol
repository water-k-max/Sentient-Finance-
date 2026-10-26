// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title KeeperRegistry — Authorized keeper set for price posting
/// Keepers post prices to SomniaPriceOracle. They bond STT to participate.
/// Misbehaving keepers are slashed and removed.
contract KeeperRegistry {
    address public owner;
    uint256 public constant MIN_BOND = 0.1 ether;
    uint256 public constant SLASH_AMOUNT = 0.05 ether;
    uint256 public constant MAX_KEEPERS = 10;

    struct Keeper {
        bool active;
        uint256 bond;
        uint256 lastPost;
        uint256 totalPosts;
        uint256 totalSlashes;
    }

    mapping(address => Keeper) public keepers;
    address[] public keeperList;

    event KeeperAdded(address indexed keeper, uint256 bond);
    event KeeperRemoved(address indexed keeper);
    event KeeperSlashed(address indexed keeper, uint256 amount, string reason);

    modifier onlyOwner() {
        require(msg.sender == owner, "Reg: not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function addKeeper(address keeper) external payable onlyOwner {
        require(!keepers[keeper].active, "Reg: already keeper");
        require(msg.value >= MIN_BOND, "Reg: bond too low");
        require(keeperList.length < MAX_KEEPERS, "Reg: max keepers");

        keepers[keeper] = Keeper({
            active: true,
            bond: msg.value,
            lastPost: 0,
            totalPosts: 0,
            totalSlashes: 0
        });
        keeperList.push(keeper);
        emit KeeperAdded(keeper, msg.value);
    }

    function removeKeeper(address keeper) external onlyOwner {
        require(keepers[keeper].active, "Reg: not active");
        keepers[keeper].active = false;
        uint256 bond = keepers[keeper].bond;
        keepers[keeper].bond = 0;
        // F-13 FIX: `.transfer()` forwards only 2300 gas, which reverts for any
        // contract keeper (multisig, smart wallet, staking contract) whose
        // receive()/fallback() does real work — permanently stranding their bond.
        // Use a low-level call and check success instead.
        (bool ok, ) = payable(keeper).call{value: bond}("");
        require(ok, "Reg: bond refund failed");
        emit KeeperRemoved(keeper);
    }

    function recordPost(address keeper) external {
        // Only callable by SomniaPriceOracle
        if (keepers[keeper].active) {
            keepers[keeper].lastPost = block.timestamp;
            keepers[keeper].totalPosts += 1;
        }
    }

    function slash(address keeper, string calldata reason) external onlyOwner {
        require(keepers[keeper].active, "Reg: not active");
        require(keepers[keeper].bond >= SLASH_AMOUNT, "Reg: bond too low");
        keepers[keeper].bond -= SLASH_AMOUNT;
        keepers[keeper].totalSlashes += 1;
        emit KeeperSlashed(keeper, SLASH_AMOUNT, reason);

        if (keepers[keeper].bond < MIN_BOND) {
            keepers[keeper].active = false;
            emit KeeperRemoved(keeper);
        }
    }

    function isActiveKeeper(address keeper) external view returns (bool) {
        return keepers[keeper].active;
    }

    function activeKeeperCount() external view returns (uint256 count) {
        for (uint256 i = 0; i < keeperList.length; i++) {
            if (keepers[keeperList[i]].active) count++;
        }
    }

    function getKeeperList() external view returns (address[] memory) {
        return keeperList;
    }
}