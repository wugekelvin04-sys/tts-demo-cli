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
