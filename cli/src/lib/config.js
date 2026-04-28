'use strict';

module.exports = {
  // 可通过环境变量覆盖（本地调试用）
  SERVER_URL: process.env.TTS_DEMO_SERVER || 'https://cli.wug.win',
  SKILLS_REPO: 'wugekelvin04-sys/tts-demo-skills',
  SKILLS_BRANCH: 'main',
};
