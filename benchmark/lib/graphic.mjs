/*!
 * Deterministic About-page graphic (SVG). Pure function of its inputs: the same numbers always give byte-identical output.
 * The numbers are ARGUMENTS, never defaults, so a real result can't be confused with a sample: unless { sample: false }
 * is passed, a "SAMPLE DATA" banner is drawn across the graphic.
 *
 * Palette: charcoal #1C1C1E (background), amber #FFC15A (industry hallucination rate), teal #2BB3B1 (AI Council accuracy),
 * slate #3A3F44 (ring tracks, badge). Text uses a neutral off-white (#F2F2F2) and a dimmed slate-grey (#A6ABB0) for captions.
 */
const C = { charcoal: "#1C1C1E", amber: "#FFC15A", teal: "#2BB3B1", slate: "#3A3F44", text: "#F2F2F2", dim: "#A6ABB0" };

const r2 = n => (Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, "");   // fixed, locale-independent number formatting
const pct = (x, dp = 1) => (x * 100).toFixed(dp) + "%";
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function ring(cx, cy, r, w, frac, color, id) {
  const circ = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, frac));
  return `<g id="${id}" transform="rotate(-90 ${cx} ${cy})">` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.slate}" stroke-width="${w}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-dasharray="${r2(circ * f)} ${r2(circ)}"/>` +
    `</g>`;
}

/**
 * @param {object} o
 * @param {number} o.accuracy          AI Council accuracy, 0..1                    (correct / total)
 * @param {number} o.councilHalluc     AI Council hallucination rate, 0..1           (hallucinations / total)
 * @param {number} o.industryRate      public benchmark average hallucination rate, 0..1
 * @param {boolean} [o.sample=true]    draw the SAMPLE DATA banner
 * @param {string} [o.footnote]        caption text (defaults to the like-for-like warning)
 */
export function renderAboutGraphic(o) {
  for (const k of ["accuracy", "councilHalluc", "industryRate"]) {
    if (typeof o[k] !== "number" || !isFinite(o[k]) || o[k] < 0 || o[k] > 1) throw new Error(`renderAboutGraphic: ${k} must be a number from 0 to 1`);
  }
  const sample = o.sample !== false;
  const improvement = o.industryRate > 0 ? (o.industryRate - o.councilHalluc) / o.industryRate : null;   // relative_improvement
  const impText = improvement === null ? "n/a" : (improvement >= 0 ? "" : "−") + Math.abs(improvement * 100).toFixed(0) + "%";
  const impWord = improvement === null ? "no public rate to compare" : improvement >= 0 ? "relative reduction in hallucination rate" : "relative increase in hallucination rate";
  /* the caption carries the "not like-for-like" warning, so it is split over two centred lines to stay readable at phone width */
  const foot = (o.footnote || "AI Council's own 700-question benchmark compared with published rates\nfrom different benchmarks. Not a like-for-like test.").split("\n").slice(0, 3);
  const title = `AI Council accuracy ${pct(o.accuracy)}; industry average hallucination rate ${pct(o.industryRate)}; relative difference ${impText}`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 420" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-labelledby="aic-title aic-desc">`,
    `<title id="aic-title">${esc(title)}</title>`,
    `<desc id="aic-desc">Two progress rings. The teal ring shows AI Council's accuracy on its internal benchmark. The amber ring shows the average hallucination rate reported publicly for comparable systems. A badge shows the relative difference between the two hallucination rates.${sample ? " This is sample data, not a result." : ""}</desc>`,
    `<style>text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}.big{font-size:44px;font-weight:700}.mid{font-size:34px;font-weight:700}.lbl{font-size:15px;fill:${C.dim}}.cap{font-size:13px;fill:${C.dim}}@media (max-width:480px){.lbl{font-size:18px}.cap{font-size:16px}}</style>`,
    `<rect width="720" height="420" rx="20" fill="${C.charcoal}"/>`,
    ring(210, 178, 84, 18, o.accuracy, C.teal, "ring-accuracy"),
    `<text x="210" y="192" text-anchor="middle" class="big" fill="${C.text}">${pct(o.accuracy)}</text>`,
    `<text x="210" y="290" text-anchor="middle" class="lbl">AI Council accuracy</text>`,
    ring(510, 178, 64, 14, o.industryRate, C.amber, "ring-industry"),
    `<text x="510" y="190" text-anchor="middle" class="mid" fill="${C.text}">${pct(o.industryRate)}</text>`,
    `<text x="510" y="290" text-anchor="middle" class="lbl">Industry average hallucination rate</text>`,
    `<g id="badge"><rect x="180" y="312" width="360" height="42" rx="21" fill="${C.slate}"/>` +
      `<text x="360" y="339" text-anchor="middle" font-size="17" font-weight="600" fill="${improvement !== null && improvement >= 0 ? C.teal : C.amber}">${improvement !== null && improvement >= 0 ? "▲ " : improvement === null ? "" : "▼ "}${impText} ${esc(impWord)}</text></g>`,
    ...foot.map((line, i) => `<text x="360" y="${382 + i * 18}" text-anchor="middle" class="cap">${esc(line)}</text>`),
    sample ? `<clipPath id="card-clip"><rect width="720" height="420" rx="20"/></clipPath><g id="sample-banner" clip-path="url(#card-clip)"><rect x="0" y="0" width="720" height="34" rx="0" fill="${C.amber}"/><text x="360" y="23" text-anchor="middle" font-size="15" font-weight="700" fill="${C.charcoal}">SAMPLE DATA — placeholder numbers, not benchmark results</text></g>` : "",
    `</svg>`
  ].filter(Boolean).join("\n") + "\n";
}
