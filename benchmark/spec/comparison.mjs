/*!
 * SECTION 3 (comparison specification) and SECTION 4 (running-total specification), as plain objects that build.mjs
 * serialises to JSON. The reference maths lives in lib/compare.mjs.
 */
export const COMPARISON_SPEC = {
  spec_version: "1.0",
  purpose: "Compare AI Council's internal hallucination rate with published public rates, honestly.",
  formulas: {
    accuracy_rate: "accuracy_rate = (correct_answers / total_questions)",
    hallucination_rate: "hallucination_rate = (hallucinations_detected / total_questions)",
    abstention_rate: "abstention_rate = (abstained / total_questions)",
    relative_improvement: "relative_improvement = (public_rate - ai_council_rate) / public_rate",
    identity: "correct_answers + hallucinations_detected + abstained = total_questions (each question gets exactly one verdict)"
  },
  formula_rules: [
    "All rates are proportions from 0 to 1; multiply by 100 only for display.",
    "relative_improvement is null when public_rate is null or 0. It is NOT clamped: a negative value means AI Council hallucinated MORE than the public rate and must be shown as such.",
    "hallucination_rate counts only confident wrong answers. A refusal or 'not sure' is an abstention, not a hallucination, and not a correct answer either, so accuracy and hallucination rates do not sum to 1."
  ],
  inputs: {
    ai_council_rate: "hallucination_rate from the latest completed benchmark run (see running-total-spec.json).",
    public_rate: "For a category, the mean of the min/max midpoints of the entries in public-hallucination-data.json that have include_in_public_average = true and name that category in comparable_to_council_categories."
  },
  category_mapping: {
    factual: { public_comparators: ["HaluEval (general)"], note: "One comparator. Its 19.5% is a 2023-era model on chosen topics; treat as indicative." },
    legal: { public_comparators: ["Stanford legal AI tools study (17%–33%)"], secondary_context_only: ["Large Legal Fictions (58%–88%, general models)"], note: "The AI-tools study is the primary comparator because those tools are designed to limit hallucination. The general-model range is shown separately and is not averaged in." },
    domain_specific: { public_comparators: [], note: "No verified public benchmark for construction/demolition/engineering knowledge exists in the data. Report AI Council's rate on its own; do not compute a relative improvement." }
  },
  overall_comparison: "Like-for-like only: include just the categories that have a public comparator (factual and legal), on BOTH sides, weighted by internal question count. Never mix domain_specific into the overall public comparison.",
  display_rules: [
    "Always show the footnote: 'AI Council's own 700-question benchmark compared with published rates from different benchmarks. Not a like-for-like test.'",
    "Show the number of questions and the date of the run beside any percentage.",
    "Do not show a relative improvement unless the run has at least 1 hallucination-scored question in the category and the public comparator exists.",
    "Never show grounded-summarisation rates (Vectara) as the industry average for question answering: it is a different, easier task."
  ],
  confidence_notes: {
    why_multi_model_can_reduce_shared_hallucinations: [
      "Different models are trained on different data mixes and with different methods, so a wrong recall in one is not always repeated in another. When answers are compared, a single model's idiosyncratic invention is more likely to stand out as a disagreement.",
      "A separate reviewing model is less likely to share the generator's exact blind spot than the generator is to spot its own error.",
      "Published multi-agent work (Du et al., 2023, arXiv:2305.14325) reports that having several model instances propose and debate answers improves factual validity and reduces hallucinations."
    ],
    why_it_is_not_a_guarantee: [
      "Models share large parts of their training data and common misconceptions, so errors are correlated. Agreement is evidence, not proof.",
      "If the correlation between models' errors is 1, a panel is no better than one model; if errors are independent, a 3-model majority vote cuts a 10% single-model error rate to about 2.8% (3p²(1−p)+p³). Real systems sit somewhere between, and only measurement on this benchmark shows where.",
      "AI Council synthesises and critiques rather than majority-votes, so those formulas are bounds for intuition, not predictions of its rate."
    ]
  },
  integration_notes: {
    merge_steps: [
      "1. Load out/public-hallucination-data.json and pick entries where include_in_public_average is true.",
      "2. Load the latest completed run from the running total (running-total-spec.json shape): per-category total, correct, hallucinations, abstained.",
      "3. Call compareRun(run, publicEntries) from lib/compare.mjs to get per_category and overall_like_for_like.",
      "4. Store the result with the run_id and the public-data refresh date it used, so a number on the About page can always be traced to its inputs.",
      "5. Render the About graphic with renderAboutGraphic({ accuracy, councilHalluc, industryRate, sample: false }) using overall_like_for_like."
    ],
    weekly_refresh: "The public data refreshes weekly; recompute the comparison after each refresh but do not restate old runs: keep each run's own comparison snapshot.",
    guardrails: [
      "Refuse to publish while total_questions is below 700 or the run is flagged partial.",
      "Refuse to publish if the public data entries used are older than 45 days (stale).",
      "The internal question set and its answers must stay private (see contamination note in analysis.md); publish only rates."
    ]
  }
};

export const RUNNING_TOTAL_SPEC = {
  spec_version: "1.0",
  total_questions: 700,
  question_counts: { factual: 500, legal: 100, domain_specific: 100 },
  hallucinations_detected: 0,
  hallucinations_detected_is_placeholder: true,
  placeholder_note: "0 is a placeholder because no benchmark run has been made yet. It must be replaced by the graded result of a real run; it is not a claim that AI Council makes no errors.",
  accuracy_rate_formula: "accuracy_rate = (correct_answers / total_questions)",
  hallucination_rate_formula: "hallucination_rate = (hallucinations_detected / total_questions)",
  verdicts: {
    correct: "The answer matches correct_answer after normalisation (case, punctuation, thousands separators, units spelled out) or is judged equivalent against correct_answer by the grader.",
    hallucination: "A confident answer that contradicts correct_answer, or that states a fact, number, citation or case that does not exist or does not match verification_source.",
    abstained: "The system declines, or says it is unsure, without asserting a wrong answer.",
    partial: "Correct in part. Score as hallucination if any asserted element is wrong; otherwise as correct only if every element required by correct_answer is present."
  },
  grading_rules: [
    "Numeric answers: compare as exact decimals after removing thousands separators; accept the answer with or without the stated unit; no tolerance unless the question asks to round.",
    "Names, dates and citations: normalise case, punctuation and 'the'/'The'; a citation must match volume, report series and first page (or neutral-citation year and number) exactly.",
    "Otherwise use a grader model given question, correct_answer and verification_source, with a fixed prompt and temperature 0, and spot-check at least 5% of verdicts by hand every run.",
    "The grader must never see which system produced an answer."
  ],
  update_method: [
    "1. Start a run: insert a benchmark_runs row with a new run_id, started_at, system_version and status 'running'.",
    "2. For each of the 700 questions, send the question text only, record the raw answer, latency and the model calls used.",
    "3. Grade each answer (rules above), insert one benchmark_results row with the verdict.",
    "4. When all 700 are graded, in one transaction: set status 'complete', store correct, hallucinations, abstained per category, and update the running-total row.",
    "5. The running total is the LATEST COMPLETE RUN (hallucinations_detected, accuracy_rate, hallucination_rate for that run). Keep a history of every completed run; do not average across runs with different system versions.",
    "6. Partial or failed runs never replace the running total."
  ],
  public_comparison_method: "After each run and after each weekly public-data refresh, call compareRun(latestRun, publicEntries) (lib/compare.mjs) and store the output beside the run, together with the public-data refresh date. See comparison-spec.json for the rules.",
  recommended_data_structure: {
    json_shape: {
      running_total: {
        run_id: "string", completed_at: "ISO 8601", system_version: "string", public_data_refreshed: "YYYY-MM-DD",
        total_questions: 700, correct_answers: "integer", hallucinations_detected: "integer", abstained: "integer",
        accuracy_rate: "number 0..1", hallucination_rate: "number 0..1",
        by_category: { factual: { total: 500, correct: "int", hallucinations: "int", abstained: "int" }, legal: { total: 100, correct: "int", hallucinations: "int", abstained: "int" }, domain_specific: { total: 100, correct: "int", hallucinations: "int", abstained: "int" } },
        comparison: "output of compareRun()"
      }
    },
    sql_schema: [
      "CREATE TABLE benchmark_questions (question_id TEXT PRIMARY KEY, category TEXT NOT NULL CHECK (category IN ('factual','legal','domain_specific')), question_text TEXT NOT NULL, correct_answer TEXT NOT NULL, verification_source TEXT NOT NULL, hallucination_trigger_notes TEXT NOT NULL);",
      "CREATE TABLE benchmark_runs (run_id TEXT PRIMARY KEY, started_at TEXT NOT NULL, completed_at TEXT, system_version TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('running','complete','failed')), public_data_refreshed TEXT);",
      "CREATE TABLE benchmark_results (run_id TEXT NOT NULL REFERENCES benchmark_runs(run_id), question_id TEXT NOT NULL REFERENCES benchmark_questions(question_id), answer_text TEXT NOT NULL, verdict TEXT NOT NULL CHECK (verdict IN ('correct','hallucination','abstained')), graded_by TEXT NOT NULL, latency_ms INTEGER, PRIMARY KEY (run_id, question_id));",
      "CREATE VIEW running_total AS SELECT r.run_id, r.completed_at, COUNT(*) AS total_questions, SUM(res.verdict='correct') AS correct_answers, SUM(res.verdict='hallucination') AS hallucinations_detected, SUM(res.verdict='abstained') AS abstained, 1.0*SUM(res.verdict='correct')/COUNT(*) AS accuracy_rate, 1.0*SUM(res.verdict='hallucination')/COUNT(*) AS hallucination_rate FROM benchmark_runs r JOIN benchmark_results res USING (run_id) WHERE r.status='complete' AND r.run_id=(SELECT run_id FROM benchmark_runs WHERE status='complete' ORDER BY completed_at DESC LIMIT 1) GROUP BY r.run_id;"
    ]
  }
};
