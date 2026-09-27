/**
 * Minimal LLM client used by the AI tooling. Supports Anthropic and OpenAI through plain fetch.
 *
 *   ANTHROPIC_API_KEY  -> Claude (model from AI_MODEL, default claude-sonnet-5)
 *   OPENAI_API_KEY     -> OpenAI (model from AI_MODEL, default gpt-4o-mini)
 *
 * With no key configured, llmAvailable() is false and callers use their offline fallback.
 */

export function llmProvider() {
  if (process.env.ANTHROPIC_API_KEY) return { name: 'anthropic', model: process.env.AI_MODEL || 'claude-sonnet-5' };
  if (process.env.OPENAI_API_KEY) return { name: 'openai', model: process.env.AI_MODEL || 'gpt-4o-mini' };
  return null;
}

export const llmAvailable = () => llmProvider() !== null;

export async function complete({ system, prompt, maxTokens = 2000 }) {
  const provider = llmProvider();
  if (!provider) throw new Error('No LLM configured: set ANTHROPIC_API_KEY or OPENAI_API_KEY');

  if (provider.name === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: provider.model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
    const body = await res.json();
    return body.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
  const body = await res.json();
  return body.choices[0].message.content;
}

/** Pulls the first JSON object or array out of a model reply (models sometimes wrap JSON in prose or code fences). */
export function extractJson(text) {
  const start = text.search(/[[{]/);
  if (start === -1) throw new Error('No JSON found in model output');
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  const end = text.lastIndexOf(close);
  return JSON.parse(text.slice(start, end + 1));
}
