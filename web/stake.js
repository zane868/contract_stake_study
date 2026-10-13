'use strict';

// This page talks directly to an injected EIP-1193 wallet. It has no npm or CDN dependency.
const STAKE = '0xe22E65cc67457678B361476158f7865e949BBcd5';
const CHAIN_ID = '0xaa36a7';
const ZERO = '0x0000000000000000000000000000000000000000';
const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const ROLES = {
  admin: '0x589d473ba17c0f47d494622893831497bad25919b9afb8e33e9521b8963fccde',
  upgrade: '0xcab03bc4dbcc648cd59d6bbe9f848d1e9092f914016aa290ee92e18700d1e6f9',
  default: '0x' + '0'.repeat(64)
};
const S = {
  depositETH: '0xf6326fb3', deposit: '0xe2bbb158', unstake: '0x9e2c8a5b', withdraw: '0x2e1a7d4d', claim: '0x379607f5',
  pool: '0xfe313112', poolLength: '0x081e3eda', start: '0x48cd4cb1', end: '0x083c6323', rate: '0x9ea96e66',
  rewardToken: '0xd22f1d80', totalWeight: '0x02559004', withdrawPaused: '0x2f3ffb9f', claimPaused: '0xab5e124a', paused: '0x5c975abb',
  stakingBalance: '0x11548234', pending: '0xea5c219d', pendingAtBlock: '0x6325d5bc', withdrawAmount: '0xff423357', multiplier: '0x8dbb1e3a',
  balanceOf: '0x70a08231', allowance: '0xdd62ed3e', decimals: '0x313ce567', symbol: '0x95d89b41', approve: '0x095ea7b3', transfer: '0xa9059cbb',
  hasRole: '0x91d14854', grantRole: '0x2f2ff15d', revokeRole: '0xd547741f', renounceRole: '0x36568abe',
  setToken: '0x61a9a03d', pauseWithdraw: '0x6155e3de', unpauseWithdraw: '0x5bb6d007', pauseClaim: '0x8ff095f9', unpauseClaim: '0xde065caa',
  setStart: '0xf35e4a6e', setEnd: '0xc713aa94', setRate: '0xd7bc1769', addPool: '0xb6d9d919', editPool: '0xd86c0444',
  setWeight: '0xfad07ece', updatePool: '0x51eb05a6', updateAll: '0x630b5ba1', upgrade: '0x4f1ef286', proxiableUUID: '0x52d1902d'
};
const $ = (id) => document.getElementById(id);
const wallet = window.ethereum;
let account = null;
let busy = false;
let refreshId = 0;
let state = {
  pid: 0, count: 0, block: 0n, start: 0n, end: 0n, rate: 0n, rewardToken: ZERO,
  rewardSymbol: 'TOKEN', rewardDecimals: 18, pool: null, assetSymbol: 'ETH', assetDecimals: 18,
  balance: 0n, allowance: 0n, staked: 0n, pending: 0n, requested: 0n, withdrawable: 0n,
  withdrawPaused: false, claimPaused: false, paused: false, isAdmin: false, isRoleAdmin: false, isUpgrade: false
};

function report(message, kind = '') { $('status').textContent = message; $('status').className = kind; }
function messageOf(error) { return error?.shortMessage || error?.data?.message || error?.message || String(error); }
function assertAddress(value) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value.trim())) throw Error('请输入有效的 0x 地址');
  return value.trim();
}
function w(value) {
  const n = BigInt(value);
  if (n < 0n || n >= (1n << 256n)) throw Error('整数超出 uint256 范围');
  return n.toString(16).padStart(64, '0');
}
function a(value) { return assertAddress(value).slice(2).toLowerCase().padStart(64, '0'); }
function uintInput(id, allowZero = true) {
  const value = $(id).value.trim();
  if (!/^(0|[1-9]\d*)$/.test(value)) throw Error('请输入非负整数：' + id);
  const n = BigInt(value);
  if ((!allowZero && n === 0n) || n >= (1n << 256n)) throw Error('整数超出允许范围：' + id);
  return n;
}
function parseUnits(input, decimals, allowZero = false) {
  const value = input.trim();
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) throw Error('请输入有效的代币数量');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw Error('小数位最多 ' + decimals + ' 位');
  const n = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
  if ((!allowZero && n === 0n) || n >= (1n << 256n)) throw Error('数量超出允许范围');
  return n;
}
function formatUnits(value, decimals, digits = 6) {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, '0').slice(0, digits).replace(/0+$/, '');
  return whole + (fraction ? '.' + fraction : '');
}
function fields(hex) {
  if (!/^0x([0-9a-fA-F]{64})+$/.test(hex)) throw Error('链上返回值格式错误');
  return (hex.slice(2).match(/.{64}/g) || []).map((part) => BigInt('0x' + part));
}
function addressFromUint(n) { return '0x' + n.toString(16).padStart(40, '0').slice(-40); }
function stringFromAbi(hex) {
  const body = hex.slice(2);
  if (body.length === 64) return new TextDecoder().decode(Uint8Array.from((body.match(/../g) || []).map((part) => parseInt(part, 16)))).replace(/\0+$/, '');
  const offset = Number(BigInt('0x' + body.slice(0, 64))) * 2;
  const length = Number(BigInt('0x' + body.slice(offset, offset + 64)));
  const data = body.slice(offset + 64, offset + 64 + length * 2);
  if (data.length !== length * 2) throw Error('代币名称编码不完整');
  return new TextDecoder().decode(Uint8Array.from((data.match(/../g) || []).map((part) => parseInt(part, 16))));
}
async function rpc(method, params = []) {
  if (!wallet) throw Error('未检测到浏览器钱包，请安装 MetaMask 等钱包');
  return wallet.request({ method, params });
}
async function call(to, data) { return rpc('eth_call', [{ to, data }, 'latest']); }
async function read(to, data) { return BigInt(await call(to, data)); }
async function limitedAll(tasks, limit = 3) {
  const results = [];
  for (let i = 0; i < tasks.length; i += limit) results.push(...await Promise.all(tasks.slice(i, i + limit).map((task) => task())));
  return results;
}
async function tokenInfo(address) {
  const [decimalHex, symbolHex] = await Promise.all([call(address, S.decimals), call(address, S.symbol)]);
  const decimals = Number(BigInt(decimalHex));
  if (decimals < 0 || decimals > 36) throw Error('代币 decimals 超出页面支持范围');
  return { decimals, symbol: stringFromAbi(symbolHex) || 'TOKEN' };
}
async function nextUnlockBlock(pid, owner, currentBlock, expectedRequested) {
  // MetaNodeStake storage layout: user mapping slot 6; User.requests is offset 3;
  // each UnstakeRequest occupies amount and unlockBlocks (two storage slots).
  const modulus = 1n << 256n;
  const poolSlot = keccak256Hex(w(pid) + w(6));
  const userSlot = BigInt('0x' + keccak256Hex(a(owner) + poolSlot));
  const requestsSlot = (userSlot + 3n) % modulus;
  const length = BigInt(await rpc('eth_getStorageAt', [STAKE, '0x' + requestsSlot.toString(16), 'latest']));
  if (length > 200n) throw Error('解质押申请过多，无法在页面显示倒计时');
  const dataSlot = BigInt('0x' + keccak256Hex(w(requestsSlot)));
  let earliest = null;
  let requested = 0n;
  for (let start = 0n; start < length; start += 4n) {
    const count = Number(length - start < 4n ? length - start : 4n);
    const entries = await Promise.all(Array.from({ length: count }, async (_, offset) => {
      const slot = (dataSlot + 2n * (start + BigInt(offset))) % modulus;
      const [amount, unlock] = await Promise.all([slot, (slot + 1n) % modulus].map((position) =>
        rpc('eth_getStorageAt', [STAKE, '0x' + position.toString(16), 'latest'])));
      return { amount: BigInt(amount), unlock: BigInt(unlock) };
    }));
    for (const { amount, unlock } of entries) {
      requested += amount;
      if (unlock > currentBlock && (earliest === null || unlock < earliest)) earliest = unlock;
    }
  }
  if (requested !== expectedRequested) throw Error('解质押记录与合约汇总不一致');
  return earliest;
}
async function ensureSepolia() {
  if ((await rpc('eth_chainId')).toLowerCase() === CHAIN_ID) return;
  try { await rpc('wallet_switchEthereumChain', [{ chainId: CHAIN_ID }]); }
  catch (error) {
    if (error.code !== 4902) throw error;
    await rpc('wallet_addEthereumChain', [{ chainId: CHAIN_ID, chainName: 'Sepolia', nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'], blockExplorerUrls: ['https://sepolia.etherscan.io'] }]);
  }
  if ((await rpc('eth_chainId')).toLowerCase() !== CHAIN_ID) throw Error('钱包未切换到 Sepolia');
}
async function hasRole(role, address) { return (await read(STAKE, S.hasRole + role.slice(2) + a(address))) !== 0n; }
function setButtons() {
  const ready = Boolean(account) && !busy;
  $('connect').disabled = busy;
  $('refresh').disabled = !ready;
  $('pool-select').disabled = !ready;
  $('deposit').disabled = !ready || !state.pool || state.paused;
  $('approve').disabled = !ready || !state.pool || state.pid === 0;
  $('reset-approve').disabled = !ready || state.pid === 0 || state.allowance === 0n;
  $('unstake').disabled = !ready || state.paused || state.withdrawPaused || state.staked === 0n;
  $('withdraw').disabled = !ready || state.paused || state.withdrawPaused || state.withdrawable === 0n;
  $('claim').disabled = !ready || state.paused || state.claimPaused || state.pending === 0n;
  for (const id of ['query-reward', 'query-multiplier', 'update-pool', 'update-all', 'check-role', 'fund']) $(id).disabled = !ready;
  for (const id of ['set-start', 'set-end', 'set-rate', 'set-token', 'toggle-withdraw', 'toggle-claim', 'add-pool', 'edit-pool', 'set-weight']) $(id).disabled = !ready || !state.isAdmin;
  for (const id of ['grant-role', 'revoke-role']) $(id).disabled = !ready || !state.isRoleAdmin;
  $('renounce-role').disabled = !ready;
  $('upgrade').disabled = !ready || !state.isUpgrade;
  $('toggle-withdraw').textContent = state.withdrawPaused ? '恢复提取/解质押' : '暂停提取/解质押';
  $('toggle-claim').textContent = state.claimPaused ? '恢复领奖' : '暂停领奖';
}
async function refresh() {
  if (!account || busy) return;
  const requestId = ++refreshId;
  if ((await rpc('eth_chainId')).toLowerCase() !== CHAIN_ID) { report('钱包不在 Sepolia，请点击连接钱包并切换网络。', 'error'); return; }
  const [blockHex, count, start, end, rate, rewardAddressHex, totalWeight, withdrawPaused, claimPaused, paused, admin, roleAdmin, upgrade] = await limitedAll([
    () => rpc('eth_blockNumber'), () => read(STAKE, S.poolLength), () => read(STAKE, S.start), () => read(STAKE, S.end), () => read(STAKE, S.rate),
    () => call(STAKE, S.rewardToken), () => read(STAKE, S.totalWeight), () => read(STAKE, S.withdrawPaused), () => read(STAKE, S.claimPaused), () => read(STAKE, S.paused),
    () => hasRole(ROLES.admin, account), () => hasRole(ROLES.default, account), () => hasRole(ROLES.upgrade, account)
  ]);
  if (count === 0n || count > 500n) throw Error('资金池数量不符合预期');
  const rewardToken = addressFromUint(BigInt(rewardAddressHex));
  const rewardInfo = await tokenInfo(rewardToken);
  const countNumber = Number(count);
  const previous = Number($('pool-select').value);
  const pid = previous < countNumber ? previous : 0;
  const pidWord = w(pid), userArgs = pidWord + a(account);
  const [poolHex, staked, pending, amountsHex, rewardBalance, funding] = await limitedAll([
    () => call(STAKE, S.pool + pidWord), () => read(STAKE, S.stakingBalance + userArgs), () => read(STAKE, S.pending + userArgs),
    () => call(STAKE, S.withdrawAmount + userArgs), () => read(rewardToken, S.balanceOf + a(account)), () => read(rewardToken, S.balanceOf + a(STAKE))
  ]);
  const poolFields = fields(poolHex);
  const amounts = fields(amountsHex);
  if (poolFields.length < 7 || amounts.length < 2) throw Error('资金池数据格式错误');
  const pool = { token: addressFromUint(poolFields[0]), weight: poolFields[1], lastBlock: poolFields[2], total: poolFields[4], min: poolFields[5], lock: poolFields[6] };
  const assetInfo = pid === 0 ? { symbol: 'ETH', decimals: 18 } : await tokenInfo(pool.token);
  const [balance, allowance] = pid === 0
    ? [BigInt(await rpc('eth_getBalance', [account, 'latest'])), 0n]
    : await Promise.all([read(pool.token, S.balanceOf + a(account)), read(pool.token, S.allowance + a(account) + a(STAKE))]);
  let unlockBlock = null;
  let unlockReadFailed = false;
  if (amounts[0] > amounts[1]) {
    try { unlockBlock = await nextUnlockBlock(pid, account, BigInt(blockHex), amounts[0]); }
    catch { unlockReadFailed = true; }
  }
  if (requestId !== refreshId || !account) return;
  state = { pid, count: countNumber, block: BigInt(blockHex), start, end, rate, rewardToken,
    rewardSymbol: rewardInfo.symbol, rewardDecimals: rewardInfo.decimals, pool, assetSymbol: assetInfo.symbol, assetDecimals: assetInfo.decimals,
    balance, allowance, staked, pending, requested: amounts[0], withdrawable: amounts[1],
    withdrawPaused: withdrawPaused !== 0n, claimPaused: claimPaused !== 0n, paused: paused !== 0n,
    isAdmin: admin, isRoleAdmin: roleAdmin, isUpgrade: upgrade };
  $('pool-select').replaceChildren(...Array.from({ length: countNumber }, (_, i) => {
    const option = document.createElement('option'); option.value = String(i); option.textContent = i === 0 ? '#0 ETH' : i === 1 ? '#1 LINK' : i === 2 ? '#2 USDC' : '#' + i + ' ERC20'; return option;
  }));
  $('pool-select').value = String(pid);
  $('account').textContent = account;
  $('network').textContent = 'Sepolia / #' + state.block;
  $('blocks').textContent = start + ' → ' + end + (state.block > end ? '（已结束）' : '');
  $('rate').textContent = formatUnits(rate, rewardInfo.decimals) + ' ' + rewardInfo.symbol + ' / 区块';
  $('pool-count').textContent = count + ' / ' + totalWeight;
  $('reward-token').textContent = rewardInfo.symbol + ' · ' + rewardToken;
  $('funding').textContent = formatUnits(funding, rewardInfo.decimals) + ' ' + rewardInfo.symbol;
  $('pause-state').textContent = '全局 ' + (state.paused ? '暂停' : '正常') + ' · 提取 ' + (state.withdrawPaused ? '暂停' : '正常') + ' · 领奖 ' + (state.claimPaused ? '暂停' : '正常');
  $('roles').textContent = [admin && 'ADMIN_ROLE', roleAdmin && 'DEFAULT_ADMIN_ROLE', upgrade && 'UPGRADE_ROLE'].filter(Boolean).join('、') || '普通用户';
  $('stake-token').textContent = assetInfo.symbol + ' · ' + (pid === 0 ? '原生 ETH' : pool.token);
  $('pool-weight').textContent = pool.weight + ' / #' + pool.lastBlock;
  $('pool-amount').textContent = formatUnits(pool.total, assetInfo.decimals) + ' / ' + formatUnits(pool.min, assetInfo.decimals) + ' ' + assetInfo.symbol;
  $('lock').textContent = pool.lock + ' 个区块';
  $('wallet-balance').textContent = formatUnits(balance, assetInfo.decimals) + ' ' + assetInfo.symbol;
  $('allowance').textContent = pid === 0 ? '无需授权' : formatUnits(allowance, assetInfo.decimals) + ' ' + assetInfo.symbol;
  $('staked').textContent = formatUnits(staked, assetInfo.decimals) + ' ' + assetInfo.symbol;
  $('pending').textContent = formatUnits(pending, rewardInfo.decimals) + ' ' + rewardInfo.symbol;
  $('requested').textContent = formatUnits(amounts[0], assetInfo.decimals) + ' ' + assetInfo.symbol;
  $('withdrawable').textContent = formatUnits(amounts[1], assetInfo.decimals) + ' ' + assetInfo.symbol;
  $('remaining-blocks').textContent = amounts[0] === 0n ? '无待提取申请'
    : amounts[1] > 0n ? '0 个区块（现在可提取）'
    : unlockReadFailed ? '暂无法读取，请稍后刷新'
    : unlockBlock === null ? '等待链上状态更新'
    : (unlockBlock - state.block).toString() + ' 个区块（到区块 #' + unlockBlock + '）';
  $('reward-balance').textContent = formatUnits(rewardBalance, rewardInfo.decimals) + ' ' + rewardInfo.symbol;
  $('approve-box').classList.toggle('hidden', pid === 0);
  $('deposit-note').textContent = '最低质押 ' + formatUnits(pool.min, assetInfo.decimals) + ' ' + assetInfo.symbol + '；交易另需 Gas。';
  $('edit-min').value = formatUnits(pool.min, assetInfo.decimals, assetInfo.decimals);
  $('edit-lock').value = String(pool.lock);
  $('edit-weight').value = String(pool.weight);
  setButtons();
}
async function connect() {
  try {
    const accounts = await rpc('eth_requestAccounts');
    if (!accounts.length) throw Error('钱包未返回账户');
    await ensureSepolia();
    account = accounts[0]; $('connect').textContent = account.slice(0, 6) + '…' + account.slice(-4);
    await refresh(); report('已连接 Sepolia。', 'success');
  } catch (error) { report('连接失败：' + messageOf(error), 'error'); }
}
async function send(label, to, data, value) {
  if (!account || busy) return;
  busy = true; setButtons();
  try {
    await ensureSepolia();
    const tx = { from: account, to, data };
    if (value !== undefined) tx.value = '0x' + value.toString(16);
    const hash = await rpc('eth_sendTransaction', [tx]);
    report(label + ' 已提交，等待确认：\n' + hash);
    for (let attempt = 0; attempt < 90; attempt++) {
      const receipt = await rpc('eth_getTransactionReceipt', [hash]);
      if (receipt) {
        if (BigInt(receipt.status) !== 1n) throw Error('交易执行失败：' + hash);
        report(label + ' 成功。交易：\nhttps://sepolia.etherscan.io/tx/' + hash, 'success');
        busy = false; await refresh(); return;
      }
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }
    report(label + ' 已提交，等待确认超时。请查看：\nhttps://sepolia.etherscan.io/tx/' + hash);
  } catch (error) { report(label + ' 未完成：' + messageOf(error), 'error'); }
  finally { busy = false; setButtons(); }
}
function action(id, handler) { $(id).addEventListener('click', async () => { try { await handler(); } catch (error) { report(messageOf(error), 'error'); } }); }
function confirmChange(description) { return window.confirm(description + '\n这是 Sepolia 链上交易，会消耗 Gas。确定继续？'); }

action('connect', connect);
action('refresh', refresh);
$('pool-select').addEventListener('change', () => refresh().catch((error) => report('刷新失败：' + messageOf(error), 'error')));
action('approve', async () => {
  if (state.pid === 0) throw Error('ETH 不需要授权');
  const amount = parseUnits($('deposit-amount').value, state.assetDecimals);
  if (state.allowance >= amount) throw Error('当前授权额度已足够');
  await send('授权质押代币', state.pool.token, S.approve + a(STAKE) + w(amount));
});
action('reset-approve', () => {
  if (state.pid === 0 || state.allowance === 0n) throw Error('当前池无需清零授权');
  if (confirmChange('清零 ' + state.assetSymbol + ' 对质押合约的授权？')) return send('清零质押代币授权', state.pool.token, S.approve + a(STAKE) + w(0));
});
action('deposit', async () => {
  const amount = parseUnits($('deposit-amount').value, state.assetDecimals);
  if (state.pid === 0) {
    if (amount < state.pool.min) throw Error('低于 ETH 池最低质押量');
    if (amount >= state.balance) throw Error('钱包 ETH 余额不足，且需要预留 Gas');
    await send('质押 ETH', STAKE, S.depositETH, amount);
  } else {
    if (amount < state.pool.min) throw Error('ERC20 质押量低于池子最低值');
    if (amount > state.balance) throw Error('钱包代币余额不足');
    if (amount > state.allowance) throw Error('授权额度不足，请先点击授权输入数量');
    await send('质押 ' + state.assetSymbol, STAKE, S.deposit + w(state.pid) + w(amount));
  }
});
action('unstake', async () => {
  const amount = parseUnits($('unstake-amount').value, state.assetDecimals);
  if (amount > state.staked) throw Error('申请数量超过已质押数量');
  await send('申请解质押', STAKE, S.unstake + w(state.pid) + w(amount));
});
action('withdraw', () => send('提取已解锁资产', STAKE, S.withdraw + w(state.pid)));
action('claim', () => send('领取奖励', STAKE, S.claim + w(state.pid)));
action('query-reward', async () => {
  const block = uintInput('query-block');
  const amount = await read(STAKE, S.pendingAtBlock + w(state.pid) + a(account) + w(block));
  $('query-result').textContent = '区块 #' + block + ' 预计可领取 ' + formatUnits(amount, state.rewardDecimals) + ' ' + state.rewardSymbol;
});
action('query-multiplier', async () => {
  const from = uintInput('from-block'), to = uintInput('to-block');
  if (from > to) throw Error('起始区块不能大于结束区块');
  const amount = await read(STAKE, S.multiplier + w(from) + w(to));
  $('multiplier-result').textContent = '区间 [' + from + ', ' + to + ') 按当前速率计算的奖励基数：' + formatUnits(amount, state.rewardDecimals) + ' ' + state.rewardSymbol;
});
action('update-pool', () => send('更新资金池奖励账本', STAKE, S.updatePool + w(state.pid)));
action('update-all', () => { if (confirmChange('更新全部资金池奖励账本？资金池多时 Gas 可能较高。')) return send('更新全部资金池', STAKE, S.updateAll); });
action('fund', async () => {
  const amount = parseUnits($('fund-amount').value, state.rewardDecimals);
  const balance = await read(state.rewardToken, S.balanceOf + a(account));
  if (amount > balance) throw Error('钱包奖励代币余额不足');
  if (confirmChange('转入 ' + $('fund-amount').value.trim() + ' ' + state.rewardSymbol + ' 到质押合约？'))
    await send('补充奖励代币', state.rewardToken, S.transfer + a(STAKE) + w(amount));
});

action('set-start', async () => {
  const n = uintInput('admin-start'); if (n > state.end) throw Error('开始区块不能大于结束区块');
  if (confirmChange('设置奖励开始区块为 ' + n + '？')) await send('设置开始区块', STAKE, S.setStart + w(n));
});
action('set-end', async () => {
  const n = uintInput('admin-end'); if (n < state.start) throw Error('结束区块不能小于开始区块');
  if (confirmChange('设置奖励结束区块为 ' + n + '？')) await send('设置结束区块', STAKE, S.setEnd + w(n));
});
action('set-rate', async () => {
  const n = parseUnits($('admin-rate').value, state.rewardDecimals);
  if (n === state.rate) { report('当前已是每区块 ' + formatUnits(n, state.rewardDecimals) + ' ' + state.rewardSymbol + '，无需交易。', 'success'); return; }
  if (confirmChange('设置每区块奖励为 ' + $('admin-rate').value.trim() + ' ' + state.rewardSymbol + '？')) await send('设置每区块奖励', STAKE, S.setRate + w(n));
});
action('set-token', async () => {
  const address = assertAddress($('admin-reward-token').value);
  if (address.toLowerCase() === state.rewardToken.toLowerCase()) throw Error('当前已使用此奖励代币');
  const info = await tokenInfo(address);
  if (confirmChange('将所有资金池的奖励代币更换为 ' + info.symbol + ' (' + address + ')？请先核对该代币余额和精度。')) await send('更换奖励代币', STAKE, S.setToken + a(address));
});
action('toggle-withdraw', async () => {
  const next = !state.withdrawPaused;
  if (confirmChange(next ? '暂停所有资金池的解质押和提取？' : '恢复所有资金池的解质押和提取？')) await send(next ? '暂停提取' : '恢复提取', STAKE, next ? S.pauseWithdraw : S.unpauseWithdraw);
});
action('toggle-claim', async () => {
  const next = !state.claimPaused;
  if (confirmChange(next ? '暂停所有资金池的领奖？' : '恢复所有资金池的领奖？')) await send(next ? '暂停领奖' : '恢复领奖', STAKE, next ? S.pauseClaim : S.unpauseClaim);
});
action('add-pool', async () => {
  const address = assertAddress($('add-token').value);
  if (address.toLowerCase() === ZERO) throw Error('新增资金池必须使用 ERC20 地址');
  const info = await tokenInfo(address);
  for (let pid = 0; pid < state.count; pid++) {
    const pool = fields(await call(STAKE, S.pool + w(pid)));
    if (addressFromUint(pool[0]).toLowerCase() === address.toLowerCase()) throw Error('此质押代币已有资金池，重复添加会破坏奖励计算');
  }
  const weight = uintInput('add-weight', false);
  const min = parseUnits($('add-min').value, info.decimals, true);
  const lock = uintInput('add-lock', false);
  if (state.block >= state.end) throw Error('奖励已经结束，合约不允许新增资金池');
  if (confirmChange('新增 ' + info.symbol + ' 池：权重 ' + weight + '、最低质押 ' + $('add-min').value + '、锁定 ' + lock + ' 区块？'))
    await send('新增资金池', STAKE, S.addPool + a(address) + w(weight) + w(min) + w(lock) + w($('add-update').checked ? 1 : 0));
});
action('edit-pool', async () => {
  const min = parseUnits($('edit-min').value, state.assetDecimals, true);
  const lock = uintInput('edit-lock');
  if (confirmChange('修改资金池 #' + state.pid + ' 的最低质押和锁定区块？')) await send('更新资金池参数', STAKE, S.editPool + w(state.pid) + w(min) + w(lock));
});
action('set-weight', async () => {
  const weight = uintInput('edit-weight', false);
  if (confirmChange('将资金池 #' + state.pid + ' 权重改为 ' + weight + '？')) await send('修改资金池权重', STAKE, S.setWeight + w(state.pid) + w(weight) + w($('weight-update').checked ? 1 : 0));
});
function selectedRole() { return ROLES[$('role-type').value]; }
action('check-role', async () => {
  const address = assertAddress($('role-address').value);
  $('role-result').textContent = address + (await hasRole(selectedRole(), address) ? ' 持有此角色' : ' 没有此角色');
});
action('grant-role', async () => {
  const address = assertAddress($('role-address').value), role = selectedRole();
  if (!state.isRoleAdmin) throw Error('当前钱包没有 DEFAULT_ADMIN_ROLE');
  if (confirmChange('授予 ' + $('role-type').selectedOptions[0].textContent + ' 给 ' + address + '？')) await send('授予角色', STAKE, S.grantRole + role.slice(2) + a(address));
});
action('revoke-role', async () => {
  const address = assertAddress($('role-address').value), role = selectedRole();
  if (!state.isRoleAdmin) throw Error('当前钱包没有 DEFAULT_ADMIN_ROLE');
  if (confirmChange('撤销 ' + address + ' 的 ' + $('role-type').selectedOptions[0].textContent + '？')) await send('撤销角色', STAKE, S.revokeRole + role.slice(2) + a(address));
});
action('renounce-role', async () => {
  const role = selectedRole();
  if (!(await hasRole(role, account))) throw Error('当前钱包没有这个角色');
  if (confirmChange('放弃当前钱包自己的 ' + $('role-type').selectedOptions[0].textContent + '？此操作可能导致管理员权限永久丢失。'))
    await send('放弃角色', STAKE, S.renounceRole + role.slice(2) + a(account));
});
action('upgrade', async () => {
  if (!state.isUpgrade) throw Error('当前钱包没有 UPGRADE_ROLE');
  const address = assertAddress($('upgrade-address').value);
  const code = await rpc('eth_getCode', [address, 'latest']);
  if (code === '0x') throw Error('新实现地址没有合约代码');
  const uuid = await call(address, S.proxiableUUID);
  if (uuid.toLowerCase() !== IMPLEMENTATION_SLOT) throw Error('新实现合约的 UUPS 存储槽不匹配');
  if (confirmChange('升级代理到 ' + address + '？必须确认源码和存储布局兼容；此操作会影响所有资金池。'))
    await send('升级代理', STAKE, S.upgrade + a(address) + w(64) + w(0));
});

wallet?.on?.('accountsChanged', (accounts) => {
  account = accounts[0] || null; ++refreshId;
  $('account').textContent = account || '未连接';
  $('connect').textContent = account ? account.slice(0, 6) + '…' + account.slice(-4) : '连接钱包';
  state.staked = 0n; state.pending = 0n; state.withdrawable = 0n; state.isAdmin = false; state.isRoleAdmin = false; state.isUpgrade = false;
  setButtons();
  if (account) refresh().catch((error) => report('刷新失败：' + messageOf(error), 'error'));
});
wallet?.on?.('chainChanged', () => { ++refreshId; if (account) refresh().catch((error) => report('刷新失败：' + messageOf(error), 'error')); });
window.setInterval(() => {
  if (account && !busy && state.requested > state.withdrawable) {
    refresh().catch((error) => report('自动刷新失败：' + messageOf(error), 'error'));
  }
}, 15000);
if (!wallet) report('未检测到浏览器钱包。请使用安装了 MetaMask 等钱包的浏览器打开此页面。', 'error');
