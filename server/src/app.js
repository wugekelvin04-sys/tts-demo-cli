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
