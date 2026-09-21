import test from "node:test";
import assert from "node:assert/strict";
import { routeForUploadExtension, validateUploadFile } from "../src/index.js";

test("routes multimodal extensions to the correct branch", () => {
  assert.equal(routeForUploadExtension("png").label, "vision");
  assert.equal(routeForUploadExtension("json").label, "diffusion");
  assert.equal(routeForUploadExtension("pdf").label, "text-extraction");
  assert.equal(routeForUploadExtension("exe"), null);
});

test("validates image, prompt, and document signatures", async () => {
  assert.equal((await validateUploadFile(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "x.png", { type: "image/png" }))).ok, true);
  assert.equal((await validateUploadFile(new File(['{"prompt":"a comet"}'], "x.json", { type: "application/json" }))).ok, true);
  assert.equal((await validateUploadFile(new File(["%PDF-1.7"], "x.pdf", { type: "application/pdf" }))).ok, true);
});

test("rejects mismatched types and malformed JSON", async () => {
  assert.equal((await validateUploadFile(new File(["hello"], "x.pdf", { type: "application/pdf" }))).status, 415);
  assert.equal((await validateUploadFile(new File(["not json"], "x.json", { type: "application/json" }))).status, 415);
});
