import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Webhook } from 'svix';
import { generateEmail } from './groq.js';
import { sendEmail, getCapabilities } from './email.js';
import * as tracker from './tracker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

function extractEmail(from) {
  if (!from) return null;
  const s = String(from);
  const m = s.match(/<([^>]+)>/);
  if (m) return m[1].trim().toLowerCase();
  if (s.includes('@')) return s.trim().toLowerCase();
  return null;
}

function recipientEmails(data) {
  const to = data?.to;
  if (!to) return [];
  const list = Array.isArray(to) ? to : [to];
  return list.map((e) => extractEmail(e) || String(e).trim().toLowerCase()).filter(Boolean);
}

function stripHtml(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchReceivedEmailText(emailId) {
  const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
  });
  if (!res.ok) {
    const t = await res.text();
    console.log('Resend receiving API error', res.status, t);
    return null;
  }
  const data = await res.json();
  if (data.text && String(data.text).trim()) return String(data.text).trim();
  if (data.html) return stripHtml(data.html);
  return null;
}

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: true,
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type'],
    })
  );

  app.post(
    '/api/webhooks/resend',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
      const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : String(req.body || '');
      console.log('Webhook received: raw length', rawBody.length);

      const secret = process.env.RESEND_WEBHOOK_SECRET;
      if (!secret) {
        console.log('RESEND_WEBHOOK_SECRET missing — rejecting webhook');
        return res.status(500).send('Server misconfiguration');
      }

      const svixId = req.headers['svix-id'];
      const svixTimestamp = req.headers['svix-timestamp'];
      const svixSignature = req.headers['svix-signature'];

      let event;
      try {
        const wh = new Webhook(secret);
        event = wh.verify(rawBody, {
          'svix-id': svixId,
          'svix-timestamp': svixTimestamp,
          'svix-signature': svixSignature,
        });
      } catch (err) {
        console.log('Webhook signature verification failed:', err.message);
        return res.status(400).send('Invalid signature');
      }

      console.log('Webhook verified, type:', event.type, 'payload:', JSON.stringify(event));

      try {
        const type = event.type;
        const data = event.data || {};

        if (type === 'email.opened') {
          const emails = recipientEmails(data);
          for (const email of emails) {
            await tracker.update(email, { opened: true });
          }
        } else if (type === 'email.clicked') {
          const emails = recipientEmails(data);
          for (const email of emails) {
            await tracker.update(email, { clicked: true });
          }
        } else if (type === 'email.bounced') {
          const emails = recipientEmails(data);
          const msg = data.bounce?.message || data.bounce?.type || 'Bounced';
          for (const email of emails) {
            await tracker.update(email, {
              sent: false,
              bounced: true,
              bounceNote: String(msg),
            });
          }
        } else if (type === 'email.received') {
          const fromAddr = extractEmail(data.from);
          const emailId = data.email_id;
          let fullText = null;
          if (emailId) {
            fullText = await fetchReceivedEmailText(emailId);
          }
          const replySnippet = fullText
            ? fullText.slice(0, 500)
            : '(Reply body unavailable — fetch from Resend dashboard)';
          if (fromAddr) {
            await tracker.update(fromAddr, {
              replied: true,
              replyContent: replySnippet,
              replyContentFull: fullText || replySnippet,
              replyAt: new Date().toISOString(),
            });
          }
        } else {
          console.log('Unhandled webhook type:', type);
        }
      } catch (err) {
        console.log('Webhook handler error:', err);
      }

      return res.status(200).json({ received: true });
    }
  );

  app.use(express.json());

  app.get('/api/config', (req, res) => {
    res.json(getCapabilities());
  });

  app.post('/api/preview', async (req, res) => {
    try {
      const { name, company, role } = req.body || {};
      if (!name && !company && !role) {
        return res.status(400).json({ error: 'Provide at least one of name, company, role' });
      }
      const { subject, body } = await generateEmail({
        name: name || '',
        company: company || '',
        role: role || '',
      });
      return res.json({ subject, body });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: err.message || 'Preview failed' });
    }
  });

  app.post('/api/leads', async (req, res) => {
    try {
      const { name, email, company, role, subject: inSubject, body: inBody } = req.body || {};
      if (!email || !String(email).trim()) {
        return res.status(400).json({ error: 'email is required' });
      }

      let subject = inSubject;
      let body = inBody;
      if (!subject || !body) {
        const gen = await generateEmail({
          name: name || '',
          company: company || '',
          role: role || '',
        });
        subject = subject || gen.subject;
        body = body || gen.body;
      }

      const sendResult = await sendEmail({ to: email.trim(), subject, body });

      const timestamp = new Date().toISOString();
      const lead = {
        name: name || '',
        email: email.trim(),
        company: company || '',
        role: role || '',
        subject,
        body,
        sent: sendResult.success,
        opened: false,
        clicked: false,
        replied: false,
        bounced: false,
        bounceNote: null,
        replyContent: null,
        replyContentFull: null,
        replyAt: null,
        messageId: sendResult.messageId,
        sendError: sendResult.error || null,
        timestamp,
      };

      await tracker.save(lead);
      const leads = await tracker.getAll();
      const saved = leads.find((l) => l.email.toLowerCase() === email.trim().toLowerCase());

      return res.json({
        preview: { subject, body },
        send: sendResult,
        lead: saved,
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: err.message || 'Failed to process lead' });
    }
  });

  app.get('/api/leads', async (req, res) => {
    try {
      const leads = await tracker.getAll();
      return res.json(leads);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: err.message || 'Failed to read leads' });
    }
  });

  app.post('/api/leads/:email/log-reply', async (req, res) => {
    try {
      const email = decodeURIComponent(req.params.email);
      const { replyContent } = req.body || {};
      const text = String(replyContent || '').trim();
      if (!text) {
        return res.status(400).json({ error: 'replyContent is required' });
      }
      const leads = await tracker.getAll();
      const existing = leads.find((l) => l.email.toLowerCase() === email.trim().toLowerCase());
      if (!existing) {
        return res.status(404).json({ error: 'Lead not found' });
      }
      const replyAt = new Date().toISOString();
      await tracker.update(email, {
        replied: true,
        replyContent: text.slice(0, 500),
        replyContentFull: text,
        replyAt,
        replySource: 'gmail_manual',
      });
      return res.json({ ok: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: err.message || 'Failed to save reply' });
    }
  });

  app.delete('/api/leads/:email', async (req, res) => {
    try {
      const email = decodeURIComponent(req.params.email);
      const removed = await tracker.remove(email);
      if (!removed) {
        return res.status(404).json({ error: 'Lead not found' });
      }
      return res.json({ ok: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: err.message || 'Failed to delete' });
    }
  });

  return app;
}
