import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
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

test("serves the page and streams a summary from the model endpoint", async (t) => {
  const providerPayloads = [];
  const mockProvider = createServer((request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.headers.authorization, "Bearer test-key");
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      providerPayloads.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    });
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write('data: {"choices":[{"delta":{"content":"A concise "}}]}\n\n');
    setTimeout(() => {
      response.write('data: {"choices":[{"delta":{"content":"summary."}}]}\n\n');
      response.end("data: [DONE]\n\n");
    }, 60);
  });
  const providerPort = await listen(mockProvider);
  const { app, baseUrl } = await startApp({
    OPENROUTER_API_KEY: "test-key",
    OPENAI_BASE_URL: `http://127.0.0.1:${providerPort}/v1/chat/completions`
  });
  t.after(() => {
    app.kill();
    mockProvider.close();
  });

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

  for (const language of ["en", "fa"]) {
    const response = await fetch(`${baseUrl}/api/summarise`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "A sample source — résumé with emoji 🙂.", language })
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/event-stream/);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const firstChunk = await reader.read();
    const firstText = decoder.decode(firstChunk.value);
    assert.match(firstText, /event: delta/);
    assert.match(firstText, /A concise/);
    assert.doesNotMatch(firstText, /event: done/);

    let stream = firstText;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      stream += decoder.decode(value, { stream: true });
    }
    assert.match(stream, /summary\./);
    assert.match(stream, /event: done/);
  }
  assert.equal(providerPayloads.length, 2);
  assert.equal(providerPayloads[0].messages[1].content, "A sample source — résumé with emoji 🙂.");
  assert.match(providerPayloads[0].messages[0].content, /in English/);
  assert.match(providerPayloads[1].messages[0].content, /Persian \(Farsi\)/);
});

test("validates language and localizes Persian validation errors", async (t) => {
  const mockProvider = createServer((request, response) => response.end());
  const providerPort = await listen(mockProvider);
  const { app, baseUrl } = await startApp({
    OPENROUTER_API_KEY: "test-key",
    OPENAI_BASE_URL: `http://127.0.0.1:${providerPort}/v1/chat/completions`
  });
  t.after(() => {
    app.kill();
    mockProvider.close();
  });

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

test("returns a clear error when the API key is not configured", async (t) => {
  const { app, baseUrl } = await startApp({ OPENAI_API_KEY: "" });
  t.after(() => app.kill());

  const response = await fetch(`${baseUrl}/api/summarise`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "A sample source.", language: "fa" })
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /OPENROUTER_API_KEY/);
});
