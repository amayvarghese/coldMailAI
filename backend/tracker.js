import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_PATH = path.join(__dirname, 'logs.json');

let supabase;

function getSupabase() {
  const url = process.env.SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) return null;
  if (!supabase) {
    supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabase;
}

function useSupabase() {
  return getSupabase() != null;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/** API / frontend shape (camelCase) → DB row (snake_case) */
function leadToRow(lead) {
  const email = normalizeEmail(lead.email);
  return {
    email,
    name: lead.name ?? '',
    company: lead.company ?? '',
    role: lead.role ?? '',
    subject: lead.subject ?? '',
    body: lead.body ?? '',
    sent: Boolean(lead.sent),
    opened: Boolean(lead.opened),
    clicked: Boolean(lead.clicked),
    replied: Boolean(lead.replied),
    bounced: Boolean(lead.bounced),
    bounce_note: lead.bounceNote ?? null,
    reply_content: lead.replyContent ?? null,
    reply_content_full: lead.replyContentFull ?? null,
    reply_at: lead.replyAt ?? null,
    message_id: lead.messageId ?? null,
    send_error: lead.sendError ?? null,
    reply_source: lead.replySource ?? null,
    sent_at: lead.timestamp ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/** DB row → API shape */
function rowToLead(row) {
  if (!row) return null;
  return {
    email: row.email,
    name: row.name ?? '',
    company: row.company ?? '',
    role: row.role ?? '',
    subject: row.subject ?? '',
    body: row.body ?? '',
    sent: Boolean(row.sent),
    opened: Boolean(row.opened),
    clicked: Boolean(row.clicked),
    replied: Boolean(row.replied),
    bounced: Boolean(row.bounced),
    bounceNote: row.bounce_note ?? null,
    replyContent: row.reply_content ?? null,
    replyContentFull: row.reply_content_full ?? null,
    replyAt: row.reply_at ?? null,
    messageId: row.message_id ?? null,
    sendError: row.send_error ?? null,
    replySource: row.reply_source ?? null,
    timestamp: row.sent_at ?? row.updated_at ?? null,
  };
}

const PATCH_MAP = {
  opened: 'opened',
  clicked: 'clicked',
  replied: 'replied',
  sent: 'sent',
  bounced: 'bounced',
  bounceNote: 'bounce_note',
  replyContent: 'reply_content',
  replyContentFull: 'reply_content_full',
  replyAt: 'reply_at',
  replySource: 'reply_source',
  messageId: 'message_id',
  sendError: 'send_error',
};

function patchToRow(fields) {
  const patch = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'email') continue;
    const col = PATCH_MAP[k] ?? null;
    if (col) patch[col] = v;
  }
  return patch;
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
        'Cannot write leads to disk. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or use a writable filesystem.'
      );
    }
    throw e;
  }
}

export async function getAll() {
  if (useSupabase()) {
    const { data, error } = await getSupabase()
      .from('leads')
      .select('*')
      .order('sent_at', { ascending: false, nullsFirst: false });
    if (error) throw new Error(error.message);
    return (data || []).map(rowToLead);
  }
  return readFileLeads();
}

export async function save(lead) {
  const email = normalizeEmail(lead.email);
  if (useSupabase()) {
    const row = leadToRow({ ...lead, email });
    const { data, error } = await getSupabase()
      .from('leads')
      .upsert(row, { onConflict: 'email' })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return rowToLead(data);
  }
  const leads = readFileLeads();
  const idx = leads.findIndex((l) => normalizeEmail(l.email) === email);
  if (idx >= 0) {
    leads[idx] = { ...leads[idx], ...lead, email };
  } else {
    leads.push({ ...lead, email });
  }
  writeFileLeads(leads);
  return leads.find((l) => normalizeEmail(l.email) === email);
}

export async function update(email, fields) {
  const key = normalizeEmail(email);
  if (useSupabase()) {
    const patch = patchToRow(fields);
    const { data, error } = await getSupabase()
      .from('leads')
      .update(patch)
      .eq('email', key)
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return rowToLead(data);
  }
  const leads = readFileLeads();
  const idx = leads.findIndex((l) => normalizeEmail(l.email) === key);
  if (idx < 0) return null;
  leads[idx] = { ...leads[idx], ...fields, email: leads[idx].email };
  writeFileLeads(leads);
  return leads[idx];
}

export async function remove(email) {
  const key = normalizeEmail(email);
  if (useSupabase()) {
    const { data, error } = await getSupabase().from('leads').delete().eq('email', key).select('email');
    if (error) throw new Error(error.message);
    return Array.isArray(data) && data.length > 0;
  }
  const leads = readFileLeads();
  const next = leads.filter((l) => normalizeEmail(l.email) !== key);
  writeFileLeads(next);
  return leads.length !== next.length;
}
