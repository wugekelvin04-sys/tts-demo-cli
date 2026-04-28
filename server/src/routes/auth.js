'use strict';

const express = require('express');
const crypto = require('crypto');
const store = require('../store');

const router = express.Router();

function shortCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'DEMO-' + Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function createSellerSession(app_key) {
  const device_code = crypto.randomUUID() + '-' + crypto.randomUUID();
  const seller_user_code = shortCode();
  store.sellerSessions.set(device_code, {
    user_code: seller_user_code,
    app_key,
    access_token: null,
    status: 'pending',
    created_at: Date.now(),
  });
  return { device_code, seller_user_code };
}

// POST /auth/partner/device
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

// POST /auth/login — 商家登录，任意密码均可，用户名标识商家身份
router.post('/login', (req, res) => {
  const { username } = req.body;
  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    return res.status(400).json({ error: 'invalid_input' });
  }
  const name = username.trim().slice(0, 50);

  let seller = store.sellers.get(name);
  if (!seller) {
    seller = { seller_id: 'seller_' + crypto.randomBytes(6).toString('hex'), username: name, created_at: Date.now() };
    store.sellers.set(name, seller);
  }

  res.json({ seller_id: seller.seller_id, username: seller.username });
});

// GET /auth/apps?seller_id=xxx — 返回该商家的 App 列表
router.get('/apps', (req, res) => {
  const { seller_id } = req.query;
  const apps = Array.from(store.apps.values())
    .filter(a => !seller_id || a.seller_id === seller_id)
    .map(({ app_key, app_name, created_at }) => ({ app_key, app_name, created_at }));
  res.json({ apps });
});

// POST /auth/partner/approve
// 支持两种模式：
//   新建 App: { user_code, app_name, seller_id }
//   选现有 App: { user_code, existing_app_key }
router.post('/partner/approve', (req, res) => {
  const { user_code, app_name, existing_app_key, seller_id } = req.body;

  if (!user_code) return res.status(400).json({ error: 'invalid_input' });
  if (!app_name && !existing_app_key) return res.status(400).json({ error: 'invalid_input' });

  let partnerKey = null;
  for (const [code, s] of store.partnerSessions) {
    if (s.user_code === user_code) { partnerKey = code; break; }
  }
  if (!partnerKey) return res.status(404).json({ error: 'session_not_found' });

  const partnerSession = store.partnerSessions.get(partnerKey);
  if (partnerSession.status !== 'pending') return res.status(409).json({ error: 'already_approved' });

  let app_key, app_secret, finalAppName;

  if (existing_app_key) {
    const existingApp = store.apps.get(existing_app_key);
    if (!existingApp) return res.status(404).json({ error: 'app_not_found' });
    app_key = existingApp.app_key;
    app_secret = existingApp.app_secret;
    finalAppName = existingApp.app_name;
  } else {
    const trimmedName = app_name.trim().slice(0, 50);
    if (trimmedName.length === 0) return res.status(400).json({ error: 'invalid_input' });
    app_key = 'app_' + crypto.randomBytes(8).toString('hex');
    app_secret = crypto.randomBytes(32).toString('hex');
    finalAppName = trimmedName;
    store.apps.set(app_key, { app_key, app_name: finalAppName, app_secret, seller_id: seller_id || null, created_at: Date.now() });
  }

  const { device_code, seller_user_code } = createSellerSession(app_key);

  partnerSession.app_key = app_key;
  partnerSession.app_secret = app_secret;
  partnerSession.seller_device_code = device_code;
  partnerSession.app_name = finalAppName;
  partnerSession.status = 'approved';

  res.json({ ok: true, app_key, app_name: finalAppName, seller_user_code });
});

// GET /auth/seller/token?code=<device_code>
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
