import test from "node:test";
import assert from "node:assert/strict";
import { routeForUploadExtension, validateUploadFile } from "../src/index.js";

const DOCX_BYTES = new TextEncoder().encode("PK\x03\x04[Content_Types].xml word/document.xml");

test("routes supported extensions to the configured LLM", () => {
  assert.equal(routeForUploadExtension("txt").label, "LLM-A");
  assert.equal(routeForUploadExtension("pdf").label, "LLM-B");
  assert.equal(routeForUploadExtension("docx").label, "LLM-C");
  assert.equal(routeForUploadExtension("exe"), null);
});

test("accepts valid signatures and MIME types", async () => {
  assert.equal((await validateUploadFile(new File(["hello"], "note.txt", { type: "text/plain" }))).ok, true);
  assert.equal((await validateUploadFile(new File(["%PDF-1.7"], "paper.pdf", { type: "application/pdf" }))).ok, true);
  assert.equal((await validateUploadFile(new File([DOCX_BYTES], "report.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }))).ok, true);
});

test("rejects mismatched MIME and signatures", async () => {
  const wrongMime = await validateUploadFile(new File(["hello"], "note.txt", { type: "application/pdf" }));
  const wrongSignature = await validateUploadFile(new File(["not a pdf"], "paper.pdf", { type: "application/pdf" }));
  assert.equal(wrongMime.status, 415);
  assert.equal(wrongSignature.status, 415);
});

test("rejects invalid UTF-8 text", async () => {
  const invalid = new File([new Uint8Array([0xc3, 0x28])], "bad.txt", { type: "text/plain" });
  assert.equal((await validateUploadFile(invalid)).status, 415);
});
