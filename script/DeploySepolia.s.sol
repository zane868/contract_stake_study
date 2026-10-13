// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {MetaNodeToken} from "../src/MetaNode.sol";
import {MetaNodeStake} from "../src/MetaNodeStake.sol";

contract DeploySepolia is Script {
    uint256 internal constant REWARD_PER_BLOCK = 10 ether;
    uint256 internal constant REWARD_BLOCKS = 100_000;
    uint256 internal constant REWARD_FUNDING = 1_000_000 ether;

    function run() external {
        require(block.chainid == 11155111, "Sepolia only");

        uint256 minDeposit = vm.envOr("MIN_ETH_DEPOSIT_WEI", uint256(0.01 ether));
        uint256 lockBlocks = vm.envOr("UNSTAKE_LOCK_BLOCKS", uint256(25));
        require(lockBlocks > 0, "lock blocks must be positive");

        vm.startBroadcast();

        MetaNodeToken token = new MetaNodeToken();
        MetaNodeStake implementation = new MetaNodeStake();
        uint256 startBlock = block.number;
        uint256 endBlock = startBlock + REWARD_BLOCKS;
        bytes memory initData = abi.encodeCall(
            MetaNodeStake.initialize,
            (IERC20(address(token)), startBlock, endBlock, REWARD_PER_BLOCK)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(implementation), initData);
        MetaNodeStake stake = MetaNodeStake(address(proxy));

        stake.addPool(address(0), 1, minDeposit, lockBlocks, false);
        require(token.transfer(address(stake), REWARD_FUNDING), "funding transfer failed");
        require(token.balanceOf(address(stake)) == REWARD_FUNDING, "wrong reward funding");

        vm.stopBroadcast();

        console2.log("MetaNodeToken:", address(token));
        console2.log("MetaNodeStake implementation:", address(implementation));
        console2.log("MetaNodeStake proxy:", address(stake));
        console2.log("Reward start block:", startBlock);
        console2.log("Reward end block:", endBlock);
    }
}
