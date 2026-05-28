// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {KeeperRegistry} from "./KeeperRegistry.sol";

/// @title SomniaPriceOracle — Keeper-median price oracle for Sentient Finance
/// Keepers post prices directly (~1-3s latency via tx).
/// Median across active keepers becomes the accepted price.
/// Circuit breaker halts if prices go stale or keepers disagree.
contract SomniaPriceOracle {
    KeeperRegistry public immutable registry;
    address public owner;

    uint256 public constant MIN_KEEPERS_FOR_MEDIAN = 1; // demo: 1 keeper; production: 3
    uint256 public constant KEEPER_STALENESS = 15 seconds;
    uint256 public constant CIRCUIT_BREAKER_WINDOW = 30 seconds;
    uint256 public constant MAX_KEEPER_DEVIATION_BPS = 500; // 5%

    struct PricePost {
        uint256 price;
        uint256 timestamp;
        address keeper;
    }

    mapping(bytes32 => mapping(address => PricePost)) public keeperPosts;
    mapping(bytes32 => uint256) public lastAcceptedPrice;
    mapping(bytes32 => uint256) public lastAcceptedTimestamp;

    bool public halted;

    // Keeper median events (compatible with existing reactive cascade)
    event PriceUpdated(bytes32 asset, uint256 price, uint256 timestamp);
    event OracleHalted(string reason, uint256 timestamp);
    event OracleResumed(uint256 timestamp);

    modifier onlyKeeper() {
        require(registry.isActiveKeeper(msg.sender), "Oracle: not keeper");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Oracle: not owner");
        _;
    }

    modifier notHalted() {
        require(!halted, "Oracle: halted");
        _;
    }

    constructor(address _registry) {
        registry = KeeperRegistry(_registry);
        owner = msg.sender;
    }

    /// @notice Keeper posts a price for an asset. Called directly (~1-3s latency)
    function postPrice(bytes32 asset, uint256 price) external onlyKeeper notHalted {
        require(price > 0, "Oracle: zero price");

        keeperPosts[asset][msg.sender] = PricePost({
            price: price,
            timestamp: block.timestamp,
            keeper: msg.sender
        });

        registry.recordPost(msg.sender);
        _tryCommitMedian(asset);
    }

    /// @notice Compute median from all fresh keeper posts
    function _tryCommitMedian(bytes32 asset) internal {
        address[] memory allKeepers = registry.getKeeperList();
        uint256 freshCount;
        uint256[] memory prices = new uint256[](allKeepers.length);

        for (uint256 i = 0; i < allKeepers.length; i++) {
            address k = allKeepers[i];
            if (!registry.isActiveKeeper(k)) continue;

            PricePost storage post = keeperPosts[asset][k];
            if (
                post.timestamp > 0 &&
                block.timestamp - post.timestamp <= KEEPER_STALENESS &&
                post.price > 0
            ) {
                prices[freshCount] = post.price;
                freshCount++;
            }
        }

        if (freshCount < MIN_KEEPERS_FOR_MEDIAN) return;

        // Sort
        uint256[] memory sorted = new uint256[](freshCount);
        for (uint256 i = 0; i < freshCount; i++) sorted[i] = prices[i];
        for (uint256 i = 1; i < freshCount; i++) {
            uint256 key = sorted[i];
            uint256 j = i;
            while (j > 0 && sorted[j - 1] > key) {
                sorted[j] = sorted[j - 1];
                j--;
            }
            sorted[j] = key;
        }

        // Spread check
        uint256 low = sorted[0];
        uint256 high = sorted[freshCount - 1];
        uint256 spread = (high - low) * 10000 / low;
        if (spread > MAX_KEEPER_DEVIATION_BPS) {
            _halt("Keeper spread too high");
            return;
        }

        // Median
        uint256 median;
        if (freshCount % 2 == 1) {
            median = sorted[freshCount / 2];
        } else {
            median = (sorted[freshCount / 2 - 1] + sorted[freshCount / 2]) / 2;
        }

        lastAcceptedPrice[asset] = median;
        lastAcceptedTimestamp[asset] = block.timestamp;
        emit PriceUpdated(asset, median, block.timestamp);
    }

    function _halt(string memory reason) internal {
        halted = true;
        emit OracleHalted(reason, block.timestamp);
    }

    function resumeOracle() external onlyOwner {
        require(halted, "Oracle: not halted");
        halted = false;
        emit OracleResumed(block.timestamp);
    }

    /// @notice Primary price read for DEX. Reverts if halted or stale.
    function getPrice(bytes32 asset)
        external
        view
        notHalted
        returns (uint256 price, uint256 timestamp)
    {
        price = lastAcceptedPrice[asset];
        timestamp = lastAcceptedTimestamp[asset];
        require(price > 0, "Oracle: no price");
        require(
            block.timestamp - timestamp <= CIRCUIT_BREAKER_WINDOW,
            "Oracle: price stale"
        );
    }

    function isHealthy(bytes32 asset) external view returns (bool) {
        if (halted) return false;
        uint256 ts = lastAcceptedTimestamp[asset];
        return ts > 0 && block.timestamp - ts <= CIRCUIT_BREAKER_WINDOW;
    }
}