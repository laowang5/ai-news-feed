import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientBundlePath = path.resolve(__dirname, '../lib/client.js');

function fail(reason, detail = '') {
  console.error(`check-client-bundle FAILED: ${reason}`);
  if (detail) {
    console.error(detail);
  }
  process.exit(1);
}

// 1. 文件存在
if (!fs.existsSync(clientBundlePath)) {
  fail('File does not exist', `Path: ${clientBundlePath}\nHint: run pnpm build first`);
}

let source = fs.readFileSync(clientBundlePath, 'utf8');

// 清理 tsc 在 package.json "type": "module" 下硬编码注入的尾部 export {};
if (/export\s*\{\s*\};?\s*$/.test(source)) {
  source = source.replace(/export\s*\{\s*\};?\s*$/, '').trimEnd() + '\n';
  fs.writeFileSync(clientBundlePath, source, 'utf8');
}

// 2. 不含 ESM 语法：/^\s*(export|import)\s/m 必须无匹配
const lines = source.split('\n');
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (/^\s*(export|import)\s/.test(line)) {
    fail('ESM syntax detected', `Line ${i + 1}: ${line}`);
  }
}

// 3. 经典脚本可解析：new Function(source) 不抛异常
try {
  new Function(source);
} catch (err) {
  fail('Classic script parsing failed', err.stack || String(err));
}

// 4. 含 window.__ModuleLoader__.load
if (!source.includes('window.__ModuleLoader__.load')) {
  fail('Missing window.__ModuleLoader__.load');
}

// 5. 含 slot 名字面量
const requiredSlots = [
  'conversation.session.header.utilities',
  'conversation.input.dock',
  'conversation.session.header.actions',
  'conversation.composer.dock',
];

for (const slot of requiredSlots) {
  if (!source.includes(slot)) {
    fail(`Missing required slot: "${slot}"`);
  }
}

console.log('client bundle: OK (classic script, 3 slots)');
