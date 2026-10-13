// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MetaNodeStake} from "../src/MetaNodeStake.sol";

contract MockToken is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract FalseTransferReward is MockToken {
    constructor() MockToken("False Reward", "FALSE") {}

    function transfer(address, uint256) public pure override returns (bool) {
        return false;
    }
}

interface IRewardHook {
    function onRewardReceived() external;
}

contract HookedReward is MockToken {
    constructor() MockToken("Hooked Reward", "HOOK") {}

    function transfer(address to, uint256 amount) public override returns (bool) {
        bool success = super.transfer(to, amount);
        if (to.code.length > 0) {
            IRewardHook(to).onRewardReceived();
        }
        return success;
    }
}

contract ReentrantClaimer is IRewardHook {
    MetaNodeStake public immutable stake;
    bool private entered;

    constructor(MetaNodeStake stake_) {
        stake = stake_;
    }

    function depositETH() external payable {
        stake.depositETH{value: msg.value}();
    }

    function claim() external {
        stake.claim(0);
    }

    function onRewardReceived() external {
        require(msg.sender == address(stake.MetaNode()), "only reward token");
        if (!entered) {
            entered = true;
            stake.claim(0);
        }
    }
}

contract MetaNodeStakeTest is Test {
    MetaNodeStake internal stake;
    MockToken internal reward;
    address internal alice = makeAddr("alice");

    function setUp() public {
        vm.roll(100);
        reward = new MockToken("MetaNode", "META");
        stake = new MetaNodeStake();
        stake.initialize(IERC20(address(reward)), block.number, block.number + 1_000, 10 ether);
        stake.addPool(address(0), 1, 1 ether, 5, false);
        reward.mint(address(stake), 1_000 ether);
        vm.deal(alice, 2 ether);
    }

    function test_ETHStakeClaimAndWithdrawAfterLock() public {
        vm.prank(alice);
        stake.depositETH{value: 1 ether}();

        vm.roll(110);
        assertEq(stake.pendingMetaNode(0, alice), 100 ether);
        vm.prank(alice);
        stake.claim(0);
        assertEq(reward.balanceOf(alice), 100 ether);
        assertEq(stake.pendingMetaNode(0, alice), 0);

        vm.prank(alice);
        stake.unstake(0, 1 ether);
        vm.roll(114);
        (, uint256 pendingBeforeUnlock) = stake.withdrawAmount(0, alice);
        assertEq(pendingBeforeUnlock, 0);

        vm.roll(115);
        vm.prank(alice);
        stake.withdraw(0);
        assertEq(alice.balance, 2 ether);
        (uint256 requested, uint256 pendingAfterWithdraw) = stake.withdrawAmount(0, alice);
        assertEq(requested, 0);
        assertEq(pendingAfterWithdraw, 0);
    }

    function test_ERC20StakeClaimAndWithdraw() public {
        MockToken stakingToken = new MockToken("Stake", "ST");
        stake.addPool(address(stakingToken), 1, 0, 5, false);
        stakingToken.mint(alice, 100 ether);

        vm.startPrank(alice);
        stakingToken.approve(address(stake), 100 ether);
        stake.deposit(1, 100 ether);
        vm.stopPrank();

        vm.roll(110);
        vm.prank(alice);
        stake.claim(1);
        assertEq(reward.balanceOf(alice), 50 ether);

        vm.prank(alice);
        stake.unstake(1, 100 ether);
        vm.roll(115);
        vm.prank(alice);
        stake.withdraw(1);
        assertEq(stakingToken.balanceOf(alice), 100 ether);
        assertEq(stake.stakingBalance(1, alice), 0);
    }

    function test_RevertIfRewardTokenReturnsFalse() public {
        FalseTransferReward falseReward = new FalseTransferReward();
        falseReward.mint(address(stake), 1_000 ether);
        stake.setMetaNode(IERC20(address(falseReward)));

        vm.prank(alice);
        stake.depositETH{value: 1 ether}();
        vm.roll(110);

        vm.startPrank(alice);
        vm.expectRevert();
        stake.claim(0);
        vm.stopPrank();
    }

    function test_RevertIfRewardBalanceIsInsufficient() public {
        MockToken shortReward = new MockToken("Short Reward", "SHORT");
        shortReward.mint(address(stake), 10 ether);
        stake.setMetaNode(IERC20(address(shortReward)));

        vm.prank(alice);
        stake.depositETH{value: 1 ether}();
        vm.roll(110);

        vm.startPrank(alice);
        vm.expectRevert();
        stake.claim(0);
        vm.stopPrank();
    }

    function test_ReentrantRewardCallbackCannotClaimTwice() public {
        HookedReward hookedReward = new HookedReward();
        hookedReward.mint(address(stake), 1_000 ether);
        stake.setMetaNode(IERC20(address(hookedReward)));
        ReentrantClaimer claimer = new ReentrantClaimer(stake);
        vm.deal(address(this), 1 ether);
        claimer.depositETH{value: 1 ether}();

        vm.roll(110);
        claimer.claim();
        assertEq(hookedReward.balanceOf(address(claimer)), 100 ether);
    }

    function test_PoolRoundingDoesNotDiscardAccumulatedReward() public {
        MockToken stakingToken = new MockToken("Stake", "ST");
        stake.addPool(address(stakingToken), 1, 0, 5, false);
        stake.setMetaNodePerBlock(1);

        vm.prank(alice);
        stake.depositETH{value: 1 ether}();
        vm.roll(101);
        stake.updatePool(0);
        vm.roll(102);
        assertEq(stake.pendingMetaNode(0, alice), 1);
        stake.updatePool(0);

        // Two blocks at one wei per block and 50% pool weight earn one wei.
        assertEq(stake.pendingMetaNode(0, alice), 1);
    }

    function test_ThirdsAccumulateIntoOneRewardUnit() public {
        MockToken tokenA = new MockToken("Stake A", "STA");
        MockToken tokenB = new MockToken("Stake B", "STB");
        stake.addPool(address(tokenA), 1, 0, 5, false);
        stake.addPool(address(tokenB), 1, 0, 5, false);
        stake.setMetaNodePerBlock(1);

        vm.prank(alice);
        stake.depositETH{value: 1 ether}();
        for (uint256 blockNumber = 101; blockNumber <= 103; blockNumber++) {
            vm.roll(blockNumber);
            stake.updatePool(0);
        }

        assertEq(stake.pendingMetaNode(0, alice), 1);
    }

    function test_PerStakeRoundingAccumulatesAcrossPoolUpdates() public {
        stake.setMetaNodePerBlock(1);

        vm.prank(alice);
        stake.depositETH{value: 2 ether}();
        vm.roll(101);
        stake.updatePool(0);
        vm.roll(102);

        assertEq(stake.pendingMetaNode(0, alice), 2);
        stake.updatePool(0);
        assertEq(stake.pendingMetaNode(0, alice), 2);
    }

    function test_ERC20DepositAcceptsExactMinimum() public {
        MockToken stakingToken = new MockToken("Stake", "ST");
        stake.addPool(address(stakingToken), 1, 1 ether, 5, false);
        stakingToken.mint(alice, 1 ether);

        vm.startPrank(alice);
        stakingToken.approve(address(stake), 1 ether);
        stake.deposit(1, 1 ether);
        vm.stopPrank();

        assertEq(stake.stakingBalance(1, alice), 1 ether);
    }

    function test_WithdrawSkipsEarlierLockedRequest() public {
        stake.updatePool(0, 1 ether, 50);
        vm.startPrank(alice);
        stake.depositETH{value: 2 ether}();
        stake.unstake(0, 1 ether);
        vm.stopPrank();

        stake.updatePool(0, 1 ether, 1);
        vm.roll(101);
        vm.prank(alice);
        stake.unstake(0, 1 ether);

        vm.roll(102);
        (uint256 requested, uint256 unlocked) = stake.withdrawAmount(0, alice);
        assertEq(requested, 2 ether);
        assertEq(unlocked, 1 ether);
        vm.prank(alice);
        stake.withdraw(0);
        assertEq(alice.balance, 1 ether);
        (requested, unlocked) = stake.withdrawAmount(0, alice);
        assertEq(requested, 1 ether);
        assertEq(unlocked, 0);

        vm.roll(150);
        vm.prank(alice);
        stake.withdraw(0);
        assertEq(alice.balance, 2 ether);
    }

    function test_PoolCanUpdateAfterRewardEnd() public {
        vm.prank(alice);
        stake.depositETH{value: 1 ether}();

        vm.roll(1101);
        stake.updatePool(0);
        vm.roll(1102);
        assertEq(stake.pendingMetaNode(0, alice), 10_000 ether);
        stake.updatePool(0);
    }
}
