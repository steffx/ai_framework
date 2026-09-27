/**
 * Playwright reporter that explains failed tests.
 *
 * For each failure it collects the error, the failing test source and the page snapshot
 * Playwright saved, removes customer data, and asks an LLM for a likely root cause and a
 * verdict: product bug, test bug, or environment / flaky. With no API key it falls back to
 * rule-based classification. The result is written to ai-failure-report.md.
 *
 * Enable/disable with AI_FAILURE_ANALYSIS=off. Analysis never changes the test outcome.
 */
import fs from 'node:fs';
import path from 'node:path';
import { complete, llmAvailable, llmProvider } from './llm.js';
import { redact } from '../src/utils/redact.js';

const REPORT_FILE = 'ai-failure-report.md';
const MAX_ANALYSED = 10;

const HEURISTICS = [
  { category: 'Environment', verdict: 'environment', pattern: /ECONNREFUSED|ECONNRESET|net::ERR|browserType\.launch|Executable doesn't exist/i, hint: 'The app or browser was not reachable. Check the web server started and browsers are installed.' },
  { category: 'Server error', verdict: 'product bug', pattern: /\b5\d\d\b.*(error|returned)|Internal Server Error/i, hint: 'The backend returned a 5xx. Check the server logs for the request in the trace.' },
  { category: 'Locator not found', verdict: 'test bug or UI change', pattern: /element\(s\) not found|strict mode violation/i, hint: 'The element was not found. The UI may have changed (label, test id, role) or the page did not reach the expected state.' },
  { category: 'Assertion mismatch', verdict: 'product bug or outdated expectation', pattern: /unexpected value|Expected[\s\S]*Received/i, hint: 'The app returned different data than the test expects. Compare Expected vs Received and decide which one is right.' },
  { category: 'Timeout', verdict: 'flaky or slow', pattern: /Timeout \d+ms exceeded|Test timeout of/i, hint: 'Something took longer than the timeout. Look for a missing wait on a network response or a slow environment.' },
];

function classify(message) {
  return HEURISTICS.find((h) => h.pattern.test(message)) ?? { category: 'Unknown', verdict: 'needs investigation', hint: 'No known pattern matched.' };
}

function sourceSnippet(location) {
  try {
    const lines = fs.readFileSync(location.file, 'utf8').split('\n');
    const from = Math.max(0, location.line - 15);
    return lines.slice(from, location.line + 10).map((l, i) => `${from + i + 1}: ${l}`).join('\n');
  } catch {
    return '(source unavailable)';
  }
}

function errorLocation(result, test) {
  const loc = result.errors.find((e) => e.location)?.location;
  return loc ?? test.location;
}

function pageSnapshot(result) {
  const attachment = result.attachments.find((a) => a.name === 'error-context' && a.path);
  if (!attachment) return '';
  try {
    return fs.readFileSync(attachment.path, 'utf8').slice(0, 4000);
  } catch {
    return '';
  }
}

const stripAnsi = (s) => String(s ?? '').replace(/\u001b\[[0-9;]*m/g, '');

export default class AiFailureAnalyzer {
  constructor() {
    this.failures = [];
    this.enabled = process.env.AI_FAILURE_ANALYSIS !== 'off';
  }

  printsToStdio() {
    return false;
  }

  onTestEnd(test, result) {
    if (!this.enabled || !['failed', 'timedOut'].includes(result.status)) return;
    // Only analyse the final attempt, so a test that passed on retry is not reported as a failure.
    if (result.retry < test.retries && result.status !== 'passed') return;
    const message = stripAnsi(result.errors.map((e) => e.message || e.value).join('\n\n'));
    const location = errorLocation(result, test);
    this.failures.push({
      title: test.titlePath().filter(Boolean).join(' › '),
      project: test.parent.project()?.name,
      file: path.relative(process.cwd(), test.location.file),
      line: test.location.line,
      message: redact(message).slice(0, 3000),
      snippet: redact(sourceSnippet(location)),
      snapshot: redact(pageSnapshot(result)),
      retry: result.retry,
    });
  }

  async onEnd() {
    if (!this.enabled) return;
    if (this.failures.length === 0) {
      fs.rmSync(REPORT_FILE, { force: true });
      return;
    }

    const useLlm = llmAvailable();
    const provider = llmProvider();
    const sections = [];
    for (const failure of this.failures.slice(0, MAX_ANALYSED)) {
      const heuristic = classify(failure.message);
      let analysis = `**Category:** ${heuristic.category}  \n**Likely cause:** ${heuristic.verdict}  \n**Hint:** ${heuristic.hint}`;
      if (useLlm) {
        try {
          analysis = await this.#askLlm(failure, heuristic);
        } catch (err) {
          analysis += `\n\n_AI analysis unavailable: ${redact(err.message).slice(0, 200)}_`;
        }
      }
      sections.push(
        [
          `## ${failure.title}`,
          `\`${failure.file}:${failure.line}\` · project \`${failure.project}\`${failure.retry ? ` · retry ${failure.retry}` : ''}`,
          '',
          analysis,
          '',
          '<details><summary>Error</summary>',
          '',
          '```',
          failure.message,
          '```',
          '</details>',
        ].join('\n'),
      );
    }

    const header = [
      '# AI failure analysis',
      '',
      `${this.failures.length} failed test(s). Analysis by ${useLlm ? `${provider.name}:${provider.model}` : 'rule-based heuristics (set ANTHROPIC_API_KEY or OPENAI_API_KEY for AI analysis)'}.`,
      'Customer data (IBANs, card numbers, passwords, tokens) is redacted before analysis.',
      this.failures.length > MAX_ANALYSED ? `Only the first ${MAX_ANALYSED} failures are analysed.` : '',
      '',
    ].join('\n');

    fs.writeFileSync(REPORT_FILE, `${header}\n${sections.join('\n\n---\n\n')}\n`);
    console.log(`\nAI failure analysis written to ${REPORT_FILE}`);
  }

  async #askLlm(failure, heuristic) {
    const prompt = `A Playwright end-to-end test failed in a banking web app (payments and fraud detection).

Test: ${failure.title}
Rule-based first guess: ${heuristic.category} (${heuristic.verdict})

Error:
${failure.message}

Test source around the failure:
${failure.snippet}

Page accessibility snapshot at failure time (may be empty):
${failure.snapshot || '(none)'}

Answer in Markdown with exactly these bold labels, each on its own line, max 120 words total:
**Verdict:** one of "product bug", "test bug", "environment / flaky"
**Root cause:** one or two sentences
**Suggested fix:** one or two sentences, include a short code change if obvious`;

    return complete({
      system: 'You are a senior QA automation engineer who triages failing Playwright tests. Be concise and specific.',
      prompt,
      maxTokens: 500,
    });
  }
}
