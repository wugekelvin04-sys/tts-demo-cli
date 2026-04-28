'use strict';

const express = require('express');
const crypto = require('crypto');
const store = require('../store');

const router = express.Router();

function shortCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'DEMO-' + Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// POST /auth/partner/device
// CLI 启动双链路，获取轮询用的 partner_device_code 和浏览器展示用的 user_code
router.post('/partner/device', (req, res) => {
  const partner_device_code = crypto.randomUUID() + '-' + crypto.randomUUID();
  const user_code = shortCode();

  store.partnerSessions.set(partner_device_code, {
    user_code,
    app_key: null,
    app_secret: null,
    seller_device_code: null,
    app_name: null,
    status: 'pending',
    created_at: Date.now(),
  });

  res.json({ partner_device_code, user_code, expires_in: 600 });
});

// GET /auth/partner/token?code=<partner_device_code>
// CLI 轮询；未批准返回 202，批准后返回凭证并清除 app_secret
router.get('/partner/token', (req, res) => {
  const session = store.partnerSessions.get(req.query.code);
  if (!session) return res.status(404).json({ error: 'session_not_found' });
  if (Date.now() - session.created_at > 600_000) {
    store.partnerSessions.delete(req.query.code);
    return res.status(410).json({ error: 'expired' });
  }
  if (session.status === 'pending') return res.status(202).json({ status: 'pending' });
  if (session.status === 'credential_issued') return res.status(410).json({ error: 'already_issued' });

  const { app_key, app_secret, seller_device_code } = session;
  session.app_secret = null;
  session.status = 'credential_issued';
  res.json({ app_key, app_secret, seller_device_code });
});

// POST /auth/partner/approve
// 浏览器提交 App 名称；Server 创建 app 和 seller session，返回 seller_user_code 供浏览器跳转
router.post('/partner/approve', (req, res) => {
  const { user_code, app_name } = req.body;

  if (!user_code || !app_name || typeof app_name !== 'string' || app_name.trim().length === 0) {
    return res.status(400).json({ error: 'invalid_input' });
  }
  const trimmedAppName = app_name.trim().slice(0, 50);

  let partnerKey = null;
  for (const [code, s] of store.partnerSessions) {
    if (s.user_code === user_code) { partnerKey = code; break; }
  }
  if (!partnerKey) return res.status(404).json({ error: 'session_not_found' });

  const existingSession = store.partnerSessions.get(partnerKey);
  if (existingSession.status !== 'pending') return res.status(409).json({ error: 'already_approved' });

  const app_key = 'app_' + crypto.randomBytes(8).toString('hex');
  const app_secret = crypto.randomBytes(32).toString('hex');

  store.apps.set(app_key, { app_key, app_name: trimmedAppName, created_at: Date.now() });

  // 预创建 seller session（浏览器可直接跳授权页）
  const device_code = crypto.randomUUID() + '-' + crypto.randomUUID();
  const seller_user_code = shortCode();
  store.sellerSessions.set(device_code, {
    user_code: seller_user_code,
    app_key,
    access_token: null,
    status: 'pending',
    created_at: Date.now(),
  });

  const session = store.partnerSessions.get(partnerKey);
  session.app_key = app_key;
  session.app_secret = app_secret;
  session.seller_device_code = device_code;
  session.app_name = trimmedAppName;
  session.status = 'approved';

  res.json({ ok: true, app_key, app_name: trimmedAppName, seller_user_code });
});

// GET /auth/seller/token?code=<device_code>
// CLI 轮询；未批准返回 202，批准后返回 access_token
router.get('/seller/token', (req, res) => {
  const session = store.sellerSessions.get(req.query.code);
  if (!session) return res.status(404).json({ error: 'session_not_found' });
  if (Date.now() - session.created_at > 600_000) {
    store.sellerSessions.delete(req.query.code);
    return res.status(410).json({ error: 'expired' });
  }
  if (session.status !== 'approved') return res.status(202).json({ status: 'pending' });

  res.json({ access_token: session.access_token, shop_id: 'demo-shop-001' });
});

// POST /auth/seller/approve
// 浏览器点「授权」按钮
router.post('/seller/approve', (req, res) => {
  const { user_code } = req.body;

  if (!user_code) return res.status(400).json({ error: 'invalid_input' });

  let deviceKey = null;
  for (const [code, s] of store.sellerSessions) {
    if (s.user_code === user_code) { deviceKey = code; break; }
  }
  if (!deviceKey) return res.status(404).json({ error: 'session_not_found' });

  const session = store.sellerSessions.get(deviceKey);
  session.access_token = 'tok_' + crypto.randomBytes(24).toString('hex');
  session.status = 'approved';

  res.json({ ok: true });
});

module.exports = router;
