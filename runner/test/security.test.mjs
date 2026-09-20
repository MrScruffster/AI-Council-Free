import test from "node:test";
import assert from "node:assert/strict";
import { allowedOrigin, validatePublicUrl } from "../server.mjs";

test("accepts HTTPS URLs in the task allowlist", () => {
  assert.equal(validatePublicUrl("https://example.com/path", ["example.com"]), "https://example.com/path");
});

test("rejects HTTP and private addresses", () => {
  assert.throws(() => validatePublicUrl("http://example.com", ["example.com"]), /HTTPS/);
  assert.throws(() => validatePublicUrl("https://127.0.0.1", ["127.0.0.1"]), /Private/);
  assert.throws(() => validatePublicUrl("https://metadata.google.internal", []), /Private/);
});

test("rejects domains outside the task allowlist", () => {
  assert.throws(() => validatePublicUrl("https://other.example", ["example.com"]), /allowlist/);
});

test("allows only configured browser origins for CORS preflight", async () => {
  const previous = process.env.AIC_RUNNER_ORIGINS;
  process.env.AIC_RUNNER_ORIGINS = "https://www.ai-council.co.uk";
  try {
    assert.equal(allowedOrigin({ headers: { origin: "https://www.ai-council.co.uk" } }), "https://www.ai-council.co.uk");
    assert.equal(allowedOrigin({ headers: { origin: "https://evil.example" } }), "");
  } finally {
    if (previous === undefined) delete process.env.AIC_RUNNER_ORIGINS;
    else process.env.AIC_RUNNER_ORIGINS = previous;
  }
});
