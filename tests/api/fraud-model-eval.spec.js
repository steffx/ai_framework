import fs from 'node:fs';
import { test, expect } from '../../src/fixtures/test.js';
import { computeMetrics, metricsToMarkdown } from '../../src/eval/metrics.js';

/**
 * Model evaluation, not a functional test: scores every labeled scenario and checks
 * the engine against the quality bar agreed with the fraud team. A rule change that
 * catches less fraud, or annoys more genuine customers, fails the build.
 */
const QUALITY_BAR = { minPrecision: 0.75, minRecall: 0.85, maxFalseBlockRate: 0 };

const datasets = [
  { name: 'curated', file: '../../test-data/fraud-scenarios.json', required: true },
  // Optional extra dataset produced by `npm run ai:generate` (not committed).
  { name: 'ai-generated', file: '../../test-data/generated-scenarios.json', required: false },
];

for (const dataset of datasets) {
  const url = new URL(dataset.file, import.meta.url);

  test(`fraud engine meets the quality bar on the ${dataset.name} dataset`, { tag: '@eval' }, async ({ bankApi }, testInfo) => {
    test.skip(!dataset.required && !fs.existsSync(url), 'Run `npm run ai:generate` to create this dataset');
    const { scenarios } = JSON.parse(fs.readFileSync(url));

    const predictions = [];
    for (const s of scenarios) {
      const res = await bankApi.scoreFraud(s.context);
      expect(res.ok(), `${s.id} scored`).toBeTruthy();
      const { decision, score } = await res.json();
      predictions.push({ id: s.id, label: s.label, decision, score });
    }

    const metrics = computeMetrics(predictions);
    await testInfo.attach('metrics.json', { body: JSON.stringify({ metrics, predictions }, null, 2), contentType: 'application/json' });
    await testInfo.attach('metrics.md', { body: metricsToMarkdown(metrics), contentType: 'text/markdown' });
    testInfo.annotations.push({
      type: 'metrics',
      description: `precision=${metrics.precision} recall=${metrics.recall} falseBlockRate=${metrics.falseBlockRate}`,
    });

    // Freshly generated data is exploratory: report its metrics, but only the curated,
    // human-reviewed dataset can fail the build.
    if (!dataset.required) return;

    // Soft assertions: report every metric that misses the bar, not just the first.
    expect.soft(metrics.precision, 'precision').toBeGreaterThanOrEqual(QUALITY_BAR.minPrecision);
    expect.soft(metrics.recall, 'recall').toBeGreaterThanOrEqual(QUALITY_BAR.minRecall);
    expect.soft(metrics.falseBlockRate, 'false block rate').toBeLessThanOrEqual(QUALITY_BAR.maxFalseBlockRate);
  });
}
