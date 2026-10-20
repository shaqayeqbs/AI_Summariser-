# Briefly

A small, local text summariser with streamed output in English and Persian (Farsi). The app uses OpenRouter's OpenAI-compatible streaming API by default, with its free-model router.

## Run locally

Requires Node.js 20 or later.

Create an OpenRouter API key at [openrouter.ai/keys](https://openrouter.ai/keys), then create a local `.env` file from the example and add the key:

```sh
cp .env.example .env
# Edit .env and replace the placeholder with your API key.
npm start
```

Open [http://localhost:3000](http://localhost:3000) and keep the `npm start` terminal running while using the app. The API key stays on the server and is never sent to the browser. The default model `openrouter/free` routes to available free models; free model availability and rate limits can vary.

Alternatively, set `OPENAI_API_KEY` in your shell before running `npm start`. The app loads `.env` automatically; restart it after changing the file. Never commit or share your `.env` file.

If the browser reports that it cannot reach the app server, restart it with `npm start`. If the server is reachable but the API key is missing or invalid, the app shows that service error in the selected language.

Optional environment variables:

- `PORT` — server port (default `3000`)
- `OPENROUTER_API_KEY` — OpenRouter key (preferred); `OPENAI_API_KEY` is accepted for compatibility
- `OPENAI_MODEL` — model name (default `openrouter/free`)
- `OPENAI_BASE_URL` — chat completions URL (default `https://openrouter.ai/api/v1/chat/completions`)

The `POST /api/summarise` endpoint accepts `{"text":"...","language":"en"}` (use `"fa"` for Persian) and returns a server-sent event stream with `delta`, `error`, and `done` events. The interface direction, summary language, and Persian Vazirmatn font follow the selected language. Input is limited to 20,000 characters.
