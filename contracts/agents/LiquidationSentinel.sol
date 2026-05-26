// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IMarginVault} from "../interfaces/IMarginVault.sol";

/// @title LiquidationSentinel — Autonomous on-chain liquidation agent
/// Monitors all open positions and fires liquidations when margin health drops below threshold.
/// Replaces MEV bots entirely — no off-chain keeper infrastructure needed.
contract LiquidationSentinel {
    IMarginVault public marginVault;
    address public owner;

    bool public paused;

    modifier onlyOwner() {
        require(msg.sender == owner, "Sentinel: not owner");
        _;
    }

    modifier notPaused() {
        require(!paused, "Sentinel: paused");
        _;
    }

    constructor(address _marginVault) {
        marginVault = IMarginVault(_marginVault);
        owner = msg.sender;
    }

    /// @notice Check all tracked positions and liquidate any that are undercollateralized
    function checkAllPositions(uint256 currentPrice) external notPaused {
        // Update all PnL first with current price
        marginVault.updateAllPnL(currentPrice);

        // Iterate tracked traders and liquidate unhealthy positions
        // NOTE: In production, MarginVault would expose trackedTraders directly.
        // Here we rely on marginHealth checks via the vault's internal tracking.
        // For the hackathon, we call the vault's liquidate which does its own check.
        _liquidateUnhealthyPositions();
    }

    /// @notice Liquidate a specific position
    function liquidatePosition(address trader) external notPaused {
        uint256 health = marginVault.marginHealth(trader);
        uint256 maintRatio = marginVault.MAINTENANCE_MARGIN_RATIO();
        require(health < maintRatio, "Sentinel: position healthy");
        marginVault.liquidate(trader);
        emit LiquidationExecuted(trader, block.timestamp);
    }

    function pause() external onlyOwner {
        paused = true;
    }

    function unpause() external onlyOwner {
        paused = false;
    }

    event LiquidationExecuted(address indexed trader, uint256 timestamp);

    // Internal: iterate and liquidate unhealthy positions
    function _liquidateUnhealthyPositions() internal {
        uint256 count = marginVault.trackedTradersCount();
        uint256 maintRatio = marginVault.MAINTENANCE_MARGIN_RATIO();

        // Iterate in reverse so we can safely skip over liquidated entries
        // (liquidation removes from the array by swapping with last element)
        for (uint256 i = count; i > 0; i--) {
            // Re-read count each iteration since liquidation modifies the array
            uint256 currentCount = marginVault.trackedTradersCount();
            if (i > currentCount) continue;

            address trader = marginVault.trackedTraderAt(i - 1);
            uint256 health = marginVault.marginHealth(trader);
            if (health < maintRatio) {
                marginVault.liquidate(trader);
                emit LiquidationExecuted(trader, block.timestamp);
            }
        }
    }
}
