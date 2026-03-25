import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_PATH = path.join(__dirname, 'logs.json');
const REDIS_KEY = 'cold-email-leads-v1';

/** Vercel + Upstash: add Redis from Marketplace; env vars are injected automatically. */
function useRedis() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function readFileLeads() {
  try {
    const raw = fs.readFileSync(LOGS_PATH, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeFileLeads(leads) {
  try {
    fs.writeFileSync(LOGS_PATH, JSON.stringify(leads, null, 2), 'utf8');
  } catch (e) {
    if (e.code === 'EROFS' || e.code === 'EACCES') {
      throw new Error(
        'Cannot write leads to disk (read-only filesystem). On Vercel add Upstash Redis from Storage → Marketplace and set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.'
      );
    }
    throw e;
  }
}

async function readLeads() {
  if (useRedis()) {
    const { Redis } = await import('@upstash/redis');
    const redis = Redis.fromEnv();
    const raw = await redis.get(REDIS_KEY);
    if (raw == null) return [];
    if (typeof raw === 'string') {
      try {
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
      } catch {
        return [];
      }
    }
    return Array.isArray(raw) ? raw : [];
  }
  return readFileLeads();
}

async function writeLeads(leads) {
  if (useRedis()) {
    const { Redis } = await import('@upstash/redis');
    const redis = Redis.fromEnv();
    await redis.set(REDIS_KEY, JSON.stringify(leads));
    return;
  }
  writeFileLeads(leads);
}

export async function getAll() {
  return readLeads();
}

export async function save(lead) {
  const leads = await readLeads();
  const email = normalizeEmail(lead.email);
  const idx = leads.findIndex((l) => normalizeEmail(l.email) === email);
  if (idx >= 0) {
    leads[idx] = { ...leads[idx], ...lead, email };
  } else {
    leads.push({ ...lead, email });
  }
  await writeLeads(leads);
  return leads.find((l) => normalizeEmail(l.email) === email);
}

export async function update(email, fields) {
  const leads = await readLeads();
  const key = normalizeEmail(email);
  const idx = leads.findIndex((l) => normalizeEmail(l.email) === key);
  if (idx < 0) return null;
  leads[idx] = { ...leads[idx], ...fields, email: leads[idx].email };
  await writeLeads(leads);
  return leads[idx];
}

export async function remove(email) {
  const leads = await readLeads();
  const key = normalizeEmail(email);
  const next = leads.filter((l) => normalizeEmail(l.email) !== key);
  await writeLeads(next);
  return leads.length !== next.length;
}
