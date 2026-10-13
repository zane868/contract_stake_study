// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {MetaNodeStake} from "../src/MetaNodeStake.sol";

contract UpgradeSepoliaAndAddPools is Script {
    address internal constant PROXY = 0xe22E65cc67457678B361476158f7865e949BBcd5;
    address internal constant REWARD_TOKEN = 0x8a4A3323177F5Ec09f619A7160e56b0CA9999595;
    address internal constant LINK = 0x779877A7B0D9E8603169DdbD7836e478b4624789;
    address internal constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    function run() external {
        require(block.chainid == 11155111, "Sepolia only");

        MetaNodeStake stake = MetaNodeStake(payable(PROXY));
        require(stake.poolLength() == 1, "expected one existing ETH pool");
        require(address(stake.MetaNode()) == REWARD_TOKEN, "unexpected reward token");
        require(IERC20Metadata(LINK).decimals() == 18, "unexpected LINK decimals");
        require(IERC20Metadata(USDC).decimals() == 6, "unexpected USDC decimals");
        require(keccak256(bytes(IERC20Metadata(LINK).symbol())) == keccak256("LINK"), "unexpected LINK symbol");
        require(keccak256(bytes(IERC20Metadata(USDC).symbol())) == keccak256("USDC"), "unexpected USDC symbol");

        vm.startBroadcast();
        MetaNodeStake implementation = new MetaNodeStake();
        stake.upgradeToAndCall(address(implementation), "");

        // Settle existing rewards before changing totalPoolWeight.
        stake.addPool(LINK, 1, 1 ether, 25, true);
        stake.addPool(USDC, 1, 1e6, 25, true);
        vm.stopBroadcast();

        require(stake.poolLength() == 3, "pool creation failed");
        require(stake.totalPoolWeight() == 3, "unexpected total weight");
        console2.log("MetaNodeStake proxy:", PROXY);
        console2.log("New implementation:", address(implementation));
        console2.log("LINK pool id: 1");
        console2.log("USDC pool id: 2");
    }
}
