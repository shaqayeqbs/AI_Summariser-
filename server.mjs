import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const opencodeBin = process.env.OPENCODE_BIN ?? "opencode";
const model = process.env.OPENCODE_MODEL ?? "opencode/deepseek-v4.1-flash-free";
const timeoutMs = Number(process.env.OPENCODE_TIMEOUT_MS ?? 120_000);
const maxTextLength = 20_000;
const maxRequestBytes = maxTextLength * 6 + 1024;

// ponytail: the free tier rejects requests when the read tool is disabled, so it stays on.
// The summariser agent is told never to use tools and runs in the temp directory instead.
const opencodeConfig = JSON.stringify({
  agent: {
    summariser: {
      mode: "primary",
      prompt: "You are a text summariser. Reply with the summary only: no preamble, headings, or commentary. Never use tools.",
      tools: {
        bash: false, edit: false, write: false, grep: false, glob: false,
        list: false, webfetch: false, task: false, patch: false,
        todowrite: false, question: false
      }
    }
  }
});

const errorMessages = {
  en: {
    emptyText: "Paste some text to summarise.",
    textTooLong: (limit) => `Text must be ${limit} characters or fewer.`,
    invalidLanguage: "Language must be en or fa.",
    missingCli: "Could not start the opencode CLI. Install it from https://opencode.ai and restart the app.",
    freeTierRejected: "The opencode free tier rejected this request. Update opencode to the latest version and restart the app.",
    failed: (detail) => `The summariser failed: ${detail}`,
    timedOut: "The summariser took too long and was stopped. Please try again.",
    emptySummary: "The summariser returned an empty summary. Please try again."
  },
  fa: {
    emptyText: "لطفاً متنی برای خلاصه‌سازی وارد کنید.",
    textTooLong: (limit) => `متن باید حداکثر ${limit} نویسه باشد.`,
    invalidLanguage: "زبان باید انگلیسی یا فارسی باشد.",
    missingCli: "اجرای opencode ممکن نشد. آن را از https://opencode.ai نصب کنید و برنامه را دوباره اجرا کنید.",
    freeTierRejected: "سطح رایگان opencode این درخواست را نپذیرفت. opencode را به آخرین نسخه به‌روزرسانی کنید و برنامه را دوباره اجرا کنید.",
    failed: (detail) => `خلاصه‌سازی ناموفق بود: ${detail}`,
    timedOut: "خلاصه‌سازی بیش از حد طول کشید و متوقف شد. دوباره تلاش کنید.",
    emptySummary: "سرویس خلاصه‌سازی خلاصه‌ی خالی برگرداند. دوباره تلاش کنید."
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

function summarise(text, languageName, messages, sendEvent, done) {
  const prompt = `Summarise the following text and reply only in ${languageName}, with no preamble. Text: ${text}`;
  const child = spawn(
    opencodeBin,
    ["run", "--agent", "summariser", "--model", model, "--format", "json", prompt],
    {
      cwd: tmpdir(),
      env: { ...process.env, OPENCODE_CONFIG_CONTENT: opencodeConfig },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  let summary = "";
  let buffer = "";
  let stderr = "";
  let failure;
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (summary) {
      sendEvent("delta", { text: summary });
      sendEvent("done", {});
    } else {
      sendEvent("error", { error: failure ?? messages.emptySummary });
    }
    done();
  };

  const timer = setTimeout(() => {
    failure = messages.timedOut;
    child.kill("SIGKILL");
  }, timeoutMs);

  child.on("error", (error) => {
    failure = error.code === "ENOENT" ? messages.missingCli : messages.failed(error.message);
    finish();
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === "text" && typeof event.part?.text === "string") {
        summary += event.part.text;
      } else if (event.type === "error") {
        const detail = event.error?.data?.message ?? event.error?.name ?? "unknown error";
        failure = /free tier|FreeTierError/i.test(detail)
          ? messages.freeTierRejected
          : messages.failed(detail);
      }
    }
  });

  child.on("close", () => {
    if (!summary && !failure) failure = messages.failed((stderr.trim() || "opencode exited without output").slice(0, 300));
    finish();
  });

  return () => {
    finished = true;
    clearTimeout(timer);
    child.kill("SIGKILL");
  };
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

  // Persian input is summarised in Persian even when the interface is in English.
  const persianLetters = text.match(/\p{Script=Arabic}/gu)?.length ?? 0;
  const latinLetters = text.match(/[A-Za-z]/g)?.length ?? 0;
  const summaryLanguage = persianLetters > latinLetters ? "fa" : language;

  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-content-type-options": "nosniff"
  });

  let closed = false;
  const sendEvent = (event, data) => {
    if (!closed) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const stop = summarise(text, summaryLanguage === "fa" ? "Persian (Farsi)" : "English", errorMessages[summaryLanguage], sendEvent, () => {
    closed = true;
    response.end();
  });

  response.on("close", () => {
    if (!response.writableEnded) {
      closed = true;
      stop();
    }
  });
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
