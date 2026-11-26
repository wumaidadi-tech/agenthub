import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, writeFileAtomic } from './store.mjs';

const FILE = path.join(DATA_DIR, 'settings.json');

export async function readConfig() {
  try {
    const raw = await fs.readFile(FILE, 'utf8');
    const data = JSON.parse(raw);
    return { agents: data.agents && typeof data.agents === 'object' ? data.agents : {} };
  } catch {
    return { agents: {} };
  }
}

export async function setAgentPref(agentId, patch) {
  const cfg = await readConfig();
  const current = cfg.agents[agentId] || {};
  const next = { ...current };
  if (patch.sync !== undefined) next.sync = !!patch.sync;
  if (patch.defaultTarget !== undefined) next.defaultTarget = !!patch.defaultTarget;
  cfg.agents[agentId] = next;
  await writeFileAtomic(FILE, `${JSON.stringify(cfg, null, 2)}\n`);
  return cfg;
}