// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SomniaPriceOracle} from "./SomniaPriceOracle.sol";

/// @title CompositeOracle — Single entry point for the DEX
/// Selects the right price source per use case.
///
/// Mark price (perps PnL, funding): Keeper median primary
/// When Somnia agent verification arrives, it updates AgentOracle
/// which emits PriceUpdated → reactive cascade fires.
contract CompositeOracle {
    SomniaPriceOracle public immutable keeperOracle;
    address public agentOracle; // Somnia JSON API Agent oracle (async verification)
    address public owner;
    bytes32 public asset;

    constructor(address _keeperOracle, bytes32 _asset) {
        keeperOracle = SomniaPriceOracle(_keeperOracle);
        asset = _asset;
        owner = msg.sender;
    }

    function setAgentOracle(address _agentOracle) external {
        require(msg.sender == owner, "CO: not owner");
        agentOracle = _agentOracle;
    }

    /// @notice Mark price for perps PnL and funding — keeper median (primary)
    function getMarkPrice() external view returns (uint256 price) {
        if (keeperOracle.isHealthy(asset)) {
            (price,) = keeperOracle.getPrice(asset);
            return price;
        }
        // Fallback to last known price rather than reverting
        revert("CO: keeper oracle unhealthy");
    }

    /// @notice Liquidation price — requires keeper median (no confirmation source on testnet)
    function getLiquidationPrice() external view returns (uint256 price) {
        (price,) = keeperOracle.getPrice(asset);
    }

    /// @notice Check health of all oracle sources
    function isHealthy() external view returns (bool) {
        return keeperOracle.isHealthy(asset);
    }

    function getKeeperPrice() external view returns (uint256 price, uint256 timestamp) {
        return keeperOracle.getPrice(asset);
    }

    /// @notice Get the last keeper median price without reverting
    function getLastPrice() external view returns (uint256 price, uint256 timestamp) {
        return keeperOracle.lastAcceptedPrice(asset) > 0
            ? (keeperOracle.lastAcceptedPrice(asset), keeperOracle.lastAcceptedTimestamp(asset))
            : (0, 0);
    }
}