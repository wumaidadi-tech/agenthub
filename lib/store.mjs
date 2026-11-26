import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const HOME = process.env.AGENTHUB_HOME || os.homedir();
export const DATA_DIR = path.join(HOME, '.agenthub');
export const MEM_DIR = path.join(DATA_DIR, 'memories');
export const SKILL_DIR = path.join(DATA_DIR, 'skills');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');

export async function ensureDirs() {
  await fs.mkdir(MEM_DIR, { recursive: true });
  await fs.mkdir(SKILL_DIR, { recursive: true });
  await fs.mkdir(BACKUP_DIR, { recursive: true });
}

export async function writeFileAtomic(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, file);
}

export async function backupFile(file, agentId) {
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, stamp, agentId, path.basename(file));
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(file, dest);
  return dest;
}

function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { meta: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { meta: {}, body: raw };
  const head = raw.slice(3, end).trim();
  const body = raw.slice(raw.indexOf('\n', end + 1) + 1).replace(/^\s*\n/, '');
  const meta = {};
  for (const line of head.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    meta[key] = value;
  }
  return { meta, body };
}

function toList(value) {
  if (!value) return [];
  return value
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalize(meta, body, fallbackId) {
  return {
    id: meta.id || fallbackId,
    title: meta.title || '未命名记忆',
    scope: meta.scope === 'project' ? 'project' : 'global',
    targets: toList(meta.targets),
    created: meta.created || new Date().toISOString(),
    updated: meta.updated || meta.created || new Date().toISOString(),
    body: body.trim(),
  };
}

function serialize(record) {
  return [
    '---',
    `id: ${record.id}`,
    `title: ${record.title}`,
    `scope: ${record.scope}`,
    `targets: ${record.targets.join(', ')}`,
    `created: ${record.created}`,
    `updated: ${record.updated}`,
    '---',
    '',
    record.body,
    '',
  ].join('\n');
}

export async function listMemories() {
  await ensureDirs();
  const names = await fs.readdir(MEM_DIR);
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.md')) continue;
    const file = path.join(MEM_DIR, name);
    const raw = await fs.readFile(file, 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    out.push(normalize(meta, body, name.replace(/\.md$/, '')));
  }
  out.sort((a, b) => (a.updated < b.updated ? 1 : -1));
  return out;
}

export async function getMemory(id) {
  const all = await listMemories();
  return all.find((m) => m.id === id) || null;
}

function newId() {
  return `m${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
}

export async function createMemory({ title, body, scope, targets }) {
  await ensureDirs();
  const now = new Date().toISOString();
  const record = {
    id: newId(),
    title: String(title || '').trim() || '未命名记忆',
    scope: scope === 'project' ? 'project' : 'global',
    targets: Array.isArray(targets) ? targets.filter(Boolean) : [],
    created: now,
    updated: now,
    body: String(body || '').trim(),
  };
  await writeFileAtomic(path.join(MEM_DIR, `${record.id}.md`), serialize(record));
  return record;
}

export async function updateMemory(id, patch) {
  const current = await getMemory(id);
  if (!current) return null;
  const next = {
    ...current,
    ...(patch.title !== undefined ? { title: String(patch.title).trim() || current.title } : {}),
    ...(patch.body !== undefined ? { body: String(patch.body).trim() } : {}),
    ...(patch.scope !== undefined ? { scope: patch.scope === 'project' ? 'project' : 'global' } : {}),
    ...(patch.targets !== undefined
      ? { targets: Array.isArray(patch.targets) ? patch.targets.filter(Boolean) : [] }
      : {}),
    updated: new Date().toISOString(),
  };
  await writeFileAtomic(path.join(MEM_DIR, `${id}.md`), serialize(next));
  return next;
}

export async function deleteMemory(id) {
  try {
    await fs.unlink(path.join(MEM_DIR, `${id}.md`));
    return true;
  } catch {
    return false;
  }
}