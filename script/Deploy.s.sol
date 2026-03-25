// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {CreatorRegistry} from "../src/CreatorRegistry.sol";
import {TipJar} from "../src/TipJar.sol";

contract DeployArcTip is Script {
    // Arc Testnet USDC
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    // Platform fee: 1% (100 bps)
    uint256 constant FEE_BPS = 100;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Deployer:   ", deployer);
        console.log("USDC:       ", ARC_USDC);
        console.log("Fee (bps):  ", FEE_BPS);
        console.log("Chain ID:   ", block.chainid);

        vm.startBroadcast(deployerKey);

        // 1. Deploy CreatorRegistry
        CreatorRegistry registry = new CreatorRegistry();
        console.log("CreatorRegistry:", address(registry));

        // 2. Deploy TipJar
        TipJar tipJar = new TipJar(ARC_USDC, address(registry), FEE_BPS);
        console.log("TipJar:         ", address(tipJar));

        vm.stopBroadcast();

        console.log("\n--- Copy to .env ---");
        console.log("CREATOR_REGISTRY_ADDRESS=%s", address(registry));
        console.log("TIP_JAR_ADDRESS=%s", address(tipJar));
    }
}
