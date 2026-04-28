'use strict';

const keychain = require('../lib/keychain');
const config = require('../lib/config');

async function productCreate({ name, price, stock }) {
  const access_token = await keychain.get('access_token');
  if (!access_token) {
    console.error('\n❌ 未登录，请先运行：tts-demo auth login\n');
    process.exit(1);
  }

  console.log('\n→ 正在创建商品...\n');

  const res = await fetch(`${config.SERVER_URL}/api/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      price: parseFloat(price),
      stock: parseInt(stock),
      access_token,
    }),
  });

  const data = await res.json();

  if (!res.ok) {
    if (data.error === 'invalid_access_token') {
      console.error('❌ Token 无效或已过期，请重新运行：tts-demo auth login\n');
    } else {
      console.error('❌ 创建失败：', data.error, '\n');
    }
    process.exit(1);
  }

  const p = data.product;
  console.log('✅ 商品创建成功！\n');
  console.log(`   ID:    ${p.id}`);
  console.log(`   名称:  ${p.name}`);
  console.log(`   价格:  ¥${p.price.toFixed(2)}`);
  console.log(`   库存:  ${p.stock}`);
  console.log(`   时间:  ${new Date(p.created_at).toLocaleString('zh-CN')}`);
  console.log(`\n   (在 ${config.SERVER_URL} 查看实时操作日志)\n`);
}

module.exports = { productCreate };
