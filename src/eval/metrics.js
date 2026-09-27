/**
 * Classification metrics for the fraud engine.
 * A payment counts as "flagged" when the engine did not simply approve it (REVIEW or BLOCK).
 *
 *   precision       of the payments we flagged, how many were really fraud
 *   recall          of the real fraud, how much we flagged
 *   falseBlockRate  share of legitimate payments that were hard-blocked (worst customer experience)
 */
export function computeMetrics(predictions) {
  const flagged = (p) => p.decision !== 'APPROVE';
  const tp = predictions.filter((p) => p.label === 'fraud' && flagged(p));
  const fn = predictions.filter((p) => p.label === 'fraud' && !flagged(p));
  const fp = predictions.filter((p) => p.label === 'legit' && flagged(p));
  const tn = predictions.filter((p) => p.label === 'legit' && !flagged(p));
  const legit = predictions.filter((p) => p.label === 'legit');

  const ratio = (a, b) => (b === 0 ? 0 : Number((a / b).toFixed(3)));
  const precision = ratio(tp.length, tp.length + fp.length);
  const recall = ratio(tp.length, tp.length + fn.length);

  return {
    total: predictions.length,
    confusionMatrix: { truePositive: tp.length, falsePositive: fp.length, falseNegative: fn.length, trueNegative: tn.length },
    precision,
    recall,
    f1: ratio(2 * precision * recall, precision + recall),
    falseBlockRate: ratio(legit.filter((p) => p.decision === 'BLOCK').length, legit.length),
    missedFraud: fn.map((p) => p.id),
    falseAlarms: fp.map((p) => p.id),
  };
}

export function metricsToMarkdown(m) {
  return [
    '| Metric | Value |',
    '| --- | --- |',
    `| Scenarios | ${m.total} |`,
    `| Precision | ${m.precision} |`,
    `| Recall | ${m.recall} |`,
    `| F1 | ${m.f1} |`,
    `| False block rate | ${m.falseBlockRate} |`,
    `| TP / FP / FN / TN | ${Object.values(m.confusionMatrix).join(' / ')} |`,
    `| Missed fraud | ${m.missedFraud.join(', ') || 'none'} |`,
    `| False alarms | ${m.falseAlarms.join(', ') || 'none'} |`,
  ].join('\n');
}
