# TTS Demo CLI — 原型设计文档

**日期：** 2026-04-28  
**状态：** 待实现  
**背景文档：**
- TTS AgentReadyCLI Phase 0 Tech Design
- TTS AgentReadyCLI Phase 0 Security Review

---

## 1. 目标

构建一个可运行的原型，演示 TTS AgentReadyCLI 的核心链路：

1. CLI 安装 → `tts-demo auth login`（双链路 Device Code 授权）→ 凭证存 Keychain
2. `tts-demo skills install` → 从 GitHub 拉取 Claude Code Skills → symlink 到 `~/.claude/skills/`
3. Claude Code 读取 skill → 用户说「创建商品」→ CC 调用 `tts-demo product create` → 服务端实时展示操作日志

---

## 2. 仓库结构

| 仓库 | 地址 | 用途 |
|------|------|------|
| CLI + Server | `github.com/wugekelvin04-sys/tts-demo-cli` | CLI npm 包 + 本地 Server 代码 |
| Skills | `github.com/wugekelvin04-sys/tts-demo-skills` | 3 个 Claude Code skill 文件 |

```
tts-demo-cli/
├── cli/                        # npm 包，供别人安装
│   ├── src/
│   │   ├── commands/
│   │   │   ├── auth.js         # tts-demo auth login
│   │   │   ├── skills.js       # tts-demo skills install
│   │   │   └── product.js      # tts-demo product create
│   │   ├── lib/
│   │   │   ├── keychain.js     # keytar 封装，读写 Keychain
│   │   │   ├── poller.js       # Device Code 轮询逻辑
│   │   │   └── config.js       # 常量：Server URL、Skills 仓库地址等
│   │   └── index.js            # CLI 入口，commander.js
│   └── package.json            # bin: { "tts-demo": "./src/index.js" }
│
└── server/                     # 跑在本机 5000 端口，不发包
    ├── src/
    │   ├── routes/
    │   │   ├── auth.js         # Device Code 流程接口
    │   │   ├── products.js     # 模拟商品 CRUD
    │   │   └── events.js       # SSE 推送 Agent 操作日志
    │   ├── store.js            # 内存存储（apps、sessions、products）
    │   └── app.js              # Express 入口
    ├── public/
    │   ├── index.html          # 主界面（操作日志 + 商品列表）
    │   ├── app-create.html     # 创建 App 页面
    │   └── authorize.html      # 授权确认页面
    └── package.json
```

---

## 3. 安装方式

### 别人安装 CLI（GitHub 直装，无需 npm 账号）

```bash
npm install -g github:wugekelvin04-sys/tts-demo-cli
```

### 未来发布到 npm 后

```bash
npm install -g tts-demo-cli
```

---

## 4. CLI 命令总览

```
tts-demo auth login           # 双链路 Device Code 授权
tts-demo skills install       # 从固定 GitHub 仓库拉 skills，symlink 到 ~/.claude/skills/
tts-demo product create       # 创建商品（供 Claude Code 调用）
```

---

## 5. Auth Login 双链路流程

参考设计文档「3.3 OAuth Workflow — 双链路时序」。

### 时序

```
tts-demo auth login
  │
  ├─1─▶ POST https://cli.wug.win/auth/partner/device
  │      Body: { cli_id: "<uuid>" }
  │      Response: { partner_device_code, user_code, expires_in: 600 }
  │
  ├─2─▶ 打开浏览器: https://cli.wug.win/app/create?code=<user_code>
  │      终端显示: "正在打开浏览器，请在网页上创建 App..."
  │
  │      [浏览器侧]
  │      用户填写 App 名称 → 点「创建 App」
  │      Server: 生成 app_key / app_secret（模拟），写内存
  │      Server: 立刻生成新一对 device_code + user_code（Seller 授权用）
  │      页面: 自动跳转到 /authorize?code=<new_user_code>
  │
  ├─3─▶ CLI 轮询 GET /auth/partner/token?code=<partner_device_code>
  │      拿到 { app_key, app_secret }
  │      → 写 Keychain (service: "tts-demo", account: "app_key")
  │      → 写 Keychain (service: "tts-demo", account: "app_secret")
  │
  │      CLI 立刻发起: POST /auth/seller/device
  │      Body: { app_key, sign: HMAC(app_secret, canonical) }
  │      Response: { device_code, user_code }
  │      终端显示: "App 创建成功，等待授权..."
  │
  │      [浏览器侧 — 授权页已自动跳转]
  │      显示: "App <name> 请求以下权限：products.read, products.write"
  │      用户点「授权」
  │      Server: 生成 access_token，关联 device_code
  │
  └─4─▶ CLI 轮询 GET /auth/seller/token?code=<device_code>
         拿到 { access_token, shop_id }
         → 写 Keychain (service: "tts-demo", account: "access_token")
         终端显示: ✓ 登录成功！App: <name>, Shop: demo-shop
```

### 关键设计点

- `partner_device_code`：高熵，只在 CLI ↔ Server 之间流转，不出现在 URL
- `user_code`：低熵短码，拼入 URL 供浏览器使用
- 浏览器页面是同一窗口，创建 App 完成后**自动跳转**授权页，无需用户手动操作
- 凭证全部存本地 Keychain（`keytar` 库）
- 轮询间隔：2 秒，超时 10 分钟

---

## 6. Skills 安装

### 命令

```bash
tts-demo skills install
```

### 流程

1. 从 `github.com/wugekelvin04-sys/tts-demo-skills` 下载 zip（GitHub API）
2. 解压到 `~/.tts-demo/skills/`
3. 创建 symlink：`~/.claude/skills/tts-demo → ~/.tts-demo/skills/`
4. 终端输出：

```
✓ Skills 已下载到 ~/.tts-demo/skills/
✓ Symlink 已创建: ~/.claude/skills/tts-demo
  重启 Claude Code 后即可使用以下 skills:
  - tts-getting-started
  - tts-auth-guide
  - tts-create-product
```

### Skills 仓库内容（3 个文件）

**`getting-started.md`** — 介绍 tts-demo 是什么，安装方式，命令列表

**`auth-guide.md`** — auth login 完整步骤说明

**`create-product.md`** — 核心 skill，告诉 Claude Code 如何调用 `tts-demo product create`：

```markdown
---
name: tts-create-product
description: 当用户要求创建商品、上架商品、新增产品时使用此 skill
---

调用以下命令创建商品：

​```bash
tts-demo product create --name "商品名" --price 99.00 --stock 100
​```

参数说明：
- --name: 商品名称（必填）
- --price: 价格，单位元（必填）
- --stock: 库存数量（必填）

命令会调用 https://cli.wug.win/api/products 接口，
在服务端界面可实时看到操作日志。
```

---

## 7. Product Create 命令

### 调用方式（Claude Code 调用）

```bash
tts-demo product create --name "Nike Air Max" --price 299.00 --stock 100
```

### CLI 行为

1. 从 Keychain 读取 access_token，若无则提示先登录
2. POST `https://cli.wug.win/api/products`，Body: `{ name, price, stock, access_token }`
3. 终端输出：

```
→ 正在创建商品...
✓ 商品创建成功！
  ID:    prod_abc123
  名称:  Nike Air Max
  价格:  ¥299.00
  库存:  100
  时间:  2026-04-28 10:32:01
```

---

## 8. 服务端 + 实时界面

### 接口列表

| Method | Path | 说明 |
|--------|------|------|
| POST | `/auth/partner/device` | 请求 partner_device_code + user_code |
| GET | `/auth/partner/token` | CLI 轮询拿 app_key + app_secret |
| POST | `/auth/partner/approve` | 浏览器「创建 App」提交 |
| POST | `/auth/seller/device` | 请求 Seller 授权 device_code |
| GET | `/auth/seller/token` | CLI 轮询拿 access_token |
| POST | `/auth/seller/approve` | 浏览器「授权」点击 |
| POST | `/api/products` | CLI 创建商品 |
| GET | `/api/products` | 商品列表 |
| GET | `/events` | SSE 流，推送实时操作日志 |

### 界面页面（纯 HTML/JS）

| 路径 | 说明 |
|------|------|
| `/` | 主界面：实时操作日志（SSE）+ 商品列表 |
| `/app/create?code=<user_code>` | 创建 App 表单 |
| `/authorize?code=<user_code>` | 授权确认页 |

### 实时日志格式（SSE → 主界面）

```
[10:32:01] Agent 发起创建商品请求
[10:32:01] 验证 access_token... ✓
[10:32:02] 提交商品信息: "Nike Air Max" ¥299.00 库存:100
[10:32:02] 商品创建成功 → ID: prod_abc123
```

### 存储

内存存储（Server 重启后清空，原型够用）：

```js
store = {
  partnerSessions: Map,   // partner_device_code → { user_code, app_key, app_secret, status }
  sellerSessions:  Map,   // device_code → { user_code, app_key, access_token, status }
  products:        Array, // [{ id, name, price, stock, created_at }]
  sseClients:      Set,   // SSE 连接集合
}
```

---

## 9. 技术栈

| 层 | 技术 |
|----|------|
| CLI | Node.js 18+，`commander`，`keytar`，`open`（打开浏览器） |
| Server | Node.js 18+，`express`，SSE（原生，无额外库） |
| 前端 | 纯 HTML + CSS + Vanilla JS，无构建步骤 |
| 域名 | `cli.wug.win` → 本机 5000 端口 |

---

## 10. 资源清单

| 资源 | 状态 |
|------|------|
| GitHub: `tts-demo-cli` | 已创建 |
| GitHub: `tts-demo-skills` | 已创建 |
| npm 账号 | 待创建（暂用 GitHub 直装） |
| `cli.wug.win` → 5000 端口 | 你来配置 |
