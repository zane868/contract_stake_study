# MetaNodeStake

Foundry project for an upgradeable staking contract and a browser wallet page for Sepolia.

## 项目来源

本项目从 MetaNodeAcademy 的 `Advanced2-contract-stake/stake-contract` 迁移至 Foundry，并在此基础上进行合约修复、单元测试补充及质押页面优化。

- 原项目仓库：[MetaNodeAcademy/Advanced2-contract-stake（stake-contract）](https://github.com/MetaNodeAcademy/Advanced2-contract-stake/tree/main/stake-contract)
- 原项目体验地址：[MetaNode Stake](https://meta-node-stake-fe.vercel.app)

## Local checks

```sh
forge build
forge test
node --check web/stake.js
node --check web/keccak.js
```

Open `web/index.html` in a browser with an injected wallet to use the Sepolia page. The page reads on-chain state directly and has no npm dependency.

## Sepolia deployment

| Contract | Address |
| --- | --- |
| MetaNodeStake proxy | `0xe22E65cc67457678B361476158f7865e949BBcd5` |
| Current implementation | `0x9C6651C9559139ea31135F70351Bbd1CecAE3323` |
| MetaNode reward token | `0x8a4A3323177F5Ec09f619A7160e56b0CA9999595` |
| LINK pool #1 token | `0x779877A7B0D9E8603169DdbD7836e478b4624789` |
| USDC pool #2 token | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |

Pool #0 accepts ETH. All three pools have weight 1 and a 25 block unstake lock. Minimum deposits are 0.01 ETH, 1 LINK, and 1 USDC respectively. The reward rate is 10 MetaNode per block during the configured reward period.

`script/DeploySepolia.s.sol` is the original deployment script. `script/UpgradeSepoliaAndAddPools.s.sol` records the completed upgrade and pool creation; its preconditions mean it is not intended to run again against the current proxy.

Set `SEPOLIA_RPC_URL` and `SEPOLIA_PRIVATE_KEY` locally when running Foundry scripts. Never commit secret values. Local broadcast output and coverage files are ignored by Git.

## 问题与解决方案

以下第 2～9 项记录的是**迁移前原合约代码中存在的问题**，在迁移至 Foundry 后通过测试和代码检查发现并处理；每项末尾标注的是本仓库当前的处理状态，并不表示这些问题均仍存在于当前版本中。第 1 项为迁移时的依赖安装问题，第 10 项为本仓库新增页面的问题，均不归属于原项目合约。

1. **问题（迁移过程中的依赖安装）：** `forge install` 安装 OpenZeppelin 等依赖时，HTTPS 克隆超时严重，容易中断。

   **解决：** 配置 GitHub SSH 密钥并验证连接，将 GitHub 的 HTTPS 克隆地址改写为 SSH，无需使用 npm。

   ```sh
   ssh -T git@github.com
   git config --global url."git@github.com:".insteadOf "https://github.com/"
   ```

   SSH 仍需要网络能够访问 GitHub；地址改写不会解决不存在的版本标签问题。

2. **问题（迁移前原合约）：** `_safeMetaNodeTransfer()` 调用 `transfer()` 返回 `false` 时仍继续结算，用户可能没收到奖励币，奖励记录却已被扣除。

   **解决：** 使用 `SafeERC20.safeTransfer()`，转账失败时让整笔交易回退。**已修复。**

3. **问题（迁移前原合约）：** 奖励币余额不足时，只转出合约剩余余额，却按全部应得奖励结算，导致用户未收到的部分丢失。

   **解决：** 转账前检查奖励币余额能否覆盖本次全部奖励；不足时回退交易，保留用户待领取奖励，补充奖励币后再领取。**已修复。**

4. **问题（迁移前原合约）：** `claim()` 在更新用户奖励记录前调用奖励代币合约，存在通过代币回调重入、重复领取奖励的风险。

   **解决：** 按检查、更新状态、外部交互的顺序执行，先清零待领取奖励并更新已结算记录，再转出奖励币；转账失败时状态随交易一起回退。**已修复。**

5. **问题（迁移前原合约）：** 按池子权重分配奖励、再按质押数量分配奖励时，整数除法反复舍入，频繁更新可能丢弃本可累积的奖励余数，导致舍入相关单测失败。

   **解决：** 为两个分配阶段分别保存余数及对应分母，在后续更新中继续累积；分母变化时进行换算，减少重复舍入造成的损失。新增存储追加在原有变量之后，保持升级存储布局兼容。**已修复。**

6. **问题（迁移前原合约）：** 奖励结束后，`getMultiplier()` 对区块区间的处理可能导致回退，进而影响更新奖励、解质押等操作。

   **解决：** 将计算区间限制在奖励开始与结束区块之间；区间与奖励期没有交集时返回 `0`，使奖励结束后仍可正常退出。**已修复。**

7. **问题（迁移前原合约）：** 修改锁定区块数后，不同解质押申请的解锁顺序可能与申请顺序不同；若 `withdraw()` 遇到第一笔未解锁申请就停止，后面已经解锁的资产也无法提取。

   **解决：** 扫描全部解质押申请，汇总所有已解锁金额，只保留尚未解锁的申请，再转出可提取资产。**已修复。**

8. **问题（迁移前原合约）：** ERC20 质押使用严格大于最低值的判断，配置最低质押为 `1 LINK` 或 `1 USDC` 时，恰好质押 1 个代币仍会失败。

   **解决：** 改为数量大于 `0` 且大于等于最低质押量，并同步页面校验。**已修复。**

9. **问题（迁移前原合约）：** 修改每区块奖励或奖励起止区块时，没有先结算旧参数对应的奖励；新增池子或修改权重时若不更新现有池子，也可能用新参数计算此前尚未结算的区间。

   **解决：** 应在参数变更前按旧参数更新所有受影响的池子，再应用新参数。新增池子和修改权重时使用 `_withUpdate = true`；当前升级脚本已这样处理。奖励速率、起止区块的 setter 尚未自动执行这一步，仍需完善合约。**部分处理，尚未完全修复。**

10. **问题（迁移后本仓库新增页面）：** 申请解质押后，页面只立即刷新一次；即使后续区块已经达到解锁高度，“提取已解锁资产”按钮也可能继续置灰，用户无法判断还需等待多久。

    **解决：** 等待解锁期间每 15 秒自动刷新，并显示距离下一笔可提取的剩余区块数和解锁区块高度；倒计时读取已保存的解质押记录，不按当前锁定参数推算历史申请。**已修复。**

其中，奖励转账返回 `false`、奖励余额不足、重入重复领取、池子奖励舍入是此前四个失败单测对应的问题。相关回归测试保存在 `test/MetaNodeStake.t.sol`，可通过 `forge test --summary` 查看测试结果。
