// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title GreedyReceiver — audit test helper (finding F-13)
/// @dev A contract wallet whose receive() burns far more than the 2300-gas
///      stipend forwarded by `.transfer()` / `.send()`. Used to prove that
///      KeeperRegistry.removeKeeper's bond refund bricks for contract keepers
///      (multisigs, smart wallets, staking contracts). Not part of the protocol.
contract GreedyReceiver {
    uint256 public sink;

    receive() external payable {
        // A single cold SSTORE costs ~20k gas — well over the 2300 stipend.
        sink = sink + 1;
    }
}
