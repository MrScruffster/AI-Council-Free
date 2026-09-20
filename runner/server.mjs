import http from "node:http";
import crypto from "node:crypto";
import net from "node:net";
import dns from "node:dns/promises";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const TOKEN = String(process.env.AIC_RUNNER_TOKEN || "");
const MAX_BODY = 64 * 1024;
const MAX_TEXT = 12000;
const TASK_TTL_MS = 10 * 60 * 1000;
const tasks = new Map();

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "null",
    "Access-Control-Allow-Headers": "Content-Type, X-AI-Council-Token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
  });
  res.end(data);
}

function authorized(req) {
  return Boolean(TOKEN) && req.headers["x-ai-council-token"] === TOKEN;
}

function blockedHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host === "metadata.google.internal") return true;
  if (net.isIP(host) === 4) {
    const parts = host.split(".").map(Number);
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || parts[0] === 169 && parts[1] === 254 ||
      parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
  }
  return net.isIP(host) === 6 && (host === "::1" || host === "::" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe8"));
}

export function validatePublicUrl(raw, allowlist = []) {
  let u;
  try { u = new URL(String(raw || "")); } catch (_) { throw new Error("A full URL is required."); }
  if (u.protocol !== "https:") throw new Error("Only HTTPS pages are allowed.");
  if (blockedHost(u.hostname)) throw new Error("Private, local, link-local and metadata addresses are blocked.");
  const host = u.hostname.toLowerCase();
  const allowed = allowlist.map(x => String(x).toLowerCase().replace(/^\*\./, ""));
  if (allowed.length && !allowed.some(domain => host === domain || host.endsWith("." + domain))) {
    throw new Error("This domain is not in the task allowlist.");
  }
  return u.href;
}

async function validateResolvedHost(url) {
  const hostname = new URL(url).hostname;
  if (net.isIP(hostname)) return;
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (_) {
    throw new Error("The target hostname could not be resolved.");
  }
  if (!addresses.length || addresses.some(({ address }) => blockedHost(address))) {
    throw new Error("The target hostname resolves to a private or local address.");
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => {
      data += chunk;
      if (Buffer.byteLength(data) > MAX_BODY) reject(new Error("Request body is too large."));
    });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (_) { reject(new Error("Request body must be JSON.")); }
    });
    req.on("error", reject);
  });
}

async function loadPlaywright() {
  try { return await import("playwright"); }
  catch (_) { throw new Error("Playwright is not installed. Run npm install in runner/ and then npx playwright install chromium."); }
}

function taskOf(id) {
  const task = tasks.get(id);
  if (!task || task.expiresAt < Date.now()) throw new Error("Task not found or expired.");
  return task;
}

async function closeTask(task) {
  task.stopped = true;
  try { await task.context?.close(); } catch (_) {}
  tasks.delete(task.id);
}

async function createTask(body) {
  const domains = Array.isArray(body.domains) ? body.domains.slice(0, 20) : [];
  if (!domains.length) throw new Error("At least one approved domain is required.");
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.route("**/*", async route => {
    try {
      const url = validatePublicUrl(route.request().url(), domains);
      await validateResolvedHost(url);
      await route.continue();
    }
    catch (_) { await route.abort("blockedbyclient"); }
  });
  const id = crypto.randomUUID();
  const task = { id, domains, browser, context, page: await context.newPage(), expiresAt: Date.now() + TASK_TTL_MS, stopped: false };
  tasks.set(id, task);
  return { taskId: id, expiresAt: task.expiresAt, domains };
}

async function action(task, body) {
  if (task.stopped) throw new Error("Task is stopped.");
  task.expiresAt = Date.now() + TASK_TTL_MS;
  const page = task.page;
  const command = String(body.command || "");
  if (command === "open") {
    const url = validatePublicUrl(body.url, task.domains);
    await validateResolvedHost(url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    return { url: page.url(), title: await page.title() };
  }
  if (command === "extract") {
    const text = (await page.locator("body").innerText({ timeout: 10000 })).slice(0, MAX_TEXT);
    return { url: page.url(), title: await page.title(), text, truncated: text.length >= MAX_TEXT };
  }
  if (command === "search") {
    const query = String(body.query || "").trim().slice(0, 300);
    if (!query) throw new Error("A search query is required.");
    await page.locator("body").pressSequentially(query);
    return { url: page.url(), query, note: "Query text was entered into the current page; no form was submitted." };
  }
  if (command === "fill") {
    const selector = String(body.selector || "").slice(0, 300);
    const value = String(body.value || "").slice(0, 2000);
    if (!selector) throw new Error("A form selector is required.");
    await page.locator(selector).fill(value, { timeout: 10000 });
    return { url: page.url(), selector, filled: true, submissionRequired: true };
  }
  if (command === "submit") {
    if (body.confirm !== true) return { confirmationRequired: true, message: "Submission is paused. Ask the user for explicit confirmation before retrying with confirm=true." };
    throw new Error("Form submission is intentionally disabled in this first runner release.");
  }
  if (command === "screenshot") {
    const buffer = await page.screenshot({ type: "png", fullPage: false });
    return { url: page.url(), imageBase64: buffer.toString("base64") };
  }
  throw new Error("Unsupported browser command.");
}

async function handle(req, res) {
  if (req.method === "OPTIONS") return json(res, 204, {});
  if (!authorized(req)) return json(res, 401, { error: "Unauthorized runner request." });
  try {
    const path = new URL(req.url, `http://${HOST}:${PORT}`).pathname;
    if (req.method === "GET" && path === "/health") return json(res, 200, { ok: true, service: "ai-council-browser-runner", version: 1 });
    if (req.method === "POST" && path === "/v1/tasks") return json(res, 201, await createTask(await parseBody(req)));
    const match = path.match(/^\/v1\/tasks\/([^/]+)(?:\/(action|stop))?$/);
    if (!match) return json(res, 404, { error: "Not found." });
    const task = taskOf(match[1]);
    if (req.method !== "POST") return json(res, 405, { error: "Method not allowed." });
    if (match[2] === "stop") { await closeTask(task); return json(res, 200, { stopped: true }); }
    if (match[2] === "action") return json(res, 200, await action(task, await parseBody(req)));
    return json(res, 400, { error: "An action or stop command is required." });
  } catch (error) {
    return json(res, 400, { error: error.message || "Runner request failed." });
  }
}

if (!TOKEN) console.error("AIC_RUNNER_TOKEN is required; refusing to start without authentication.");
else {
  const server = http.createServer(handle);
  server.listen(PORT, HOST, () => console.log(`AI Council browser runner listening on http://${HOST}:${PORT}`));
  setInterval(() => { for (const task of tasks.values()) if (task.expiresAt < Date.now()) closeTask(task); }, 60000).unref();
}
