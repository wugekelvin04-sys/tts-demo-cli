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
