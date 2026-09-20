/*!
 * Reference implementation of the comparison maths (SECTION 3/4), so the Node backend and the tests share one definition.
 * All rates are proportions in 0..1. Nothing here rounds; format at display time.
 */
export const accuracyRate = (correct, total) => total > 0 ? correct / total : null;
export const hallucinationRate = (hallucinations, total) => total > 0 ? hallucinations / total : null;
export const abstentionRate = (abstained, total) => total > 0 ? abstained / total : null;

/** (public_rate - ai_council_rate) / public_rate. Positive = AI Council hallucinates less. NOT clamped, so a negative result is shown as such. */
export function relativeImprovement(publicRate, councilRate) {
  if (publicRate === null || councilRate === null || !(publicRate > 0)) return null;
  return (publicRate - councilRate) / publicRate;
}

const mid = r => (r.min + r.max) / 2;

/** Mean of the range midpoints of the entries flagged include_in_public_average that name this Council category. */
export function publicRateForCategory(entries, category) {
  const used = entries.filter(e => e.include_in_public_average && e.reported_hallucination_rate && (e.comparable_to_council_categories || []).includes(category));
  if (!used.length) return { rate: null, sources: [] };
  return { rate: used.reduce((s, e) => s + mid(e.reported_hallucination_rate), 0) / used.length, sources: used.map(e => e.source_name) };
}

/**
 * Like-for-like overall comparison: only categories that HAVE a public comparator take part, on both sides, weighted by
 * the number of internal questions in each. domain_specific has no public comparator, so it is reported on its own.
 * @param {Object} run  { factual:{total,hallucinations,correct,abstained}, legal:{...}, domain_specific:{...} }
 */
export function compareRun(run, publicEntries) {
  const per = {};
  let wPublic = 0, wCouncilHall = 0, n = 0;
  for (const cat of Object.keys(run)) {
    const r = run[cat];
    const pub = publicRateForCategory(publicEntries, cat);
    const cr = hallucinationRate(r.hallucinations, r.total);
    per[cat] = {
      total_questions: r.total,
      accuracy_rate: accuracyRate(r.correct, r.total),
      hallucination_rate: cr,
      abstention_rate: abstentionRate(r.abstained || 0, r.total),
      public_rate: pub.rate, public_sources: pub.sources,
      relative_improvement: relativeImprovement(pub.rate, cr),
      comparable: pub.rate !== null
    };
    if (pub.rate !== null && cr !== null) { wPublic += pub.rate * r.total; wCouncilHall += r.hallucinations; n += r.total; }
  }
  const overallPublic = n ? wPublic / n : null, overallCouncil = n ? wCouncilHall / n : null;
  return { per_category: per, overall_like_for_like: { questions_included: n, public_rate: overallPublic, ai_council_rate: overallCouncil, relative_improvement: relativeImprovement(overallPublic, overallCouncil) } };
}
