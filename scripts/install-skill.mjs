#!/usr/bin/env node
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const skillSource = join(repoRoot, 'skills', 'wemp-operator-mcp');
const skillTarget = join(homedir(), '.codex', 'skills', 'wemp-operator-mcp');
const force = process.argv.includes('--force');

mkdirSync(dirname(skillTarget), { recursive: true });

if (existsSync(skillTarget)) {
  const stat = lstatSync(skillTarget);
  const pointsToSource = stat.isSymbolicLink() && resolve(dirname(skillTarget), readlinkSync(skillTarget)) === skillSource;
  if (pointsToSource) {
    console.log(`Skill already installed: ${skillTarget}`);
    process.exit(0);
  }
  if (!force) {
    console.error(`Refusing to overwrite existing skill: ${skillTarget}`);
    console.error('Re-run with --force to replace it.');
    process.exit(1);
  }
  rmSync(skillTarget, { recursive: true, force: true });
}

symlinkSync(skillSource, skillTarget, 'dir');
console.log(`Installed skill: ${skillTarget} -> ${skillSource}`);
