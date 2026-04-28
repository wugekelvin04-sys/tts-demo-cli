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
