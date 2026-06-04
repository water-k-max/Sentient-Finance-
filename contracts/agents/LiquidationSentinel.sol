// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IMarginVault} from "../interfaces/IMarginVault.sol";

/// @title LiquidationSentinel — Autonomous on-chain liquidation agent
/// Monitors all open positions and fires liquidations when margin health drops
/// below the maintenance threshold. Replaces MEV bots entirely — no off-chain
/// keeper infrastructure needed.
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

    event LiquidationExecuted(address indexed trader, uint256 timestamp);
    event LiquidationFailed(address indexed trader, bytes reason);

    constructor(address _marginVault) {
        marginVault = IMarginVault(_marginVault);
        owner = msg.sender;
    }

    // ── External ──────────────────────────────────────────────────────────────

    /// @notice Update all PnL then liquidate any undercollateralised positions.
    ///         Called reactively by AgentInterface on every PriceUpdated event.
    ///         Price comes from the event data — never from an async oracle fetch.
    function checkAllPositions(uint256 currentPrice) external notPaused {
        marginVault.updateAllPnL(currentPrice);
        _liquidateUnhealthyPositions();
    }

    /// @notice Liquidate a single specific position (callable by anyone).
    ///         Useful for manual intervention or targeted liquidation bots.
    function liquidatePosition(address trader) external notPaused {
        uint256 health    = marginVault.marginHealth(trader);
        uint256 maintRatio = marginVault.MAINTENANCE_MARGIN_RATIO();
        require(health < maintRatio, "Sentinel: position healthy");
        marginVault.liquidate(trader);
        emit LiquidationExecuted(trader, block.timestamp);
    }

    /// @notice Paginated liquidation check — call with (0,100), (100,200) etc.
    ///         Prevents block gas limit issues as trader count grows.
    function checkPositionsBatch(
        uint256 currentPrice,
        uint256 fromIndex,
        uint256 toIndex
    ) external notPaused {
        marginVault.updatePnLBatch(
            _sliceTraders(fromIndex, toIndex),
            currentPrice
        );
        _liquidateUnhealthyBatch(fromIndex, toIndex);
    }

    function pause()   external onlyOwner { paused = true; }
    function unpause() external onlyOwner { paused = false; }

    // ── Internal ──────────────────────────────────────────────────────────────

    /// @dev Snapshot the full trader list once, iterate in memory.
    ///      Each liquidate() call is wrapped in try/catch so one reverting
    ///      position can never block the rest of the loop.
    function _liquidateUnhealthyPositions() internal {
        uint256 maintRatio = marginVault.MAINTENANCE_MARGIN_RATIO();

        // Single SLOAD for the full list — cheaper than repeated length checks
        address[] memory traders = marginVault.getTrackedTraders();
        uint256 count = traders.length;

        for (uint256 i = 0; i < count; i++) {
            address trader = traders[i];

            // Skip if already removed from tracking (liquidated earlier in loop)
            if (!marginVault.isTracked(trader)) continue;

            uint256 health = marginVault.marginHealth(trader);
            if (health < maintRatio) {
                // Isolate each liquidation — a bad position state must not
                // revert the entire cascade and block other liquidations.
                try marginVault.liquidate(trader) {
                    emit LiquidationExecuted(trader, block.timestamp);
                } catch (bytes memory reason) {
                    emit LiquidationFailed(trader, reason);
                }
            }
        }
    }

    /// @dev Paginated version — operates on a slice of the tracked list.
    function _liquidateUnhealthyBatch(uint256 fromIndex, uint256 toIndex) internal {
        uint256 maintRatio = marginVault.MAINTENANCE_MARGIN_RATIO();
        uint256 total      = marginVault.trackedTradersCount();

        if (fromIndex >= total) return;
        uint256 end = toIndex > total ? total : toIndex;

        for (uint256 i = fromIndex; i < end; i++) {
            address trader = marginVault.trackedTraderAt(i);
            if (!marginVault.isTracked(trader)) continue;

            uint256 health = marginVault.marginHealth(trader);
            if (health < maintRatio) {
                try marginVault.liquidate(trader) {
                    emit LiquidationExecuted(trader, block.timestamp);
                } catch (bytes memory reason) {
                    emit LiquidationFailed(trader, reason);
                }
            }
        }
    }

    /// @dev Build a memory array of traders[fromIndex..toIndex] for batch PnL update.
    function _sliceTraders(
        uint256 fromIndex,
        uint256 toIndex
    ) internal view returns (address[] memory slice) {
        uint256 total = marginVault.trackedTradersCount();
        if (fromIndex >= total) return new address[](0);
        uint256 end  = toIndex > total ? total : toIndex;
        uint256 size = end - fromIndex;
        slice = new address[](size);
        for (uint256 i = 0; i < size; i++) {
            slice[i] = marginVault.trackedTraderAt(fromIndex + i);
        }
    }
}
