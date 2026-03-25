// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {TipJar} from "../src/TipJar.sol";
import {CreatorRegistry} from "../src/CreatorRegistry.sol";

/// @dev Minimal ERC-20 mock with 6 decimals (same as USDC)
contract MockUSDC {
    string public name = "Mock USDC";
    string public symbol = "USDC";
    uint8 public decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "not approved");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract TipJarTest is Test {
    TipJar public tipJar;
    CreatorRegistry public registry;
    MockUSDC public usdc;

    address deployer = makeAddr("deployer");
    address alice = makeAddr("alice");  // creator
    address bob = makeAddr("bob");      // tipper

    uint256 constant ONE_USDC = 1e6;
    uint256 constant FEE_BPS = 100; // 1%

    function setUp() public {
        vm.startPrank(deployer);
        usdc = new MockUSDC();
        registry = new CreatorRegistry();
        tipJar = new TipJar(address(usdc), address(registry), FEE_BPS);
        vm.stopPrank();

        // Register alice as creator
        vm.prank(alice);
        registry.register("@alice", "https://twitter.com/alice");

        // Fund bob with 100 USDC and approve TipJar
        usdc.mint(bob, 100 * ONE_USDC);
        vm.prank(bob);
        usdc.approve(address(tipJar), type(uint256).max);
    }

    function test_InitialState() public view {
        assertEq(tipJar.feeBps(), FEE_BPS);
        assertEq(tipJar.owner(), deployer);
        assertEq(tipJar.collectedFees(), 0);
        assertEq(address(tipJar.usdc()), address(usdc));
        assertEq(address(tipJar.registry()), address(registry));
    }

    function test_Tip() public {
        uint256 tipAmount = 10 * ONE_USDC;
        uint256 expectedFee = tipAmount * FEE_BPS / 10_000; // 0.1 USDC
        uint256 expectedNet = tipAmount - expectedFee;

        vm.prank(bob);
        tipJar.tip(alice, tipAmount, "Love your content!");

        assertEq(usdc.balanceOf(alice), expectedNet);
        assertEq(tipJar.collectedFees(), expectedFee);
        assertEq(tipJar.totalTipsReceived(alice), expectedNet);
        assertEq(tipJar.totalTipsSent(bob), tipAmount);
    }

    function test_TipEmitsEvent() public {
        uint256 tipAmount = 5 * ONE_USDC;
        uint256 fee = tipAmount * FEE_BPS / 10_000;
        uint256 net = tipAmount - fee;

        vm.expectEmit(true, true, false, true);
        emit TipJar.TipSent(bob, alice, net, fee, "gm!");

        vm.prank(bob);
        tipJar.tip(alice, tipAmount, "gm!");
    }

    function test_TipTooSmall() public {
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(TipJar.TipTooSmall.selector, tipJar.MIN_TIP(), 1000)
        );
        tipJar.tip(alice, 1000, "");
    }

    function test_TipUnregisteredCreator() public {
        address unregistered = makeAddr("nobody");
        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(TipJar.CreatorNotRegistered.selector, unregistered)
        );
        tipJar.tip(unregistered, ONE_USDC, "");
    }

    function test_PreviewTip() public view {
        (uint256 creatorAmount, uint256 fee) = tipJar.previewTip(10 * ONE_USDC);
        assertEq(fee, 1e5); // 0.1 USDC = 1%
        assertEq(creatorAmount, 10 * ONE_USDC - 1e5);
    }

    function test_SetFeeBps() public {
        vm.prank(deployer);
        tipJar.setFeeBps(200);
        assertEq(tipJar.feeBps(), 200);
    }

    function test_SetFeeBpsTooHigh() public {
        vm.prank(deployer);
        vm.expectRevert(abi.encodeWithSelector(TipJar.FeeTooHigh.selector, 1000, 1001));
        tipJar.setFeeBps(1001);
    }

    function test_OnlyOwnerCanSetFee() public {
        vm.prank(alice);
        vm.expectRevert(TipJar.OnlyOwner.selector);
        tipJar.setFeeBps(50);
    }

    function test_WithdrawFees() public {
        // Generate some fees
        vm.prank(bob);
        tipJar.tip(alice, 10 * ONE_USDC, "");

        uint256 fees = tipJar.collectedFees();
        assertTrue(fees > 0);

        uint256 beforeBalance = usdc.balanceOf(deployer);
        vm.prank(deployer);
        tipJar.withdrawFees(deployer);

        assertEq(usdc.balanceOf(deployer), beforeBalance + fees);
        assertEq(tipJar.collectedFees(), 0);
    }

    function test_TransferOwnership() public {
        vm.prank(deployer);
        tipJar.transferOwnership(alice);
        assertEq(tipJar.owner(), alice);
    }

    function test_ConstructorRejectsZeroAddress() public {
        vm.expectRevert(TipJar.ZeroAddress.selector);
        new TipJar(address(0), address(registry), 0);
    }

    function test_ZeroFee() public {
        vm.prank(deployer);
        tipJar.setFeeBps(0);

        vm.prank(bob);
        tipJar.tip(alice, ONE_USDC, "zero fee tip");

        assertEq(usdc.balanceOf(alice), ONE_USDC);
        assertEq(tipJar.collectedFees(), 0);
    }
}
