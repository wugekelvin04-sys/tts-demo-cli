'use strict';

const open = require('open');
const keychain = require('../lib/keychain');
const { poll } = require('../lib/poller');
const config = require('../lib/config');

async function authLogin() {
  console.log('\n🚀 TTS Demo CLI — 登录\n');
  console.log('正在连接服务器...');

  // Step 1: 请求 partner device codes
  const initRes = await fetch(config.SERVER_URL + '/auth/partner/device', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cli_id: crypto.randomUUID() }),
  });

  if (!initRes.ok) {
    throw new Error(`无法连接服务器 ${config.SERVER_URL}，请确认 Server 正在运行`);
  }

  const { partner_device_code, user_code } = await initRes.json();

  // Step 2: 打开浏览器到创建 App 页面
  const createUrl = `${config.SERVER_URL}/app-create.html?code=${user_code}`;
  console.log(`\n正在打开浏览器，请在网页上创建 App：`);
  console.log(`  ${createUrl}\n`);
  await open(createUrl);

  // Step 3: 轮询 partner token（等待用户在浏览器创建 App）
  console.log('等待 App 创建...');
  const partnerResult = await poll(
    `${config.SERVER_URL}/auth/partner/token?code=${encodeURIComponent(partner_device_code)}`
  );

  const { app_key, app_secret, seller_device_code } = partnerResult;
  await keychain.set('app_key', app_key);
  await keychain.set('app_secret', app_secret);

  console.log(`✓ App 创建成功 (${app_key})`);
  console.log('等待授权...');

  // Step 4: 轮询 seller token（等待用户在浏览器点授权）
  const sellerResult = await poll(
    `${config.SERVER_URL}/auth/seller/token?code=${encodeURIComponent(seller_device_code)}`
  );

  await keychain.set('access_token', sellerResult.access_token);
  await keychain.set('shop_id', sellerResult.shop_id);

  console.log('\n✅ 登录成功！');
  console.log(`   App:   ${app_key}`);
  console.log(`   Shop:  ${sellerResult.shop_id}`);
  console.log(`   Token: ${sellerResult.access_token.slice(0, 12)}...\n`);
}

module.exports = { authLogin };
