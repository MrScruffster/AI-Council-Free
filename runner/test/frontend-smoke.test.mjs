import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = join(import.meta.dirname, "..", "..");

test("frontend contains the critical startup controls", async () => {
  const html = await readFile(join(root, "index.html"), "utf8");
  for (const id of ["modePicker", "settings", "memory", "composer", "input", "send", "imagePanel", "imagePrompt", "imageGenerate", "imageAnalyzeFile", "imageAnalyze", "textPromptMode", "imagePromptMode", "attachImage", "composerImageFile"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
  assert.match(html, /imageGallery/);
  assert.match(html, /imageRatio/);
  assert.match(html, /imageAnalysisResult/);
  assert.match(html, /compression: \{ enabled: true/);
  assert.match(html, /class=["'][^"']*active[^"']*["'][^>]*id=["']memoryBtn["']/);
  assert.match(html, /#input, #imagePrompt/);
  assert.match(html, /loadRunnerConfig\(\)/);
  assert.match(html, /COUNCIL_DECISION_SCHEMA/);
  assert.match(html, /id=["']evidenceToggle["']/);
  assert.match(html, /evidenceEnabled/);
  assert.match(html, /id=["']advancedControls["']/);
  assert.match(html, /id=["']wlDemo["']/);
  assert.match(html, /chatTitleFromQuestion/);
  assert.match(html, /className = "es-setup"/);
  assert.match(html, /href=["']about\.html["']/);
  assert.match(html, /property=["']og:image["']/);
  assert.match(html, /name=["']twitter:card["']/);
  assert.match(html, /prefers-color-scheme: light/);
  assert.doesNotMatch(html, /pagead2\.googlesyndication\.com/);
  assert.match(html, /Evidence unavailable/);
  assert.match(html, /ANSWER TO CHECK/);
});

test("all inline frontend scripts pass Node syntax validation", async () => {
  const html = await readFile(join(root, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  assert.ok(scripts.length >= 1, "expected application scripts");
  const dir = await mkdtemp(join(tmpdir(), "ai-council-frontend-"));
  try {
    for (const [index, source] of scripts.entries()) {
      const path = join(dir, `script-${index}.mjs`);
      await writeFile(path, source);
      await execFileAsync(process.execPath, ["--check", path]);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
