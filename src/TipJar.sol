// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {IERC20} from "./interfaces/IERC20.sol";
import {CreatorRegistry} from "./CreatorRegistry.sol";

/// @title TipJar
/// @notice Send USDC tips to registered creators on Arc Testnet
/// @dev Gas on Arc is paid in USDC, so no ETH handling is needed
contract TipJar {
    IERC20 public immutable usdc;
    CreatorRegistry public immutable registry;

    /// @notice Platform fee in basis points (e.g. 100 = 1%)
    uint256 public feeBps;
    address public owner;
    uint256 public collectedFees;

    // creator address -> total USDC tips received (in 6-decimal units)
    mapping(address => uint256) public totalTipsReceived;

    // tipper address -> total USDC tips sent
    mapping(address => uint256) public totalTipsSent;

    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MIN_TIP = 1e5; // 0.1 USDC (6 decimals)

    event TipSent(
        address indexed tipper,
        address indexed creator,
        uint256 amount,
        uint256 fee,
        string message
    );
    event FeeUpdated(uint256 oldFeeBps, uint256 newFeeBps);
    event FeesWithdrawn(address indexed to, uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error OnlyOwner();
    error TipTooSmall(uint256 min, uint256 got);
    error CreatorNotRegistered(address creator);
    error TransferFailed();
    error FeeTooHigh(uint256 max, uint256 got);
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(address _usdc, address _registry, uint256 _feeBps) {
        if (_usdc == address(0) || _registry == address(0)) revert ZeroAddress();
        if (_feeBps > 1000) revert FeeTooHigh(1000, _feeBps); // max 10%

        usdc = IERC20(_usdc);
        registry = CreatorRegistry(_registry);
        feeBps = _feeBps;
        owner = msg.sender;
    }

    // ── Core tip logic ────────────────────────────────────────────────────────

    /// @notice Send a USDC tip to a creator
    /// @param creator  Recipient creator address (must be registered)
    /// @param amount   Tip amount in USDC (6 decimals). Must be >= MIN_TIP
    /// @param message  Optional message attached to the tip (can be empty)
    function tip(address creator, uint256 amount, string calldata message) external {
        if (amount < MIN_TIP) revert TipTooSmall(MIN_TIP, amount);
        if (!registry.isRegistered(creator)) revert CreatorNotRegistered(creator);

        uint256 fee = (amount * feeBps) / BPS_DENOMINATOR;
        uint256 creatorAmount = amount - fee;

        // Pull full amount from sender
        bool ok = usdc.transferFrom(msg.sender, address(this), amount);
        if (!ok) revert TransferFailed();

        // Push net amount to creator
        ok = usdc.transfer(creator, creatorAmount);
        if (!ok) revert TransferFailed();

        collectedFees += fee;
        totalTipsReceived[creator] += creatorAmount;
        totalTipsSent[msg.sender] += amount;

        emit TipSent(msg.sender, creator, creatorAmount, fee, message);
    }

    // ── Admin functions ───────────────────────────────────────────────────────

    /// @notice Update the platform fee (max 10%)
    function setFeeBps(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > 1000) revert FeeTooHigh(1000, newFeeBps);
        emit FeeUpdated(feeBps, newFeeBps);
        feeBps = newFeeBps;
    }

    /// @notice Withdraw accumulated platform fees
    function withdrawFees(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = collectedFees;
        collectedFees = 0;
        bool ok = usdc.transfer(to, amount);
        if (!ok) revert TransferFailed();
        emit FeesWithdrawn(to, amount);
    }

    /// @notice Transfer contract ownership
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ── View functions ────────────────────────────────────────────────────────

    /// @notice Calculate fee and net amount for a given tip
    function previewTip(uint256 amount)
        external
        view
        returns (uint256 creatorAmount, uint256 fee)
    {
        fee = (amount * feeBps) / BPS_DENOMINATOR;
        creatorAmount = amount - fee;
    }
}
