import fs from 'node:fs/promises';
import path from 'node:path';
import { HOME, createMemory } from './store.mjs';

const SOURCES = {
  qoder: { kind: 'files', dir: path.join(HOME, '.qoder-cn', 'memory') },
  workbuddy: { kind: 'sections', dir: path.join(HOME, '.workbuddy', 'memory') },
  claude: { kind: 'sections', file: path.join(HOME, '.claude', 'CLAUDE.md') },
  codex: { kind: 'sections', file: path.join(HOME, '.codex', 'AGENTS.md') },
};

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
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return { meta, body };
}

function splitSections(raw) {
  const body = raw.replace(/^---[\s\S]*?\n---/, '').trim();
  const parts = body.split(/^##\s+/m);
  const out = [];
  parts.forEach((part, i) => {
    if (i === 0) {
      if (part.trim()) out.push({ title: '开头', text: part.trim() });
      return;
    }
    const nl = part.indexOf('\n');
    const title = (nl === -1 ? part : part.slice(0, nl)).trim();
    const text = (nl === -1 ? '' : part.slice(nl + 1)).trim();
    if (title && text) out.push({ title, text });
  });
  return out;
}

async function mdFiles(dir) {
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((n) => n.endsWith('.md') && !n.startsWith('.'));
  } catch {
    return [];
  }
}

export async function listCandidates(agentFilter = '') {
  const out = [];
  for (const [agent, src] of Object.entries(SOURCES)) {
    if (agentFilter && agent !== agentFilter) continue;
    if (src.kind === 'files') {
      for (const name of await mdFiles(src.dir)) {
        if (name === 'MEMORY.md' || name.startsWith('agenthub-')) continue;
        try {
          const raw = await fs.readFile(path.join(src.dir, name), 'utf8');
          const { meta, body } = parseFrontmatter(raw);
          out.push({
            agent,
            file: name,
            index: -1,
            title: (meta.description || meta.name || name.replace(/\.md$/, '')).slice(0, 80),
            preview: body.replace(/\s+/g, ' ').trim().slice(0, 120),
          });
        } catch {
          /* ignore */
        }
      }
      continue;
    }
    const files = src.file ? [path.basename(src.file)] : await mdFiles(src.dir);
    for (const name of files) {
      const full = src.file || path.join(src.dir, name);
      try {
        const raw = await fs.readFile(full, 'utf8');
        splitSections(raw).forEach((sec, i) => {
          out.push({
            agent,
            file: name,
            index: i,
            title: sec.title.slice(0, 80),
            preview: sec.text.replace(/\s+/g, ' ').slice(0, 120),
          });
        });
      } catch {
        /* ignore */
      }
    }
  }
  out.sort((a, b) => (a.agent === b.agent ? 0 : a.agent.localeCompare(b.agent)) || a.file.localeCompare(b.file) || a.index - b.index);
  return out;
}

export async function importCandidate(agent, fileName, index) {
  const src = SOURCES[agent];
  if (!src) throw new Error('未知 agent');
  if (!fileName || /[\\/]/.test(fileName)) throw new Error('非法文件名');

  let full;
  if (src.file) {
    if (fileName !== path.basename(src.file)) throw new Error('非法文件名');
    full = src.file;
  } else {
    full = path.join(src.dir, fileName);
    const root = path.resolve(src.dir);
    if (!path.resolve(full).startsWith(root)) throw new Error('非法路径');
  }

  const raw = await fs.readFile(full, 'utf8');
  if (src.kind === 'files') {
    const { meta, body } = parseFrontmatter(raw);
    const title = (meta.description || meta.name || fileName.replace(/\.md$/, '')).slice(0, 60);
    return createMemory({
      title,
      body: body.trim(),
      scope: meta.scope === 'project' ? 'project' : 'global',
      targets: [],
    });
  }

  const sections = splitSections(raw);
  const sec = sections[index];
  if (!sec) throw new Error('找不到这一段');
  return createMemory({
    title: sec.title.slice(0, 60),
    body: sec.text,
    scope: 'global',
    targets: [],
  });
}