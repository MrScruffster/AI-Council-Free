import test from "node:test";
import assert from "node:assert/strict";
import { validatePublicUrl } from "../server.mjs";

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
