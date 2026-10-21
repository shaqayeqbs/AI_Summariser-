# Briefly

A small, local text summariser with streamed output in English and Persian (Farsi). Summaries come from the free DeepSeek V4.1 Flash model on [opencode](https://opencode.ai), called through the `opencode` CLI.

## Run locally

Requires Node.js 20 or later and the [opencode CLI](https://opencode.ai) on your `PATH` (`opencode auth login` once if you have not used it before).

```sh
npm start
```

Open [http://localhost:3000](http://localhost:3000) and keep the `npm start` terminal running while using the app. No API key lives in this project: the CLI uses its own saved credentials, and the model runs on opencode's free tier.

If the browser reports that it cannot reach the app server, restart it with `npm start`. If the CLI is missing or the free tier rejects a request, the app shows that error in the selected language.

Optional environment variables (see `.env.example`):

- `PORT` — server port (default `3000`)
- `OPENCODE_MODEL` — model to run (default `opencode/deepseek-v4.1-flash-free`)
- `OPENCODE_BIN` — path to the CLI if it is not on `PATH` (default `opencode`)
- `OPENCODE_TIMEOUT_MS` — per-request timeout in milliseconds (default `120000`)

The `POST /api/summarise` endpoint accepts `{"text":"...","language":"en"}` (use `"fa"` for Persian) and returns a server-sent event stream with `delta`, `error`, and `done` events. The interface direction, summary language, and Persian Vazirmatn font follow the selected language. Input is limited to 20,000 characters.

## How it works

`server.mjs` spawns `opencode run --format json` with a restricted `summariser` agent, streams the summary back as SSE, and kills the process if the browser disconnects. Run `npm test` to exercise the routes with a stub CLI.
