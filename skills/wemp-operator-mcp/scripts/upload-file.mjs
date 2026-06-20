#!/usr/bin/env node
import { openAsBlob } from 'node:fs';
import { basename, resolve } from 'node:path';

const filePath = process.argv[2];
const mcpUrl = process.env.WEMP_MCP_URL || '';
const token = process.env.WEMP_MCP_TOKEN;

if (!filePath) {
  console.error('Usage: node scripts/upload-file.mjs <local-file>');
  process.exit(1);
}
if (!token) {
  console.error('WEMP_MCP_TOKEN is required.');
  process.exit(1);
}
if (!mcpUrl) {
  console.error('WEMP_MCP_URL is required.');
  process.exit(1);
}

const uploadUrl = new URL('/uploads', mcpUrl);
const absolutePath = resolve(filePath);
const form = new FormData();
form.append('file', await openAsBlob(absolutePath), basename(absolutePath));

const response = await fetch(uploadUrl, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: form,
});
const text = await response.text();
if (!response.ok) {
  console.error(`Upload failed with HTTP ${response.status}: ${text}`);
  process.exit(1);
}
process.stdout.write(`${text}\n`);
