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

    // F-06 FIX: mint is gated to the owner. This token is wired as the live
    // collateral asset (deployed-addresses.json → mockUSDC); an open mint let
    // anyone inflate their collateral balance and drain the vault. Test/demo
    // faucets must mint through the deployer key.
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
