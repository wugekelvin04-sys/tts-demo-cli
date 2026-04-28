'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const AdmZip = require('adm-zip');
const config = require('../lib/config');

const SKILLS_DIR = path.join(os.homedir(), '.tts-demo', 'skills');
const CLAUDE_SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');

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

  // 清空并重建本地 skills 目录
  fs.rmSync(SKILLS_DIR, { recursive: true, force: true });
  fs.mkdirSync(SKILLS_DIR, { recursive: true });

  // 提取 <skill-name>/SKILL.md 结构（zip 内顶层目录是仓库名，跳过它）
  const skillDirs = new Set();
  for (const entry of entries) {
    // entryName 格式: tts-demo-skills-main/<skill-dir>/SKILL.md
    const parts = entry.entryName.split('/');
    if (parts.length < 3) continue;              // 跳过顶层目录本身
    if (!entry.entryName.endsWith('SKILL.md')) continue;

    const skillName = parts[1];                  // e.g. tts-create-product
    const skillDir = path.join(SKILLS_DIR, skillName);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), entry.getData());
    skillDirs.add(skillName);
  }

  if (skillDirs.size === 0) {
    throw new Error('Skills 仓库中未找到 <skill-name>/SKILL.md 文件');
  }

  // 为每个 skill 目录在 ~/.claude/skills/ 下创建 symlink
  fs.mkdirSync(CLAUDE_SKILLS_DIR, { recursive: true });
  for (const skillName of skillDirs) {
    const link = path.join(CLAUDE_SKILLS_DIR, skillName);
    const target = path.join(SKILLS_DIR, skillName);
    try { fs.rmSync(link, { recursive: true, force: true }); } catch {}
    fs.symlinkSync(target, link);
  }

  console.log(`✓ Skills 已安装到 ${SKILLS_DIR}`);
  console.log(`✓ Symlinks 已创建到 ${CLAUDE_SKILLS_DIR}\n`);
  console.log(`  已安装 ${skillDirs.size} 个 Skills:`);
  for (const name of skillDirs) console.log(`  - ${name}`);
  console.log('\n  重启 Claude Code 后即可使用\n');
}

module.exports = { installSkills };
