import fs from 'node:fs/promises';
import path from 'node:path';
import { HOME, backupFile, writeFileAtomic } from './store.mjs';

const TARGETS = [
  { id: 'claude', file: path.join(HOME, '.claude.json'), kind: 'json' },
  { id: 'qoder', file: path.join(HOME, '.qoder-cn', 'settings.json'), kind: 'json' },
  { id: 'workbuddy', file: path.join(HOME, '.workbuddy', 'connectors', 'default', 'mcp.json'), kind: 'json' },
  { id: 'codex', file: path.join(HOME, '.codex', 'config.toml'), kind: 'toml' },
];

async function readText(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

function tomlValue(line) {
  const v = line.slice(line.indexOf('=') + 1).trim();
  return v.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

function parseToml(text) {
  const out = {};
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const head = line.match(/^\[mcp_servers\.([^\]]+)\]$/);
    if (head) {
      cur = head[1].replace(/^["']|["']$/g, '');
      out[cur] = { enabled: true, transport: 'stdio', summary: '' };
      continue;
    }
    if (line.startsWith('[')) {
      cur = null;
      continue;
    }
    if (!cur || !line.includes('=')) continue;
    if (/^command\s*=/.test(line)) {
      out[cur].transport = 'stdio';
      out[cur].summary = tomlValue(line);
    } else if (/^url\s*=/.test(line)) {
      out[cur].transport = 'http';
      out[cur].summary = tomlValue(line);
    } else if (/^enabled\s*=/.test(line)) {
      out[cur].enabled = !/false/i.test(line);
    }
  }
  return out;
}

function normalizeJsonServers(obj) {
  const out = {};
  for (const [name, cfg] of Object.entries(obj || {})) {
    if (!cfg || typeof cfg !== 'object') continue;
    const summary = cfg.url || [cfg.command, ...(cfg.args || [])].filter(Boolean).join(' ') || '';
    out[name] = {
      enabled: cfg.disabled !== true,
      transport: cfg.type || (cfg.command ? 'stdio' : 'http'),
      summary,
    };
  }
  return out;
}

async function readTarget(target) {
  const text = await readText(target.file);
  if (text === null) return { configured: false, servers: {} };
  try {
    if (target.kind === 'toml') return { configured: true, servers: parseToml(text) };
    const data = JSON.parse(text);
    return { configured: true, servers: normalizeJsonServers(data.mcpServers) };
  } catch {
    return { configured: true, servers: {} };
  }
}

export async function scanMcp() {
  const agents = [];
  const union = new Map();
  for (const t of TARGETS) {
    const { configured, servers } = await readTarget(t);
    agents.push({ id: t.id, configured, writable: t.kind === 'json', count: Object.keys(servers).length });
    for (const [name, info] of Object.entries(servers)) {
      if (!union.has(name)) union.set(name, { name, byAgent: {}, transport: info.transport, summary: info.summary });
      const item = union.get(name);
      item.byAgent[t.id] = { enabled: info.enabled, summary: info.summary };
      if (!item.summary && info.summary) item.summary = info.summary;
    }
  }
  const items = [...union.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { agents, items };
}

export async function addMcp({ agentId, name, url, command, args }) {
  const target = TARGETS.find((t) => t.id === agentId);
  if (!target) throw new Error('未知 agent');
  if (target.kind !== 'json') throw new Error('该 agent 的 MCP 配置不是 JSON，暂不支持写入');
  if (!name || !/^[\w.:@/-]{1,60}$/.test(name)) throw new Error('名称只能用字母、数字和 _ . : @ / -');
  if (url && !/^https?:\/\//.test(url)) throw new Error('URL 需要以 http:// 或 https:// 开头');
  if (!url && !command) throw new Error('需要命令或 URL');

  const text = await readText(target.file);
  if (text === null) throw new Error('没有找到该 agent 的 MCP 配置文件');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('配置文件不是合法 JSON，不敢改');
  }
  data.mcpServers = data.mcpServers || {};
  if (data.mcpServers[name]) throw new Error('这个名字已经存在');

  data.mcpServers[name] = url
    ? { type: 'http', url, disabled: false }
    : { command, args: Array.isArray(args) ? args : [], disabled: false };

  await backupFile(target.file, `${agentId}-mcp`);
  await writeFileAtomic(target.file, `${JSON.stringify(data, null, 2)}\n`);
  return { name, agentId };
}

export async function importMcp(fromAgent, toAgent, names) {
  const src = TARGETS.find((t) => t.id === fromAgent);
  const dst = TARGETS.find((t) => t.id === toAgent);
  if (!src || !dst) throw new Error('未知 agent');
  if (src.id === dst.id) throw new Error('源和目标不能是同一个 agent');
  if (src.kind !== 'json' || dst.kind !== 'json') throw new Error('两边都必须是 JSON 配置才能互导');

  const srcText = await readText(src.file);
  const dstText = await readText(dst.file);
  if (dstText === null) throw new Error('目标 agent 没有 MCP 配置文件，先加一个再导');

  let srcData;
  let dstData;
  try {
    srcData = JSON.parse(srcText || '{}');
    dstData = JSON.parse(dstText);
  } catch {
    throw new Error('配置文件不是合法 JSON，不敢改');
  }
  srcData.mcpServers = srcData.mcpServers || {};
  dstData.mcpServers = dstData.mcpServers || {};

  const added = [];
  const skipped = [];
  for (const name of names) {
    if (!srcData.mcpServers[name]) {
      skipped.push(name);
      continue;
    }
    if (dstData.mcpServers[name]) {
      skipped.push(name);
      continue;
    }
    dstData.mcpServers[name] = { ...srcData.mcpServers[name], disabled: false };
    added.push(name);
  }

  if (added.length) {
    await backupFile(dst.file, `${dst.id}-mcp`);
    await writeFileAtomic(dst.file, `${JSON.stringify(dstData, null, 2)}\n`);
  }
  return { added, skipped, from: fromAgent, to: toAgent };
}

export async function toggleMcp(name, agentId, enabled) {
  const target = TARGETS.find((t) => t.id === agentId);
  if (!target) throw new Error('未知 agent');
  if (target.kind !== 'json') throw new Error('该 agent 的 MCP 配置不是 JSON，暂不支持写入');
  const text = await readText(target.file);
  if (text === null) throw new Error('没有找到该 agent 的 MCP 配置文件');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('配置文件不是合法 JSON，不敢改');
  }
  if (!data.mcpServers || !data.mcpServers[name]) {
    throw new Error('这个 agent 里没有配置这项 MCP');
  }
  data.mcpServers[name].disabled = !enabled;
  await backupFile(target.file, `${agentId}-mcp`);
  await writeFileAtomic(target.file, `${JSON.stringify(data, null, 2)}\n`);
  return { name, agentId, enabled };
}