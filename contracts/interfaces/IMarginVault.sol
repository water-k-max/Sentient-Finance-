// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

struct Position {
    address trader;
    bool isLong;
    uint256 entryPrice;
    uint256 size;
    uint256 margin;
    uint256 leverage;
    int256 unrealizedPnl;
    uint256 liquidationPrice;
    bool isOpen;
}

interface IMarginVault {
    function MAINTENANCE_MARGIN_RATIO() external view returns (uint256);
    function deposit(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function lockMargin(address trader, uint256 amount) external;
    function releaseMargin(address trader, uint256 amount) external;
    function settlePosition(address longTrader, address shortTrader, uint256 fillPrice, uint256 fillSize, uint256 longLeverage, uint256 shortLeverage) external;
    function updatePnL(address trader, uint256 currentIndexPrice) external;
    function updatePnLBatch(address[] calldata traders, uint256 currentIndexPrice) external;
    function updateAllPnL(uint256 currentIndexPrice) external;
    function liquidate(address trader) external;
    function computeLiquidationPrice(bool isLong, uint256 entryPrice, uint256 leverage) external pure returns (uint256);
    function marginHealth(address trader) external view returns (uint256);
    function getPosition(address trader) external view returns (Position memory);
    function getCollateralBalance(address trader) external view returns (uint256);
    function getTrackedTraders() external view returns (address[] memory);
    function trackedTradersCount() external view returns (uint256);
    function trackedTraderAt(uint256 index) external view returns (address);
    function isTracked(address trader) external view returns (bool);
    function setAuthorized(address _addr, bool authorized) external;
    function isAuthorized(address _addr) external view returns (bool);

    event Deposit(address indexed trader, uint256 amount);
    event Withdrawal(address indexed trader, uint256 amount);
    event PositionSettled(address indexed longTrader, address indexed shortTrader, uint256 fillPrice, uint256 fillSize);
    event PnLUpdated(address indexed trader, int256 unrealizedPnl, uint256 marginHealth);
    event LiquidationExecuted(address indexed trader, uint256 liquidationPrice, uint256 remainingMargin);
}
