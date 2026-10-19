# MetaNodeStake

Foundry project for an upgradeable staking contract and a browser wallet page for Sepolia.

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
