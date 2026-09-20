# AI Council hallucination benchmark: public package

The specification, comparison maths, public reference data and About-page graphic for AI Council's hallucination benchmark.
**No benchmark has been run yet, so this package contains no AI Council results.** Every number for AI Council in it is a
placeholder or a sample, labelled as such.

## What is here

| File | What it is |
|---|---|
| `out/public-hallucination-data.json` | Weekly public reference data: published hallucination/error rates, each with its source, year, methodology and evidence level. Every figure was read from the paper's or leaderboard's own text; where a source gives no percentage the rate is `null`. |
| `out/comparison-spec.json` | How to compare AI Council's rate with public rates: formulas, category mapping, display rules, confidence and integration notes. |
| `out/running-total-spec.json` | The running-total record: 700 questions, a **placeholder** `hallucinations_detected` of 0, grading rules, update method and a SQL/JSON data structure. |
| `out/about-graphic.sample.svg` | Sample About-page graphic. It carries a "SAMPLE DATA" banner and is not a result. |
| `out/analysis.md` | Difficulty distribution, what the questions expose, expected rates (as bounds, not measurements), limitations and recommendations. |
| `lib/compare.mjs` | Reference implementation of the comparison maths. |
| `lib/graphic.mjs` | `renderAboutGraphic({ accuracy, councilHalluc, industryRate, sample })`: a deterministic SVG renderer. The numbers are arguments with no defaults, and it refuses values outside 0..1. |
| `spec/` | The source of the JSON specs and the public data. |

## Using it

```js
import { compareRun } from "./lib/compare.mjs";
import { renderAboutGraphic } from "./lib/graphic.mjs";
const comparison = compareRun(latestRun, publicEntries);   // per-category and overall like-for-like
const svg = renderAboutGraphic({ accuracy, councilHalluc, industryRate, sample: false });
```

Read `out/comparison-spec.json` first. In short: the comparison is **indicative, never like-for-like** (different tasks,
older models, different question styles), it only covers categories that have a public comparator, and a negative relative
improvement is shown as such rather than clamped.

## What is deliberately not in this repository

The 700 questions, their answers, the data files behind them and the code that builds and validates them are **not committed**
(see `.gitignore`). This repository is public and the site serves every file in it, so publishing them would hand out the answer
key and get it scraped into training data, which would stop the benchmark measuring anything. Keep the question set private and
publish only rates.

The private set has 500 factual, 100 legal and 100 engineering/construction/demolition questions. 130 have answers computed with
exact arithmetic; the rest are hand-curated from cited sources. **Have a subject expert review every answer before the first
scored run**: the hand-curated answers were written from standard references but have not been independently reviewed.
