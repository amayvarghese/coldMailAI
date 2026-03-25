/** Groq: llama3-*-8192 retired → https://console.groq.com/docs/deprecations */
import { jsonrepair } from 'jsonrepair';

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const DEPRECATED_MODELS = {
  'llama3-70b-8192': DEFAULT_MODEL,
  'llama3-8b-8192': 'llama-3.1-8b-instant',
};
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

function resolveModel() {
  let m = (process.env.GROQ_MODEL || DEFAULT_MODEL).trim();
  const replacement = DEPRECATED_MODELS[m];
  if (replacement) {
    console.warn(`GROQ_MODEL "${m}" is decommissioned; using "${replacement}" instead.`);
    m = replacement;
  }
  return m;
}

function stripMarkdownFence(s) {
  return s
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

/**
 * Models often emit real newlines inside JSON string values (invalid JSON).
 * Try strict parse, then jsonrepair, then brace-slice + jsonrepair.
 */
function parseGroqJson(content) {
  const raw = stripMarkdownFence(content.trim());

  const attempts = [
    () => JSON.parse(raw),
    () => JSON.parse(jsonrepair(raw)),
  ];

  const brace = raw.match(/\{[\s\S]*\}/);
  if (brace) {
    attempts.push(() => JSON.parse(brace[0]));
    attempts.push(() => JSON.parse(jsonrepair(brace[0])));
  }

  let lastErr;
  for (const run of attempts) {
    try {
      return run();
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    lastErr?.message ? `Could not parse Groq JSON: ${lastErr.message}` : 'Could not parse Groq JSON'
  );
}

const SYSTEM = `You write polished, professional cold outreach emails for Amay Varghese. Tone: warm, confident, respectful — never salesy or desperate.

Amay's facts (use truthfully, do not invent employers or projects he did not do):
- Name: Amay Varghese
- Based in Dubai, UAE
- Game developer and experience designer; Creative Technologist | XR Developer | GenAI Engineer
- Tools & stacks: Unreal Engine 5, Unity 3D, Pixel Streaming, WebGL, OpenXR, real-time interactive systems, GenAI pipelines
- Credibility: experiential activations for Virgin Megastore, UFC, NBA, Abu Dhabi Grand Prix; MIT Reality Hack 2024 & 2025; NYC Times Square immersive installation
- Portfolio URL (use exactly): https://amayvarghese.com
- Career goal: gaming, XR, immersive tech, GenAI studios — and comparable innovation teams at large tech companies when the recipient's role fits

Output rules:
- Return a single JSON object with keys: subject_a, subject_b, body. No markdown fences.
- subject_a and subject_b: two distinct professional subject lines (max ~9 words each), specific to the recipient's company/role where possible.
- body: 200–280 words before sign-off block. Use straight ASCII apostrophes and double quotes only inside JSON.
- The body must follow this letter structure and paragraph order. The whole body is one JSON string: between paragraphs use only the JSON newline escape (a single backslash then the letter n). Never type a real Enter/newline inside the quoted body string.
  1) Salutation: Hi [First name or full name if only one word],
  2) I hope you're doing well.
  3) One paragraph: you came across their work as [role] at [company], and what genuinely resonates (creativity, technology, gaming, strategy, etc.) — be specific, not generic flattery.
  4) One paragraph: Amay as game developer / experience designer in Dubai; Unity, XR, real-time interactives; optionally one sentence on exploring AI-driven or generative interactive experiences in a credible, non-hype way (you may mention categories like world models or tooling trends — do not claim he shipped a product at Google or any false employer).
  5) One paragraph: given their background, why reaching out — exploring opportunities at [company] or with teams like theirs (adapt if company unknown).
  6) Blank line then: I've shared my portfolio and résumé below for context: then new lines Portfolio: https://amayvarghese.com and Résumé: Attached
  7) One paragraph: ask for a brief 10–15 minute conversation or guidance on positioning for relevant roles.
  8) Thank you for your time — I truly appreciate it.
  9) Best regards, then new line Amay Varghese
- CRITICAL: valid JSON only; every line break in body must be written as backslash-n inside the quotes.`;

export async function generateEmail({ name, company, role }) {
  const model = resolveModel();

  const user = `Write one outreach email.

Recipient first name or how to address them: ${name || 'there'}
Their company: ${company || 'their organization'}
Their role/title: ${role || 'their role'}

Return JSON with subject_a, subject_b, and body. Body must match the full professional structure in your system instructions (200–280 words in the main paragraphs plus the portfolio/résumé block and sign-off). Use backslash-n between every paragraph and line break inside the body string.

Example shape only (your content must be unique and tailored):
{"subject_a":"Creative technologist exploring roles at Acme","subject_b":"Dubai-based XR — fit for your team","body":"Hi Jordan,\\n\\nI hope you're doing well.\\n\\n..."}`;

  const bodyPayload = {
    model,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user },
    ],
    temperature: 0.72,
    max_tokens: 3072,
    response_format: { type: 'json_object' },
  };

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(bodyPayload),
  });

  if (!res.ok) {
    const errText = await res.text();
    if (errText.includes('response_format') || errText.includes('json_object')) {
      const retry = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: bodyPayload.messages,
          temperature: bodyPayload.temperature,
          max_tokens: bodyPayload.max_tokens,
        }),
      });
      if (!retry.ok) {
        throw new Error(`Groq API error ${retry.status}: ${await retry.text()}`);
      }
      const retryData = await retry.json();
      const content = retryData.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error('Groq returned empty content');
      const parsed = parseGroqJson(content);
      return finalizeParsed(parsed);
    }
    throw new Error(`Groq API error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('Groq returned empty content');
  }

  const parsed = parseGroqJson(content);
  return finalizeParsed(parsed);
}

function finalizeParsed(parsed) {
  const subjectA = String(parsed.subject_a || '').trim();
  const subjectB = String(parsed.subject_b || '').trim();
  let body = String(parsed.body || '').trim();
  body = body.replace(/\\n/g, '\n');

  if (!subjectA || !body) {
    throw new Error('Groq JSON missing subject_a or body');
  }

  const subjectBUse = subjectB || subjectA;
  const pickA = Math.random() < 0.5;
  const subject = pickA ? subjectA : subjectBUse;

  return { subject, body };
}
