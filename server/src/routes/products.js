'use strict';

const express = require('express');
const crypto = require('crypto');
const store = require('../store');

const router = express.Router();

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of store.sseClients) {
    try { client.write(payload); } catch {}
  }
}

// POST /api/products  — CLI 调用，创建商品
router.post('/', (req, res) => {
  const { name, price, stock, access_token } = req.body;

  // 验证 access_token
  let valid = false;
  for (const s of store.sellerSessions.values()) {
    if (s.access_token === access_token && s.status === 'approved') { valid = true; break; }
  }
  if (!valid) return res.status(401).json({ error: 'invalid_access_token' });

  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  broadcast({ type: 'log', message: 'Agent 发起创建商品请求', time: t });
  broadcast({ type: 'log', message: '验证 access_token... ✓', time: t });

  const product = {
    id: 'prod_' + crypto.randomBytes(4).toString('hex'),
    name: String(name),
    price: parseFloat(price),
    stock: parseInt(stock),
    created_at: new Date().toISOString(),
  };
  store.products.push(product);

  broadcast({ type: 'log', message: `提交商品信息: "${product.name}" ¥${product.price.toFixed(2)} 库存:${product.stock}`, time: t });
  broadcast({ type: 'log', message: `商品创建成功 → ID: ${product.id}`, time: t });
  broadcast({ type: 'product', product });

  res.json({ ok: true, product });
});

// GET /api/products  — 浏览器首次加载读取已有商品
router.get('/', (req, res) => {
  res.json({ products: store.products });
});

module.exports = router;
