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
