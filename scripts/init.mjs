#!/usr/bin/env node
/**
 * wemp-operator 初始化配置脚本
 *
 * 支持两种模式：
 *   参数模式（AI 调用）: node init.mjs --app-id wx... --app-secret xxx
 *   交互模式（手动）:    node init.mjs
 */
import { createInterface } from 'node:readline';
import { existsSync, writeFileSync, mkdirSync, chmodSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILL_ROOT = join(__dirname, '..');
const CONFIG_DIR = join(SKILL_ROOT, 'config');
const CONFIG_PATH = join(CONFIG_DIR, 'wemp.json');

function parseArgs(args = process.argv.slice(2)) {
  const result = { _: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
      result[key] = value;
      if (value !== true) i++;
    } else {
      result._.push(args[i]);
    }
  }
  return result;
}

function output(success, data) {
  console.log(JSON.stringify(success ? { success: true, data } : { success: false, error: data }));
}

async function testConnection(appId, appSecret) {
  const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
  try {
    const data = await (await fetch(url)).json();
    if (data.errcode) {
      return { ok: false, error: `${data.errcode} - ${data.errmsg}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function saveConfig(appId, appSecret) {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  const config = { appId, appSecret };
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { encoding: 'utf-8' });

  try {
    chmodSync(CONFIG_PATH, 0o600);
  } catch {
    // Windows 不支持 chmod，忽略
  }

  return CONFIG_PATH;
}

/**
 * 参数模式：直接通过 --app-id 和 --app-secret 传入
 */
async function initWithArgs(args) {
  const appId = args.appId;
  const appSecret = args.appSecret;

  if (!appId || !appSecret) {
    output(false, '缺少参数，需要 --app-id 和 --app-secret');
    process.exit(1);
  }

  // 验证连接
  const result = await testConnection(appId, appSecret);

  if (!result.ok) {
    output(false, `凭据验证失败: ${result.error}`);
    process.exit(1);
  }

  const path = saveConfig(appId, appSecret);
  output(true, { message: '配置已保存', path, appId });
}

/**
 * 交互模式：手动输入
 */
async function initWithPrompt() {
  const colors = {
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    cyan: (s) => `\x1b[36m${s}\x1b[0m`,
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
    dim: (s) => `\x1b[2m${s}\x1b[0m`,
  };

  function prompt(rl, question) {
    return new Promise((resolve) => {
      rl.question(question, resolve);
    });
  }

  function promptSecret(question) {
    return new Promise((resolve) => {
      process.stdout.write(question);
      let value = '';

      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');

        const onData = (char) => {
          if (char === '\r' || char === '\n') {
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdin.removeListener('data', onData);
            process.stdout.write('\n');
            resolve(value);
          } else if (char === '\u0003') {
            process.stdout.write('\n');
            process.exit(1);
          } else if (char === '\u007f' || char === '\b') {
            if (value.length > 0) {
              value = value.slice(0, -1);
              process.stdout.write('\b \b');
            }
          } else {
            value += char;
            process.stdout.write('*');
          }
        };

        process.stdin.on('data', onData);
      } else {
        const rl = createInterface({ input: process.stdin, output: null, terminal: false });
        rl.once('line', (line) => {
          rl.close();
          resolve(line.trim());
        });
      }
    });
  }

  console.log(colors.bold('\n微信公众号配置初始化\n'));
  console.log('─'.repeat(50));
  console.log(`配置文件位置: ${colors.cyan(CONFIG_PATH)}`);
  console.log('');

  if (existsSync(CONFIG_PATH)) {
    try {
      const existing = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      console.log(colors.yellow(`! 已有配置: AppID = ${existing.appId}`));
    } catch {}

    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await prompt(rl, '是否覆盖现有配置？(y/N) ');
    rl.close();

    if (answer.trim().toLowerCase() !== 'y') {
      console.log('\n已取消，保留现有配置。');
      process.exit(0);
    }
    console.log('');
  }

  console.log(colors.dim('请前往微信公众平台获取凭据：'));
  console.log(colors.dim('https://mp.weixin.qq.com → 开发 → 基本配置 → 开发者ID'));
  console.log('');

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  let appId = '';
  while (!appId) {
    appId = (await prompt(rl, 'AppID (以 wx 开头): ')).trim();
    if (!appId) console.log(colors.red('  AppID 不能为空'));
  }

  rl.close();

  let appSecret = '';
  while (!appSecret) {
    appSecret = (await promptSecret('AppSecret: ')).trim();
    if (!appSecret) console.log(colors.red('  AppSecret 不能为空'));
  }

  process.stdout.write('\n正在验证凭据...');
  const result = await testConnection(appId, appSecret);

  if (!result.ok) {
    console.log(colors.red(` 失败\n\n错误: ${result.error}`));
    console.log(colors.yellow('\n请确认 AppID 和 AppSecret 正确，并检查公众号是否已开通开发者功能。'));
    process.exit(1);
  }

  console.log(colors.green(' 成功'));

  const path = saveConfig(appId, appSecret);
  console.log(colors.green(`\n配置已保存: ${path}\n`));
}

async function main() {
  const args = parseArgs();

  if (args.appId || args.appSecret) {
    // 参数模式
    await initWithArgs(args);
  } else {
    // 交互模式
    await initWithPrompt();
  }
}

main().catch((e) => {
  output(false, e.message);
  process.exit(1);
});
