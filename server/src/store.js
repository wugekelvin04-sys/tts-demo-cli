'use strict';

const store = {
  // Map<partner_device_code, { user_code, app_key, app_secret, seller_device_code, app_name, status, created_at }>
  partnerSessions: new Map(),
  // Map<device_code, { user_code, app_key, access_token, status, created_at }>
  sellerSessions: new Map(),
  // Map<app_key, { app_key, app_name, app_secret, seller_id, created_at }>
  apps: new Map(),
  // Map<username, { seller_id, username, created_at }> — 任意密码均可登录，用户名标识商家
  sellers: new Map(),
  // Array<{ id, name, price, stock, created_at }>
  products: [],
  // Set<express.Response> — active SSE connections
  sseClients: new Set(),
};

module.exports = store;
