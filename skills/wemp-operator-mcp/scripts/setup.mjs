#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SERVER_NAME = 'wemp-operator-mcp';
const url = process.env.WEMP_MCP_URL || '';
const token = process.env.WEMP_MCP_TOKEN;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
  return result;
}

function hasMcporter() {
  const result = spawnSync('mcporter', ['--version'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return !result.error && result.status === 0;
}

if (!token) {
  console.error('WEMP_MCP_TOKEN is required.');
  console.error("Run: WEMP_MCP_URL='https://mcp.example.com/mcp' WEMP_MCP_TOKEN='<bearer-token>' node scripts/setup.mjs");
  process.exit(1);
}

if (!url) {
  console.error('WEMP_MCP_URL is required.');
  console.error("Run: WEMP_MCP_URL='https://mcp.example.com/mcp' WEMP_MCP_TOKEN='<bearer-token>' node scripts/setup.mjs");
  process.exit(1);
}

if (!url.startsWith('https://') && !url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost')) {
  console.error('WEMP_MCP_URL must use HTTPS unless it targets localhost.');
  process.exit(1);
}

if (!url.endsWith('/mcp')) {
  console.error('WEMP_MCP_URL must end with /mcp.');
  process.exit(1);
}

if (!hasMcporter()) {
  console.log('Installing mcporter...');
  run('npm', ['install', '-g', 'mcporter']);
}

console.log(`Configuring ${SERVER_NAME} at ${url}...`);
run('mcporter', [
  'config',
  'add',
  SERVER_NAME,
  '--url',
  url,
  '--transport',
  'http',
  '--header',
  `Authorization=Bearer ${token}`,
  '--scope',
  'home',
]);

const configPath = join(homedir(), '.mcporter', 'mcporter.json');
chmodSync(configPath, 0o600);

console.log('Verifying MCP connection...');
run('mcporter', ['list', SERVER_NAME]);
console.log('wemp-operator MCP configuration is ready.');
