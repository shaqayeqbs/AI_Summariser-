import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function startApp(env) {
  const reserver = createServer();
  const appPort = await listen(reserver);
  await new Promise((resolve, reject) => reserver.close((error) => error ? reject(error) : resolve()));

  const app = spawn(process.execPath, ["server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(appPort), ...env },
    stdio: ["ignore", "ignore", "inherit"]
  });
  const baseUrl = `http://127.0.0.1:${appPort}`;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return { app, baseUrl };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
  app.kill();
  throw new Error("The app server did not start.");
}

// A stand-in for the opencode CLI that prints one --format json event and records its arguments.
async function fakeOpencode(t, body) {
  const dir = await mkdtemp(path.join(tmpdir(), "fake-opencode-"));
  const bin = path.join(dir, "opencode");
  const argsFile = path.join(dir, "args.json");
  await writeFile(bin, `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));\n${body}\n`);
  await chmod(bin, 0o755);
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { bin, args: () => readFile(argsFile, "utf8").then(JSON.parse) };
}

const emit = (event) => `console.log(JSON.stringify(${JSON.stringify(event)}));`;
const summaryEvent = (text) => ({ type: "text", part: { type: "text", text } });

async function readStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let stream = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    stream += decoder.decode(value, { stream: true });
  }
  return stream;
}

async function summarise(baseUrl, body) {
  const response = await fetch(`${baseUrl}/api/summarise`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return { response, stream: await readStream(response) };
}

test("serves the page and streams a summary from the opencode CLI", async (t) => {
  const { bin } = await fakeOpencode(t, emit(summaryEvent("A concise summary.")));
  const { app, baseUrl } = await startApp({ OPENCODE_BIN: bin });
  t.after(() => app.kill());

  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  const pageHtml = await page.text();
  assert.match(pageHtml, /Less text\./);
  assert.match(pageHtml, /data-language="fa"/);

  const missingText = await fetch(`${baseUrl}/api/summarise`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "   " })
  });
  assert.equal(missingText.status, 400);

  const { response, stream } = await summarise(baseUrl, { text: "A sample source — résumé with emoji 🙂.", language: "fa" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  assert.match(stream, /event: delta/);
  assert.match(stream, /A concise summary\./);
  assert.match(stream, /event: done/);
});

test("validates language and localizes Persian validation errors", async (t) => {
  const { bin } = await fakeOpencode(t, "process.exit(0)");
  const { app, baseUrl } = await startApp({ OPENCODE_BIN: bin });
  t.after(() => app.kill());

  const empty = await fetch(`${baseUrl}/api/summarise`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: " ", language: "fa" })
  });
  assert.equal(empty.status, 400);
  assert.match((await empty.json()).error, /متنی/);

  const unsupported = await fetch(`${baseUrl}/api/summarise`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "hello", language: "fr" })
  });
  assert.equal(unsupported.status, 400);
  assert.match((await unsupported.json()).error, /en or fa/);
});

test("explains when the opencode CLI is not installed", async (t) => {
  const { app, baseUrl } = await startApp({ OPENCODE_BIN: "/nonexistent/opencode" });
  t.after(() => app.kill());

  const { stream } = await summarise(baseUrl, { text: "A sample source." });
  assert.match(stream, /event: error/);
  assert.match(stream, /Could not start the opencode CLI/);
});

test("explains when the free tier rejects the request", async (t) => {
  const { bin } = await fakeOpencode(
    t,
    emit({ type: "error", error: { data: { message: "OpenCode's free tier can only be used from within OpenCode." } } })
  );
  const { app, baseUrl } = await startApp({ OPENCODE_BIN: bin });
  t.after(() => app.kill());

  const { stream } = await summarise(baseUrl, { text: "A sample source.", language: "fa" });
  assert.match(stream, /event: error/);
  assert.match(stream, /سطح رایگان opencode/);
  assert.doesNotMatch(stream, /event: delta/);
});

test("stops a CLI run that exceeds the timeout", async (t) => {
  const { bin } = await fakeOpencode(t, `setTimeout(() => {}, 60_000)`);
  const { app, baseUrl } = await startApp({ OPENCODE_BIN: bin, OPENCODE_TIMEOUT_MS: "200" });
  t.after(() => app.kill());

  const { stream } = await summarise(baseUrl, { text: "A sample source." });
  assert.match(stream, /event: error/);
  assert.match(stream, /took too long/);
});

test("summarises Persian text in Persian even when the interface language is English", async (t) => {
  const { bin, args } = await fakeOpencode(t, emit(summaryEvent("خلاصه.")));
  const { app, baseUrl } = await startApp({ OPENCODE_BIN: bin });
  t.after(() => app.kill());

  const { stream } = await summarise(baseUrl, { text: "این یک متن فارسی برای آزمایش است.", language: "en" });
  assert.match(stream, /خلاصه\./);

  const passed = await args();
  assert.match(passed.at(-1), /Persian \(Farsi\)/);
  assert.doesNotMatch(passed.at(-1), /in English/);
});

test("passes the requested language and text to the CLI", async (t) => {
  const { bin, args } = await fakeOpencode(t, emit(summaryEvent("خلاصه.")));
  const { app, baseUrl } = await startApp({ OPENCODE_BIN: bin });
  t.after(() => app.kill());

  const { stream } = await summarise(baseUrl, { text: "متن نمونه", language: "fa" });
  assert.match(stream, /خلاصه\./);

  const passed = await args();
  assert.deepEqual(passed.slice(0, 4), ["run", "--agent", "summariser", "--model"]);
  assert.equal(passed[4], "opencode/deepseek-v4.1-flash-free");
  assert.deepEqual(passed.slice(5, 7), ["--format", "json"]);
  assert.match(passed.at(-1), /Persian \(Farsi\)/);
  assert.match(passed.at(-1), /متن نمونه/);
});
