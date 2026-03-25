import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import { Resend } from 'resend';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let resendClient;
let gmailTransport;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function getEmailProvider() {
  const explicit = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (explicit === 'gmail' || explicit === 'resend') return explicit;

  const hasGmail = Boolean(
    process.env.GMAIL_USER?.trim() && process.env.GMAIL_APP_PASSWORD?.trim()
  );
  const hasResend = Boolean(process.env.RESEND_API_KEY?.trim());

  if (hasGmail && hasResend) {
    console.warn(
      'Both Gmail and Resend are configured but EMAIL_PROVIDER is unset; using resend. Set EMAIL_PROVIDER=gmail for Gmail-only.'
    );
    return 'resend';
  }
  if (hasGmail) return 'gmail';
  return 'resend';
}

export function getCapabilities() {
  const provider = getEmailProvider();
  return {
    provider,
    /** Resend webhooks can update opened / clicked / inbound reply */
    autoTracking: provider === 'resend',
  };
}

function getResend() {
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

function normalizeGmailAppPassword(raw) {
  if (!raw) return '';
  let p = String(raw).trim();
  p = p.replace(/^["']|["']$/g, '');
  p = p.replace(/\s+/g, '');
  return p;
}

/**
 * Google App Passwords are always 16 characters (A–Z, a–z, 0–9), often shown as 4 groups.
 * A normal Gmail password will always fail SMTP with 535.
 */
function assertLooksLikeGoogleAppPassword(pass) {
  if (pass.length !== 16 || !/^[a-zA-Z0-9]{16}$/.test(pass)) {
    throw new Error(
      'GMAIL_APP_PASSWORD must be a 16-character Google App Password (not your normal Gmail password). ' +
        '1) Turn on 2-Step Verification. 2) Open https://myaccount.google.com/apppasswords 3) Create "Mail" → copy the 16 characters into .env (spaces optional).'
    );
  }
}

function getGmailTransport() {
  if (!gmailTransport) {
    const user = process.env.GMAIL_USER?.trim();
    const rawPass = process.env.GMAIL_APP_PASSWORD;
    if (!user || !String(rawPass || '').trim()) {
      throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD are required for Gmail sending');
    }
    const pass = normalizeGmailAppPassword(rawPass);
    assertLooksLikeGoogleAppPassword(pass);

    gmailTransport = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user, pass },
    });
  }
  return gmailTransport;
}

function attachmentContentType(filename) {
  const lower = String(filename).toLowerCase();
  if (lower.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (lower.endsWith('.pdf')) {
    return 'application/pdf';
  }
  return undefined;
}

/** Attachments for Resend API */
function buildResendAttachments() {
  const filename = (process.env.RESUME_FILENAME || 'Amay_Varghese_Resume.pdf').trim();
  const publicUrl = process.env.RESUME_PUBLIC_URL?.trim();
  const filePath = process.env.RESUME_FILE_PATH?.trim();

  if (publicUrl) {
    const ct = attachmentContentType(filename);
    return ct ? [{ path: publicUrl, filename, contentType: ct }] : [{ path: publicUrl, filename }];
  }
  if (filePath) {
    const abs = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);
    if (!fs.existsSync(abs)) {
      console.warn('RESUME_FILE_PATH not found on disk:', abs);
      return undefined;
    }
    const ct = attachmentContentType(filename);
    const base = { filename, content: fs.readFileSync(abs) };
    if (ct) base.contentType = ct;
    return [base];
  }
  return undefined;
}

/** Attachments for Nodemailer (path supports https or filesystem) */
function buildNodemailerAttachments() {
  const filename = (process.env.RESUME_FILENAME || 'Amay_Varghese_Resume.pdf').trim();
  const publicUrl = process.env.RESUME_PUBLIC_URL?.trim();
  const filePath = process.env.RESUME_FILE_PATH?.trim();

  if (publicUrl) {
    const ct = attachmentContentType(filename);
    const base = { filename, path: publicUrl };
    if (ct) base.contentType = ct;
    return [base];
  }
  if (filePath) {
    const abs = path.isAbsolute(filePath) ? filePath : path.join(__dirname, filePath);
    if (!fs.existsSync(abs)) {
      console.warn('RESUME_FILE_PATH not found on disk:', abs);
      return undefined;
    }
    const ct = attachmentContentType(filename);
    const base = { filename, path: abs };
    if (ct) base.contentType = ct;
    return [base];
  }
  return undefined;
}

function buildReplyToResend() {
  const inbound = process.env.RESEND_INBOUND_EMAIL?.trim();
  const personal = process.env.REPLY_TO_EMAIL?.trim();
  const list = [];
  if (inbound) list.push(inbound);
  if (personal && !list.includes(personal)) list.push(personal);
  if (list.length === 0) {
    throw new Error(
      'Set RESEND_INBOUND_EMAIL and/or REPLY_TO_EMAIL in backend/.env for Resend mode'
    );
  }
  return list;
}

function buildBodies(body, hasAttachment) {
  let textBody = body;
  let htmlInner = escapeHtml(body).replace(/\n/g, '<br/>');
  if (hasAttachment && !/resume|résumé|attached/i.test(body)) {
    textBody += '\n\nRésumé: see attachment.';
    htmlInner +=
      '<p style="margin-top:1.25em;color:#555;font-size:13px">Résumé: see attachment.</p>';
  }
  const html = `<div style="font-family:system-ui,sans-serif;line-height:1.5;font-size:15px;color:#111">${htmlInner}</div>`;
  return { html, text: textBody };
}

async function sendViaGmail({ to, subject, body }) {
  const user = process.env.GMAIL_USER?.trim();
  const displayName = (process.env.GMAIL_DISPLAY_NAME || 'Amay Varghese').trim();
  const from = `${displayName} <${user}>`;
  const attachments = buildNodemailerAttachments();
  const { html, text } = buildBodies(body, Boolean(attachments?.length));

  const transport = getGmailTransport();
  const info = await transport.sendMail({
    from,
    to,
    subject,
    text,
    html,
    replyTo: user,
    attachments: attachments || undefined,
  });

  return {
    success: true,
    messageId: info.messageId || null,
    error: null,
  };
}

async function sendViaResend({ to, subject, body }) {
  const resend = getResend();
  const from = process.env.RESEND_FROM_EMAIL?.trim();
  if (!from) {
    throw new Error('RESEND_FROM_EMAIL is not set');
  }
  const replyTo = buildReplyToResend();
  const attachments = buildResendAttachments();
  const { html, text } = buildBodies(body, Boolean(attachments?.length));

  const payload = {
    from,
    to: [to],
    subject,
    html,
    text,
    replyTo,
  };
  if (attachments?.length) {
    payload.attachments = attachments;
  }

  const { data, error } = await resend.emails.send(payload);
  if (error) {
    return { success: false, messageId: null, error: error.message || String(error) };
  }
  return { success: true, messageId: data?.id || null, error: null };
}

export async function sendEmail({ to, subject, body }) {
  const provider = getEmailProvider();
  if (provider === 'gmail') {
    try {
      return await sendViaGmail({ to, subject, body });
    } catch (err) {
      const msg = err.message || String(err);
      let hint = '';
      if (/535|Invalid login|BadCredentials/i.test(msg)) {
        hint =
          ' Gmail SMTP needs a 16-character App Password (not your normal Gmail password): Google Account → Security → 2-Step Verification ON → App passwords → generate for Mail. Put it in GMAIL_APP_PASSWORD with or without spaces. See https://support.google.com/mail/?p=BadCredentials';
      }
      return {
        success: false,
        messageId: null,
        error: msg + hint,
      };
    }
  }
  if (!process.env.RESEND_API_KEY?.trim()) {
    throw new Error('RESEND_API_KEY is not set (or set EMAIL_PROVIDER=gmail with Gmail credentials)');
  }
  return sendViaResend({ to, subject, body });
}
