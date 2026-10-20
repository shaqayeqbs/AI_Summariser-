import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const apiUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1/chat/completions";
const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";
const maxTextLength = 20_000;
const maxRequestBytes = maxTextLength * 6 + 1024;
const errorMessages = {
  en: {
    emptyText: "Paste some text to summarise.",
    textTooLong: (limit) => `Text must be ${limit} characters or fewer.`,
    invalidLanguage: "Language must be en or fa.",
    missingApiKey: "The server is missing OPENAI_API_KEY. Add it to your environment and restart the app."
  },
  fa: {
    emptyText: "لطفاً متنی برای خلاصه‌سازی وارد کنید.",
    textTooLong: (limit) => `متن باید حداکثر ${limit} نویسه باشد.`,
    invalidLanguage: "زبان باید انگلیسی یا فارسی باشد.",
    missingApiKey: "کلید OPENAI_API_KEY در سرور تنظیم نشده است. آن را به متغیرهای محیطی اضافه کنید و برنامه را دوباره اجرا کنید."
  }
};

const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]]
]);

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxRequestBytes) {
      throw Object.assign(new Error("Request body is too large."), { status: 413 });
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON."), { status: 400 });
  }
}

async function handleSummarise(request, response) {
  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    sendJson(response, error.status ?? 400, { error: error.message });
    return;
  }

  const language = payload?.language ?? "en";
  if (language !== "en" && language !== "fa") {
    sendJson(response, 400, { error: errorMessages.en.invalidLanguage });
    return;
  }

  const messages = errorMessages[language];
  const text = typeof payload?.text === "string" ? payload.text.trim() : "";
  if (!text) {
    sendJson(response, 400, { error: messages.emptyText });
    return;
  }
  if (text.length > maxTextLength) {
    sendJson(response, 413, { error: messages.textTooLong(maxTextLength.toLocaleString(language)) });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    sendJson(response, 503, { error: messages.missingApiKey });
    return;
  }

  const controller = new AbortController();
  response.on("close", () => {
    if (!response.writableEnded) controller.abort();
  });

  let upstream;
  try {
    upstream = await fetch(apiUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          {
            role: "system",
            content: `Summarise the user's text clearly and accurately in ${language === "fa" ? "Persian (Farsi)" : "English"}. Preserve the key points, use concise plain language, and do not add information that is not in the source.`
          },
          { role: "user", content: text }
        ]
      })
    });
  } catch (error) {
    if (controller.signal.aborted) return;
    sendJson(response, 502, { error: `Could not reach the summarisation service: ${error.message}` });
    return;
  }

  if (!upstream.ok) {
    const details = await upstream.text();
    let message = `Summarisation service returned ${upstream.status}.`;
    try {
      message = JSON.parse(details).error?.message ?? message;
    } catch {
      if (details) message = details.slice(0, 500);
    }
    sendJson(response, upstream.status === 401 ? 502 : upstream.status, { error: message });
    return;
  }

  if (!upstream.body) {
    sendJson(response, 502, { error: "The summarisation service returned an empty response." });
    return;
  }

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-content-type-options": "nosniff"
  });

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const sendEvent = (event, data) => response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let chunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta) sendEvent("delta", { text: delta });
      }

      if (done) break;
    }
    sendEvent("done", {});
    response.end();
  } catch (error) {
    if (controller.signal.aborted) return;
    sendEvent("error", { error: `The summary stream ended unexpectedly: ${error.message}` });
    response.end();
  } finally {
    reader.releaseLock();
  }
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "POST" && requestUrl.pathname === "/api/summarise") {
    await handleSummarise(request, response);
    return;
  }

  if (request.method === "GET" && assets.has(requestUrl.pathname)) {
    const [filename, contentType] = assets.get(requestUrl.pathname);
    try {
      const content = await readFile(path.join(root, "public", filename));
      response.writeHead(200, { "content-type": contentType, "x-content-type-options": "nosniff" });
      response.end(content);
    } catch (error) {
      console.error(`Failed to read ${filename}:`, error);
      sendJson(response, 500, { error: "Could not load the application." });
    }
    return;
  }

  sendJson(response, 404, { error: "Not found." });
});

server.listen(port, () => {
  console.log(`Summariser running at http://localhost:${port}`);
});
