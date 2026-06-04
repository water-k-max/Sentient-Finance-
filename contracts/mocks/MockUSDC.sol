// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockUSDC is ERC20, Ownable {
    constructor() ERC20("Mock USDC", "USDC") Ownable(msg.sender) {
        // Mint 10 million USDC to deployer for seeding
        _mint(msg.sender, 10_000_000 * 10 ** decimals());
    }

    // 6 decimals like real USDC
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    // Anyone can mint on testnet — for faucet/demo purposes
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
