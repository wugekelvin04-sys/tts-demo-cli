# TTS Demo CLI — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 tts-demo-cli 原型，演示 Device Code 双链路授权、Skills 安装（symlink 到 Claude Code）和 Claude Code 调用商品创建的完整链路

**Architecture:** Server（Express，5000 端口）承载 Device Code 授权流、商品 API 和 SSE 实时推送；CLI（Node.js + commander）通过轮询完成授权并将凭证存 Keychain；Skills 从 GitHub 拉取后 symlink 到 `~/.claude/skills/tts-demo`，Claude Code 读取 skill 后调用 `tts-demo product create`，Server 实时将操作日志推送到浏览器仪表盘

**Tech Stack:** Node.js 18+, express, commander, keytar, open@8, adm-zip, 纯 HTML/CSS/JS

---

## 文件结构

```
tts-demo-cli/          ← github.com/wugekelvin04-sys/tts-demo-cli
├── cli/
│   ├── src/
│   │   ├── index.js              # CLI 入口，commander 路由
│   │   ├── commands/
│   │   │   ├── auth.js           # tts-demo auth login
│   │   │   ├── skills.js         # tts-demo skills install
│   │   │   └── product.js        # tts-demo product create
│   │   └── lib/
│   │       ├── config.js         # SERVER_URL、SKILLS_REPO 常量
│   │       ├── keychain.js       # keytar 封装 + 文件 fallback
│   │       └── poller.js         # Device Code 轮询（2s 间隔，10min 超时）
│   └── package.json
│
└── server/
    ├── src/
    │   ├── app.js                # Express 入口，路由注册，监听 5000
    │   ├── store.js              # 内存存储（partnerSessions / sellerSessions / apps / products / sseClients）
    │   └── routes/
    │       ├── auth.js           # 5 个 Device Code 接口
    │       ├── products.js       # POST /api/products + GET /api/products
    │       └── events.js         # GET /events（SSE）
    └── public/
        ├── index.html            # 仪表盘：SSE 日志 + 商品列表
        ├── app-create.html       # 创建 App 表单页
        └── authorize.html        # 授权确认页

tts-demo-skills/       ← github.com/wugekelvin04-sys/tts-demo-skills
├── getting-started.md
├── auth-guide.md
└── create-product.md
```

---

## Part 1：Server

### Task 1：初始化 Server 包

**Files:**
- Create: `server/package.json`
- Create: `server/src/store.js`

- [ ] **Step 1: 创建 `server/package.json`**

```json
{
  "name": "tts-demo-server",
  "version": "0.1.0",
  "description": "TTS Demo Server",
  "main": "src/app.js",
  "scripts": {
    "start": "node src/app.js",
    "dev": "node --watch src/app.js"
  },
  "dependencies": {
    "express": "^4.18.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

- [ ] **Step 2: 安装依赖**

```bash
cd server && npm install
```

期望：`node_modules/express` 存在，无报错。

- [ ] **Step 3: 创建 `server/src/store.js`**

```js
'use strict';

const store = {
  // Map<partner_device_code, { user_code, app_key, app_secret, seller_device_code, app_name, status, created_at }>
  partnerSessions: new Map(),
  // Map<device_code, { user_code, app_key, access_token, status, created_at }>
  sellerSessions: new Map(),
  // Map<app_key, { app_key, app_name, created_at }>
  apps: new Map(),
  // Array<{ id, name, price, stock, created_at }>
  products: [],
  // Set<express.Response> — active SSE connections
  sseClients: new Set(),
};

module.exports = store;
```

- [ ] **Step 4: 验证 store 可 require**

```bash
cd server && node -e "const s = require('./src/store'); console.log(Object.keys(s))"
```

期望输出：`[ 'partnerSessions', 'sellerSessions', 'apps', 'products', 'sseClients' ]`

- [ ] **Step 5: Commit**

```bash
git add server/package.json server/package-lock.json server/src/store.js
git commit -m "feat(server): initialize package and in-memory store"
```

---

### Task 2：Server auth 路由（5 个接口）

**Files:**
- Create: `server/src/routes/auth.js`

接口说明：
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/auth/partner/device` | CLI 请求 partner_device_code + user_code |
| GET  | `/auth/partner/token`  | CLI 轮询取 app_key + app_secret + seller_device_code |
| POST | `/auth/partner/approve`| 浏览器提交「创建 App」表单 |
| GET  | `/auth/seller/token`   | CLI 轮询取 access_token |
| POST | `/auth/seller/approve` | 浏览器点「授权」 |

- [ ] **Step 1: 创建 `server/src/routes/auth.js`**

```js
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
  if (session.status !== 'approved') return res.status(202).json({ status: 'pending' });

  const { app_key, app_secret, seller_device_code } = session;
  session.app_secret = null; // 不长期保留 app_secret
  res.json({ app_key, app_secret, seller_device_code });
});

// POST /auth/partner/approve
// 浏览器提交 App 名称；Server 创建 app 和 seller session，返回 seller_user_code 供浏览器跳转
router.post('/partner/approve', (req, res) => {
  const { user_code, app_name } = req.body;

  let partnerKey = null;
  for (const [code, s] of store.partnerSessions) {
    if (s.user_code === user_code) { partnerKey = code; break; }
  }
  if (!partnerKey) return res.status(404).json({ error: 'session_not_found' });

  const app_key = 'app_' + crypto.randomBytes(8).toString('hex');
  const app_secret = crypto.randomBytes(32).toString('hex');

  store.apps.set(app_key, { app_key, app_name, created_at: Date.now() });

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
  session.app_name = app_name;
  session.status = 'approved';

  res.json({ ok: true, app_key, app_name, seller_user_code });
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
```

- [ ] **Step 2: 快速冒烟（需要先有 app.js，见 Task 4）；先跳过，Task 4 后一起验证**

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/auth.js
git commit -m "feat(server): add Device Code auth routes (5 endpoints)"
```

---

### Task 3：Server products + SSE 路由

**Files:**
- Create: `server/src/routes/products.js`
- Create: `server/src/routes/events.js`

- [ ] **Step 1: 创建 `server/src/routes/products.js`**

```js
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
```

- [ ] **Step 2: 创建 `server/src/routes/events.js`**

```js
'use strict';

const express = require('express');
const store = require('../store');

const router = express.Router();

// GET /events  — SSE 长连接，推送实时操作日志和商品数据
router.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: 'connected', message: '已连接，等待 Agent 操作...' })}\n\n`);
  store.sseClients.add(res);

  req.on('close', () => store.sseClients.delete(res));
});

module.exports = router;
```

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/products.js server/src/routes/events.js
git commit -m "feat(server): add products CRUD and SSE broadcast"
```

---

### Task 4：Server app.js + 启动验证

**Files:**
- Create: `server/src/app.js`

- [ ] **Step 1: 创建 `server/src/app.js`**

```js
'use strict';

const express = require('express');
const path = require('path');

const app = express();

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// CORS（CLI 从 cli.wug.win 外请求时需要）
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use('/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/events', require('./routes/events'));
app.use(express.static(path.join(__dirname, '../public')));

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`TTS Demo Server → http://localhost:${PORT}`);
});
```

- [ ] **Step 2: 启动 Server**

```bash
cd server && npm start
```

期望：`TTS Demo Server → http://localhost:5000`

- [ ] **Step 3: 冒烟测试 auth 接口**

新开终端：
```bash
# 1. 请求 partner device
curl -s -X POST http://localhost:5000/auth/partner/device \
  -H "Content-Type: application/json" \
  -d '{"cli_id":"test"}' | jq .
# 期望：{ partner_device_code: "...", user_code: "DEMO-XXXX", expires_in: 600 }

# 把上面的 partner_device_code 存变量
PDC=$(curl -s -X POST http://localhost:5000/auth/partner/device \
  -H "Content-Type: application/json" -d '{"cli_id":"t"}' | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['partner_device_code']+'|'+d['user_code'])")
echo "PDC=$PDC"

# 2. 轮询（此时 pending）
CODE=$(echo $PDC | cut -d'|' -f1)
curl -s "http://localhost:5000/auth/partner/token?code=$CODE"
# 期望：HTTP 202 { "status": "pending" }

# 3. 模拟浏览器批准
UC=$(echo $PDC | cut -d'|' -f2)
curl -s -X POST http://localhost:5000/auth/partner/approve \
  -H "Content-Type: application/json" \
  -d "{\"user_code\":\"$UC\",\"app_name\":\"Test App\"}" | jq .
# 期望：{ ok: true, app_key: "app_...", app_name: "Test App", seller_user_code: "DEMO-YYYY" }

# 4. 再次轮询（此时 approved）
curl -s "http://localhost:5000/auth/partner/token?code=$CODE" | jq .
# 期望：{ app_key: "...", app_secret: "...", seller_device_code: "..." }
```

- [ ] **Step 4: 冒烟测试 products + SSE**

```bash
# 1. 在一个终端打开 SSE 监听
curl -s http://localhost:5000/events &

# 2. 先完成一次完整授权拿到 access_token（用上面 Task 4 Step 3 的流程）
# 假设已有 ACCESS_TOKEN 变量
ACCESS_TOKEN="tok_abc123"   # 替换成真实值

# 3. 创建商品
curl -s -X POST http://localhost:5000/api/products \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Test Product\",\"price\":99.9,\"stock\":50,\"access_token\":\"$ACCESS_TOKEN\"}" | jq .
# 期望：{ ok: true, product: { id: "prod_...", name: "Test Product", ... } }
# SSE 终端应出现 3 条 log 事件
```

- [ ] **Step 5: Commit**

```bash
git add server/src/app.js
git commit -m "feat(server): wire up Express app, all routes verified"
```

---

### Task 5：Server 静态页面 — app-create.html

**Files:**
- Create: `server/public/app-create.html`

- [ ] **Step 1: 创建 `server/public/app-create.html`**

```html
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TTS Demo — 创建 App</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f2f5;display:flex;align-items:center;justify-content:center;min-height:100vh}
    .card{background:white;border-radius:12px;padding:40px;width:420px;box-shadow:0 4px 24px rgba(0,0,0,.12)}
    .brand{font-size:12px;color:#999;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px}
    h1{font-size:22px;color:#111;margin-bottom:6px}
    .sub{color:#666;font-size:14px;margin-bottom:28px;line-height:1.5}
    label{display:block;font-size:13px;font-weight:500;color:#333;margin-bottom:6px}
    input{width:100%;padding:10px 14px;border:1.5px solid #e0e0e0;border-radius:8px;font-size:14px;outline:none;transition:border-color .15s}
    input:focus{border-color:#0066ff}
    .btn{width:100%;padding:12px;background:#0066ff;color:white;border:none;border-radius:8px;font-size:15px;font-weight:500;cursor:pointer;margin-top:20px;transition:background .15s}
    .btn:hover{background:#0052cc}
    .btn:disabled{background:#b3c9ff;cursor:not-allowed}
    .status{margin-top:14px;font-size:13px;color:#0066ff;text-align:center;min-height:20px}
    .err{color:#ff4d4f}
  </style>
</head>
<body>
<div class="card">
  <div class="brand">TTS Demo CLI</div>
  <h1>创建 App</h1>
  <p class="sub">为你的 AI Agent 创建一个 TTS Demo 应用。<br>创建完成后将自动跳转到授权页面。</p>
  <form id="form">
    <label for="appName">App 名称</label>
    <input type="text" id="appName" placeholder="例如：My AI Agent" required autofocus maxlength="50">
    <button class="btn" type="submit" id="btn">创建 App</button>
  </form>
  <div class="status" id="status"></div>
</div>
<script>
  const params = new URLSearchParams(location.search);
  const userCode = params.get('code');
  if (!userCode) {
    document.getElementById('status').textContent = '❌ 缺少 code 参数，请通过 tts-demo auth login 打开此页面';
    document.getElementById('btn').disabled = true;
  }

  document.getElementById('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn');
    const status = document.getElementById('status');
    btn.disabled = true;
    status.className = 'status';
    status.textContent = '正在创建...';

    try {
      const res = await fetch('/auth/partner/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_code: userCode, app_name: document.getElementById('appName').value.trim() }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '创建失败');

      status.textContent = `✓ App 创建成功（${data.app_key}），正在跳转到授权页...`;
      setTimeout(() => {
        location.href = `/authorize.html?code=${data.seller_user_code}&app=${encodeURIComponent(data.app_name)}`;
      }, 800);
    } catch (err) {
      status.className = 'status err';
      status.textContent = '❌ ' + err.message;
      btn.disabled = false;
    }
  });
</script>
</body>
</html>
```

- [ ] **Step 2: 浏览器验证**

Server 运行中，访问 `http://localhost:5000/app-create.html?code=DEMO-TEST`，应看到创建 App 表单页面，样式正常。

- [ ] **Step 3: Commit**

```bash
git add server/public/app-create.html
git commit -m "feat(server): add app-create page"
```

---

### Task 6：Server 静态页面 — authorize.html

**Files:**
- Create: `server/public/authorize.html`

- [ ] **Step 1: 创建 `server/public/authorize.html`**

```html
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TTS Demo — 授权</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f2f5;display:flex;align-items:center;justify-content:center;min-height:100vh}
    .card{background:white;border-radius:12px;padding:40px;width:420px;box-shadow:0 4px 24px rgba(0,0,0,.12)}
    .brand{font-size:12px;color:#999;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px}
    h1{font-size:22px;color:#111;margin-bottom:6px}
    .sub{color:#666;font-size:14px;margin-bottom:28px;line-height:1.5}
    .app-name{font-weight:600;color:#0066ff}
    .scopes{background:#f6f8ff;border-radius:8px;padding:16px;margin-bottom:24px}
    .scopes h3{font-size:13px;color:#666;margin-bottom:10px}
    .scope-item{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:14px;color:#333}
    .scope-item::before{content:"✓";color:#52c41a;font-weight:600}
    .btn{width:100%;padding:12px;border:none;border-radius:8px;font-size:15px;font-weight:500;cursor:pointer;transition:background .15s}
    .btn-primary{background:#52c41a;color:white}
    .btn-primary:hover{background:#389e0d}
    .btn-primary:disabled{background:#b7eb8f;cursor:not-allowed}
    .status{margin-top:14px;font-size:13px;text-align:center;min-height:20px;color:#52c41a}
    .success-icon{font-size:48px;text-align:center;margin-bottom:16px}
    .hidden{display:none}
  </style>
</head>
<body>
<div class="card">
  <div id="auth-view">
    <div class="brand">TTS Demo CLI</div>
    <h1>授权请求</h1>
    <p class="sub"><span class="app-name" id="app-name">应用</span> 请求以下权限访问你的 TTS Demo Shop：</p>
    <div class="scopes">
      <h3>请求权限</h3>
      <div class="scope-item">products.read — 读取商品信息</div>
      <div class="scope-item">products.write — 创建和修改商品</div>
    </div>
    <button class="btn btn-primary" id="auth-btn" onclick="doAuthorize()">授权</button>
    <div class="status" id="status"></div>
  </div>
  <div id="success-view" class="hidden">
    <div class="success-icon">✅</div>
    <h1 style="text-align:center;margin-bottom:8px">授权成功</h1>
    <p style="text-align:center;color:#666;font-size:14px">你已成功授权，可以关闭此窗口。<br>CLI 将自动完成登录。</p>
  </div>
</div>
<script>
  const params = new URLSearchParams(location.search);
  const userCode = params.get('code');
  const appName = params.get('app') || '应用';
  document.getElementById('app-name').textContent = appName;

  if (!userCode) {
    document.getElementById('status').textContent = '❌ 缺少 code 参数';
    document.getElementById('auth-btn').disabled = true;
  }

  async function doAuthorize() {
    const btn = document.getElementById('auth-btn');
    const status = document.getElementById('status');
    btn.disabled = true;
    status.textContent = '处理中...';

    try {
      const res = await fetch('/auth/seller/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_code: userCode }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || '授权失败');

      document.getElementById('auth-view').classList.add('hidden');
      document.getElementById('success-view').classList.remove('hidden');
    } catch (err) {
      status.textContent = '❌ ' + err.message;
      btn.disabled = false;
    }
  }
</script>
</body>
</html>
```

- [ ] **Step 2: 浏览器验证**

访问 `http://localhost:5000/authorize.html?code=DEMO-TEST&app=My%20Agent`，应看到授权页面，权限列表和按钮样式正常。

- [ ] **Step 3: Commit**

```bash
git add server/public/authorize.html
git commit -m "feat(server): add authorize page"
```

---

### Task 7：Server 静态页面 — index.html（仪表盘）

**Files:**
- Create: `server/public/index.html`

- [ ] **Step 1: 创建 `server/public/index.html`**

```html
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TTS Demo — 操作监控</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d0f14;color:#e0e0e0;height:100vh;display:flex;flex-direction:column}
    .header{background:#161b22;border-bottom:1px solid #30363d;padding:12px 20px;display:flex;align-items:center;justify-content:space-between}
    .header-left{display:flex;align-items:center;gap:12px}
    .logo{font-size:15px;font-weight:600;color:#e0e0e0}
    .badge{display:flex;align-items:center;gap:5px;background:#1a2f1a;color:#52c41a;font-size:11px;padding:3px 10px;border-radius:10px}
    .dot{width:6px;height:6px;border-radius:50%;background:#52c41a;animation:pulse 2s infinite}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;flex:1;background:#30363d;overflow:hidden}
    .panel{background:#0d0f14;display:flex;flex-direction:column;overflow:hidden}
    .panel-header{padding:10px 16px;background:#161b22;border-bottom:1px solid #30363d;font-size:13px;font-weight:500;color:#8b949e;letter-spacing:.5px;text-transform:uppercase}
    .log-area{flex:1;overflow-y:auto;padding:12px 16px;font-family:'SF Mono',Monaco,'Cascadia Code',monospace;font-size:12.5px;line-height:1.6}
    .log-line{display:flex;gap:8px;margin-bottom:2px}
    .log-time{color:#484f58;flex-shrink:0}
    .log-msg{color:#cdd9e5}
    .log-success .log-msg{color:#56d364}
    .log-connect .log-msg{color:#58a6ff}
    .product-list{flex:1;overflow-y:auto}
    .product-row{display:grid;grid-template-columns:1fr 2fr 1fr 1fr;padding:10px 16px;border-bottom:1px solid #21262d;font-size:13px;transition:background .1s}
    .product-row:hover{background:#161b22}
    .product-row.header{background:#161b22;font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;font-weight:500}
    .price{color:#56d364}
    .prod-id{color:#8b949e;font-family:monospace;font-size:11px}
    .empty{flex:1;display:flex;align-items:center;justify-content:center;color:#484f58;font-size:13px}
  </style>
</head>
<body>
<div class="header">
  <div class="header-left">
    <div class="logo">TTS Demo — Agent 操作监控</div>
    <div class="badge"><span class="dot"></span> 实时</div>
  </div>
  <div style="font-size:12px;color:#484f58" id="conn-status">连接中...</div>
</div>
<div class="grid">
  <div class="panel">
    <div class="panel-header">Agent 操作日志</div>
    <div class="log-area" id="logs"></div>
  </div>
  <div class="panel">
    <div class="panel-header">商品列表</div>
    <div id="product-panel">
      <div class="empty" id="empty-msg">暂无商品，等待 Agent 创建...</div>
      <div id="table-wrap" style="display:none">
        <div class="product-row header"><span>ID</span><span>名称</span><span>价格</span><span>库存</span></div>
        <div id="product-rows"></div>
      </div>
    </div>
  </div>
</div>
<script>
  const logsEl = document.getElementById('logs');
  const rowsEl = document.getElementById('product-rows');
  const emptyEl = document.getElementById('empty-msg');
  const tableWrap = document.getElementById('table-wrap');
  const connStatus = document.getElementById('conn-status');
  let productCount = 0;

  function addLog(msg, cls = '') {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const div = document.createElement('div');
    div.className = 'log-line ' + cls;
    div.innerHTML = `<span class="log-time">[${time}]</span><span class="log-msg">${msg}</span>`;
    logsEl.appendChild(div);
    logsEl.scrollTop = logsEl.scrollHeight;
  }

  function addProduct(p) {
    emptyEl.style.display = 'none';
    tableWrap.style.display = 'block';
    const row = document.createElement('div');
    row.className = 'product-row';
    row.innerHTML = `<span class="prod-id">${p.id}</span><span>${p.name}</span><span class="price">¥${p.price.toFixed(2)}</span><span>${p.stock}</span>`;
    rowsEl.insertBefore(row, rowsEl.firstChild);
    productCount++;
  }

  // SSE
  const es = new EventSource('/events');
  es.onopen = () => { connStatus.textContent = '● 已连接'; connStatus.style.color = '#56d364'; };
  es.onerror = () => { connStatus.textContent = '○ 连接断开'; connStatus.style.color = '#f85149'; };
  es.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.type === 'connected') { addLog(data.message, 'log-connect'); return; }
    if (data.type === 'log') {
      const isSuccess = data.message.includes('✓') || data.message.includes('成功');
      addLog(data.message, isSuccess ? 'log-success' : '');
      return;
    }
    if (data.type === 'product') { addProduct(data.product); }
  };

  // 加载已有商品
  fetch('/api/products').then(r => r.json()).then(({ products }) => products.forEach(addProduct));
</script>
</body>
</html>
```

- [ ] **Step 2: 浏览器验证**

访问 `http://localhost:5000`，应看到深色仪表盘，左侧日志区，右侧商品列表区，顶部「已连接」绿色状态。

- [ ] **Step 3: Commit**

```bash
git add server/public/index.html
git commit -m "feat(server): add realtime dashboard with SSE logs and product table"
```

---

## Part 2：CLI

### Task 8：初始化 CLI 包 + config + keychain

**Files:**
- Create: `cli/package.json`
- Create: `cli/src/lib/config.js`
- Create: `cli/src/lib/keychain.js`

- [ ] **Step 1: 创建 `cli/package.json`**

```json
{
  "name": "tts-demo-cli",
  "version": "0.1.0",
  "description": "TTS AgentReady CLI Demo",
  "main": "src/index.js",
  "bin": {
    "tts-demo": "./src/index.js"
  },
  "scripts": {
    "start": "node src/index.js"
  },
  "files": [
    "src/"
  ],
  "dependencies": {
    "commander": "^12.0.0",
    "keytar": "^7.9.0",
    "open": "^8.4.2",
    "adm-zip": "^0.5.10"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

- [ ] **Step 2: 安装依赖**

```bash
cd cli && npm install
```

期望：`node_modules/commander`, `node_modules/keytar`, `node_modules/open`, `node_modules/adm-zip` 均存在。

> **注意：** `keytar` 需要 native 编译。macOS 需要 Xcode Command Line Tools (`xcode-select --install`)。若编译失败 keychain.js 会自动降级到文件存储。

- [ ] **Step 3: 创建 `cli/src/lib/config.js`**

```js
'use strict';

module.exports = {
  // 可通过环境变量覆盖（本地调试用）
  SERVER_URL: process.env.TTS_DEMO_SERVER || 'https://cli.wug.win',
  SKILLS_REPO: 'wugekelvin04-sys/tts-demo-skills',
  SKILLS_BRANCH: 'main',
};
```

- [ ] **Step 4: 创建 `cli/src/lib/keychain.js`**

```js
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const SERVICE = 'tts-demo-cli';
const FALLBACK_DIR = path.join(os.homedir(), '.tts-demo');
const FALLBACK_FILE = path.join(FALLBACK_DIR, 'credentials.json');

let keytar;
try { keytar = require('keytar'); } catch {}

function readFallback() {
  try { return JSON.parse(fs.readFileSync(FALLBACK_FILE, 'utf8')); } catch { return {}; }
}

function writeFallback(data) {
  fs.mkdirSync(FALLBACK_DIR, { recursive: true });
  fs.writeFileSync(FALLBACK_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

async function set(key, value) {
  if (keytar) {
    await keytar.setPassword(SERVICE, key, value);
  } else {
    const data = readFallback();
    data[key] = value;
    writeFallback(data);
  }
}

async function get(key) {
  if (keytar) {
    return keytar.getPassword(SERVICE, key);
  }
  return readFallback()[key] || null;
}

module.exports = { set, get };
```

- [ ] **Step 5: 验证 keychain 基本读写**

```bash
cd cli && node -e "
const kc = require('./src/lib/keychain');
(async () => {
  await kc.set('test_key', 'hello');
  const v = await kc.get('test_key');
  console.log('keychain ok:', v === 'hello');
})();
"
```

期望输出：`keychain ok: true`

- [ ] **Step 6: Commit**

```bash
git add cli/package.json cli/package-lock.json cli/src/lib/config.js cli/src/lib/keychain.js
git commit -m "feat(cli): initialize package, config, keychain"
```

---

### Task 9：CLI poller

**Files:**
- Create: `cli/src/lib/poller.js`

- [ ] **Step 1: 创建 `cli/src/lib/poller.js`**

```js
'use strict';

// 轮询 url 直到返回 HTTP 200；202 表示 pending 继续等，其他状态码抛错
async function poll(url, { interval = 2000, timeout = 600_000 } = {}) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    const res = await fetch(url);

    if (res.status === 200) {
      return res.json();
    }

    if (res.status === 202) {
      await new Promise(r => setTimeout(r, interval));
      continue;
    }

    if (res.status === 410) {
      throw new Error('会话已过期，请重新运行 tts-demo auth login');
    }

    const body = await res.text();
    throw new Error(`服务器返回错误 ${res.status}: ${body}`);
  }

  throw new Error('等待超时，请重新运行 tts-demo auth login');
}

module.exports = { poll };
```

- [ ] **Step 2: 验证**

```bash
cd cli && node -e "
const { poll } = require('./src/lib/poller');
// 用一个会立刻返回 200 的公共接口验证基本逻辑
console.log('poller module loaded ok');
"
```

期望：`poller module loaded ok`（不报 require 错误即可）

- [ ] **Step 3: Commit**

```bash
git add cli/src/lib/poller.js
git commit -m "feat(cli): add Device Code poller"
```

---

### Task 10：CLI auth login 命令

**Files:**
- Create: `cli/src/commands/auth.js`

- [ ] **Step 1: 创建 `cli/src/commands/auth.js`**

```js
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
```

- [ ] **Step 2: 集成验证（需要 Server 在 5000 端口运行）**

```bash
# Server 启动（另一个终端）
cd server && npm start

# CLI 测试（使用本地 Server）
cd cli && TTS_DEMO_SERVER=http://localhost:5000 node src/index.js auth login
```

期望流程：
1. 浏览器自动打开 `http://localhost:5000/app-create.html?code=DEMO-XXXX`
2. 填写 App 名称，点「创建 App」
3. 浏览器自动跳转到授权页
4. 点「授权」
5. CLI 终端输出 `✅ 登录成功！` 并显示 app_key、shop_id、token 前缀

- [ ] **Step 3: Commit**

```bash
git add cli/src/commands/auth.js
git commit -m "feat(cli): implement auth login dual-path Device Code flow"
```

---

### Task 11：CLI skills install 命令

**Files:**
- Create: `cli/src/commands/skills.js`

- [ ] **Step 1: 创建 `cli/src/commands/skills.js`**

```js
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const AdmZip = require('adm-zip');
const config = require('../lib/config');

const SKILLS_DIR = path.join(os.homedir(), '.tts-demo', 'skills');
const CLAUDE_SKILLS_LINK = path.join(os.homedir(), '.claude', 'skills', 'tts-demo');

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'tts-demo-cli/0.1.0' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return download(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`下载失败：HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function installSkills() {
  const zipUrl = `https://github.com/${config.SKILLS_REPO}/archive/refs/heads/${config.SKILLS_BRANCH}.zip`;
  console.log(`\n📦 正在从 GitHub 下载 Skills...`);
  console.log(`   ${zipUrl}\n`);

  const buf = await download(zipUrl);
  const zip = new AdmZip(buf);
  const entries = zip.getEntries();

  // 清空目标目录并重新写入
  fs.rmSync(SKILLS_DIR, { recursive: true, force: true });
  fs.mkdirSync(SKILLS_DIR, { recursive: true });

  const installed = [];
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (!entry.entryName.endsWith('.md')) continue;
    const filename = path.basename(entry.entryName);
    fs.writeFileSync(path.join(SKILLS_DIR, filename), entry.getData());
    installed.push(filename.replace('.md', ''));
  }

  if (installed.length === 0) {
    throw new Error('Skills 仓库中未找到 .md 文件');
  }

  // 创建 symlink 到 ~/.claude/skills/tts-demo
  fs.mkdirSync(path.dirname(CLAUDE_SKILLS_LINK), { recursive: true });
  try { fs.rmSync(CLAUDE_SKILLS_LINK, { recursive: true, force: true }); } catch {}
  fs.symlinkSync(SKILLS_DIR, CLAUDE_SKILLS_LINK);

  console.log(`✓ Skills 已安装到 ${SKILLS_DIR}`);
  console.log(`✓ Symlink: ${CLAUDE_SKILLS_LINK}\n`);
  console.log(`  已安装 ${installed.length} 个 Skills:`);
  for (const name of installed) console.log(`  - ${name}`);
  console.log('\n  重启 Claude Code 后即可使用\n');
}

module.exports = { installSkills };
```

- [ ] **Step 2: 验证（Skills 仓库需要有 .md 文件）**

```bash
cd cli && node -e "require('./src/commands/skills').installSkills().catch(console.error)"
```

期望：
- `~/.tts-demo/skills/` 目录有 `.md` 文件
- `~/.claude/skills/tts-demo` symlink 指向上面目录
- 终端列出已安装 skills

验证 symlink：
```bash
ls -la ~/.claude/skills/tts-demo
# 期望：tts-demo -> /Users/<you>/.tts-demo/skills
```

- [ ] **Step 3: Commit**

```bash
git add cli/src/commands/skills.js
git commit -m "feat(cli): implement skills install with GitHub zip download and symlink"
```

---

### Task 12：CLI product create 命令

**Files:**
- Create: `cli/src/commands/product.js`

- [ ] **Step 1: 创建 `cli/src/commands/product.js`**

```js
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
```

- [ ] **Step 2: 验证（需要 Server 运行且已登录）**

```bash
cd cli && TTS_DEMO_SERVER=http://localhost:5000 node src/index.js product create \
  --name "Nike Air Max" --price 299 --stock 100
```

期望：
- 终端显示 `✅ 商品创建成功！` 和商品详情
- 浏览器仪表盘 `http://localhost:5000` 实时出现 3 条操作日志和新商品行

- [ ] **Step 3: Commit**

```bash
git add cli/src/commands/product.js
git commit -m "feat(cli): implement product create command"
```

---

### Task 13：CLI 入口 index.js

**Files:**
- Create: `cli/src/index.js`

- [ ] **Step 1: 创建 `cli/src/index.js`**

```js
#!/usr/bin/env node
'use strict';

const { Command } = require('commander');
const { authLogin } = require('./commands/auth');
const { installSkills } = require('./commands/skills');
const { productCreate } = require('./commands/product');

const program = new Command();

program
  .name('tts-demo')
  .description('TTS AgentReady CLI Demo — TikTok Shop AI Agent 工具')
  .version('0.1.0');

// tts-demo auth login
const auth = program.command('auth').description('认证相关命令');
auth
  .command('login')
  .description('登录并授权（双链路 Device Code 流程）')
  .action(() => authLogin().catch(err => { console.error('❌', err.message); process.exit(1); }));

// tts-demo skills install
const skills = program.command('skills').description('Skills 管理');
skills
  .command('install')
  .description('从 GitHub 下载 Skills 并安装到 Claude Code')
  .action(() => installSkills().catch(err => { console.error('❌', err.message); process.exit(1); }));

// tts-demo product create
const product = program.command('product').description('商品管理');
product
  .command('create')
  .description('创建商品（供 Claude Code Agent 调用）')
  .requiredOption('--name <name>', '商品名称')
  .requiredOption('--price <price>', '价格（元）')
  .requiredOption('--stock <stock>', '库存数量')
  .action(opts => productCreate(opts).catch(err => { console.error('❌', err.message); process.exit(1); }));

program.parse(process.argv);
```

- [ ] **Step 2: 添加执行权限**

```bash
chmod +x cli/src/index.js
```

- [ ] **Step 3: 验证帮助信息**

```bash
cd cli && node src/index.js --help
```

期望输出（含三个命令组）：
```
Usage: tts-demo [options] [command]

TTS AgentReady CLI Demo — TikTok Shop AI Agent 工具

Options:
  -V, --version   output the version number
  -h, --help      display help for command

Commands:
  auth            认证相关命令
  skills          Skills 管理
  product         商品管理
  help [command]  display help for command
```

```bash
cd cli && node src/index.js product create --help
```

期望：显示 `--name`, `--price`, `--stock` 三个必填选项。

- [ ] **Step 4: 本地 link（本机测试 tts-demo 命令）**

```bash
cd cli && npm link
tts-demo --help
```

- [ ] **Step 5: Commit**

```bash
git add cli/src/index.js
git commit -m "feat(cli): add entry point with auth/skills/product commands"
```

---

## Part 3：Skills 文件

### Task 14：编写 Skills 文件并推送到 tts-demo-skills 仓库

**Files（在 tts-demo-skills 仓库）:**
- Create: `getting-started.md`
- Create: `auth-guide.md`
- Create: `create-product.md`

- [ ] **Step 1: 在本地克隆 tts-demo-skills 仓库**

```bash
cd ~ && git clone https://github.com/wugekelvin04-sys/tts-demo-skills.git
cd tts-demo-skills
```

- [ ] **Step 2: 创建 `getting-started.md`**

```markdown
---
name: tts-getting-started
description: 介绍 TTS Demo CLI 是什么，如何安装，以及有哪些可用命令。当用户询问 TTS Demo CLI 的功能、如何开始使用时调用。
---

# TTS Demo CLI — 快速入门

TTS Demo CLI (`tts-demo`) 是一个 TikTok Shop AgentReady CLI 原型，让 AI Agent 无需处理签名和 token 就能调用 TikTok Shop 开放能力。

## 安装

```bash
npm install -g github:wugekelvin04-sys/tts-demo-cli
```

## 可用命令

| 命令 | 说明 |
|------|------|
| `tts-demo auth login` | 登录并授权（双链路 Device Code 流程） |
| `tts-demo skills install` | 从 GitHub 安装 Skills 到 Claude Code |
| `tts-demo product create` | 创建商品 |

## 首次使用流程

1. 运行 `tts-demo auth login`
2. 浏览器自动打开，填写 App 名称并创建
3. 页面自动跳转授权，点「授权」
4. CLI 完成登录，凭证存入本地 Keychain
5. 使用 `tts-demo product create` 等命令

## 服务端监控

访问 https://cli.wug.win 可实时查看 Agent 的操作日志和商品列表。
```

- [ ] **Step 3: 创建 `auth-guide.md`**

```markdown
---
name: tts-auth-guide
description: 详细说明 tts-demo auth login 的完整步骤和注意事项。当用户询问如何登录、授权流程，或遇到登录问题时调用。
---

# TTS Demo CLI — 授权指南

## 运行登录命令

```bash
tts-demo auth login
```

## 流程说明

1. **CLI 启动** → 自动打开浏览器到创建 App 页面
2. **创建 App** → 填写 App 名称，点「创建 App」
3. **自动跳转** → 浏览器自动进入授权页（无需手动操作）
4. **授权** → 确认权限范围，点「授权」
5. **完成** → CLI 终端显示登录成功，凭证自动保存

## 凭证存储

登录完成后，以下凭证存入系统 Keychain（或 `~/.tts-demo/credentials.json`）：
- `app_key` — App 标识
- `app_secret` — App 密钥（本地签名用，不上网）
- `access_token` — 业务调用凭证
- `shop_id` — 店铺 ID

## 重新登录

直接再次运行 `tts-demo auth login` 即可，新凭证会覆盖旧的。

## 排查

- 浏览器未自动打开：手动访问终端显示的 URL
- 服务器连接失败：确认 https://cli.wug.win 可访问
```

- [ ] **Step 4: 创建 `create-product.md`**

```markdown
---
name: tts-create-product
description: 调用 tts-demo product create 命令创建商品。当用户要求创建商品、上架商品、新增产品时使用此 skill。
---

# 创建商品

使用以下命令创建商品：

```bash
tts-demo product create --name "<商品名称>" --price <价格> --stock <库存>
```

## 参数说明

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `--name` | string | 是 | 商品名称 |
| `--price` | number | 是 | 价格，单位元（支持小数） |
| `--stock` | number | 是 | 库存数量（整数） |

## 示例

```bash
tts-demo product create --name "Nike Air Max 2024" --price 899.00 --stock 50
```

## 前提条件

必须先完成授权：
```bash
tts-demo auth login
```

## 操作可见性

命令执行后，可在 https://cli.wug.win 看到实时操作日志：
- Agent 发起请求
- Token 验证
- 商品创建成功 + 商品 ID
```

- [ ] **Step 5: 提交并推送**

```bash
git add getting-started.md auth-guide.md create-product.md
git commit -m "feat: add 3 Claude Code skills for tts-demo-cli"
git push origin main
```

- [ ] **Step 6: 验证 Skills 可安装**

```bash
cd /path/to/tts-demo-cli
cd cli && node src/index.js skills install
# 期望：3 个 skill 文件安装成功，symlink 创建
```

---

## Part 4：端到端验证

### Task 15：完整链路测试

- [ ] **Step 1: 启动 Server**

```bash
cd server && npm start
# 确认: TTS Demo Server → http://localhost:5000
```

- [ ] **Step 2: 打开仪表盘**

浏览器访问 `http://localhost:5000`，确认：
- 深色界面加载正常
- 右上角显示「已连接」绿色状态
- 日志区显示「已连接，等待 Agent 操作...」

- [ ] **Step 3: 运行 auth login**

```bash
cd cli && TTS_DEMO_SERVER=http://localhost:5000 node src/index.js auth login
```

按流程在浏览器完成 App 创建和授权，确认 CLI 显示「✅ 登录成功！」

- [ ] **Step 4: 用 Claude Code 测试完整 Agent 链路**

在 Claude Code 中（已安装 Skills 并重启）：

> 帮我在 TTS Demo 里创建一个商品，名称「测试商品 001」，价格 99 元，库存 100 件

期望 CC 调用：
```bash
tts-demo product create --name "测试商品 001" --price 99 --stock 100
```

确认：
- CLI 输出「✅ 商品创建成功！」
- 仪表盘实时出现 3 条操作日志
- 商品列表出现新行

- [ ] **Step 5: 验证 GitHub 直装**

在另一台机器（或用 `npm unlink` 卸载本地 link 后）：

```bash
npm install -g github:wugekelvin04-sys/tts-demo-cli
tts-demo --version
# 期望：0.1.0
```

---

## 完成清单

- [ ] Server 在 5000 端口运行，`cli.wug.win` 可访问
- [ ] `tts-demo auth login` 完整双链路流程可用
- [ ] `tts-demo skills install` 下载并 symlink 到 `~/.claude/skills/tts-demo`
- [ ] `tts-demo product create` Claude Code 可调用，仪表盘实时展示
- [ ] `npm install -g github:wugekelvin04-sys/tts-demo-cli` 在新机器可安装
