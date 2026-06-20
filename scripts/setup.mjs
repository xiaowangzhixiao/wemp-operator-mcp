#!/usr/bin/env node
/**
 * 环境检查脚本
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SKILL_ROOT = join(__dirname, '..');
const CONFIG_PATH = join(SKILL_ROOT, 'config', 'wemp.json');

const colors = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function success(msg) { console.log(`${colors.green('✓')} ${msg}`); }
function error(msg) { console.log(`${colors.red('✗')} ${msg}`); }
function info(msg) { console.log(`${colors.cyan('→')} ${msg}`); }

function checkWempConfig() {
  if (!existsSync(CONFIG_PATH)) return { found: false };
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    if (config?.appId && config?.appSecret) {
      return { found: true, appId: config.appId };
    }
  } catch {}
  return { found: false, malformed: true };
}

async function testApi() {
  try {
    const { getUserSummary, getYesterday } = await import('./lib/utils.mjs');
    await getUserSummary(getYesterday());
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function main() {
  const showHelp = process.argv.includes('--help') || process.argv.includes('-h');

  console.log(colors.bold('\n🔍 wemp-operator 环境检查\n'));
  console.log('─'.repeat(50));

  let allPassed = true;

  // 检查配置文件
  console.log(colors.bold('\n📱 微信公众号配置'));
  const wempCheck = checkWempConfig();
  if (wempCheck.found) {
    success(`配置文件: ${CONFIG_PATH}`);
    success(`AppID: ${wempCheck.appId}`);
  } else if (wempCheck.malformed) {
    error(`配置文件格式错误: ${CONFIG_PATH}`);
    info('请重新运行初始化: node scripts/init.mjs');
    allPassed = false;
  } else {
    error('未找到公众号配置');
    info('请运行初始化: node scripts/init.mjs');
    allPassed = false;
  }

  // 测试 API
  if (wempCheck.found) {
    console.log(colors.bold('\n🔗 API 连接测试'));
    const apiTest = await testApi();
    if (apiTest.success) {
      success('API 连接正常');
    } else {
      error('API 连接失败');
      info(apiTest.error?.substring(0, 100));
      allPassed = false;
    }
  }

  // 总结
  console.log('\n' + '─'.repeat(50));
  if (allPassed) {
    console.log(colors.green(colors.bold('\n✅ 环境检查通过！\n')));
  } else {
    console.log(colors.yellow(colors.bold('\n⚠️  需要初始化配置\n')));
    if (showHelp || !wempCheck.found) {
      console.log(`运行以下命令进行初始化：\n\n  ${colors.cyan('node scripts/init.mjs')}\n`);
    }
  }

  return allPassed ? 0 : 1;
}

main().then(code => process.exit(code));
