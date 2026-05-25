// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IOrderBook} from "./IOrderBook.sol";
import {IMarginVault} from "./IMarginVault.sol";

interface IAgent {
    function onPriceUpdate(uint256 newPrice) external;
    function onOrderMatch(uint256 bidOrderId, uint256 askOrderId) external;
}
