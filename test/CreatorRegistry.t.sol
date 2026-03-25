// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {CreatorRegistry} from "../src/CreatorRegistry.sol";

contract CreatorRegistryTest is Test {
    CreatorRegistry public registry;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        registry = new CreatorRegistry();
    }

    function test_Register() public {
        vm.prank(alice);
        registry.register("@alice", "https://twitter.com/alice");

        CreatorRegistry.Creator memory c = registry.getCreator(alice);
        assertEq(c.handle, "@alice");
        assertEq(c.url, "https://twitter.com/alice");
        assertTrue(c.registered);
    }

    function test_RegisterEmitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit CreatorRegistry.CreatorRegistered(alice, "@alice", "https://twitter.com/alice");

        vm.prank(alice);
        registry.register("@alice", "https://twitter.com/alice");
    }

    function test_IsRegistered() public {
        assertFalse(registry.isRegistered(alice));

        vm.prank(alice);
        registry.register("@alice", "https://twitter.com/alice");

        assertTrue(registry.isRegistered(alice));
    }

    function test_GetAddressByHandle() public {
        vm.prank(alice);
        registry.register("@alice", "https://twitter.com/alice");

        assertEq(registry.getAddressByHandle("@alice"), alice);
        assertEq(registry.getAddressByHandle("@ALICE"), alice); // case-insensitive
    }

    function test_HandleTakenByAnotherUser() public {
        vm.prank(alice);
        registry.register("@alice", "https://twitter.com/alice");

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(CreatorRegistry.HandleTaken.selector, "@alice"));
        registry.register("@alice", "https://twitter.com/bob");
    }

    function test_UpdateOwnProfile() public {
        vm.prank(alice);
        registry.register("@alice", "https://twitter.com/alice");

        vm.prank(alice);
        registry.register("@alice_v2", "https://youtube.com/alice");

        CreatorRegistry.Creator memory c = registry.getCreator(alice);
        assertEq(c.handle, "@alice_v2");

        // Old handle should be freed
        assertEq(registry.getAddressByHandle("@alice"), address(0));
        assertEq(registry.getAddressByHandle("@alice_v2"), alice);
    }

    function test_Unregister() public {
        vm.prank(alice);
        registry.register("@alice", "https://twitter.com/alice");

        vm.prank(alice);
        registry.unregister();

        assertFalse(registry.isRegistered(alice));
        assertEq(registry.getAddressByHandle("@alice"), address(0));
    }

    function test_UnregisterNotRegistered() public {
        vm.prank(alice);
        vm.expectRevert(CreatorRegistry.NotRegistered.selector);
        registry.unregister();
    }

    function test_EmptyHandleReverts() public {
        vm.prank(alice);
        vm.expectRevert(CreatorRegistry.EmptyHandle.selector);
        registry.register("", "https://twitter.com/alice");
    }

    function test_EmptyUrlReverts() public {
        vm.prank(alice);
        vm.expectRevert(CreatorRegistry.EmptyUrl.selector);
        registry.register("@alice", "");
    }
}
