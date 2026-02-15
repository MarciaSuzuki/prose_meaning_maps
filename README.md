# Ruth Meaning Map Studio

A two-agent workflow for building and reviewing Prose Meaning Maps for the book of Ruth using BHSA data. The app includes:
- Passage selection and BHSA display (word, clause, phrase data).
- Agent 1 (Builder) prompt + iterative draft loop.
- Agent 2 (Reviewer) checklist generation.
- Cumulative approvals with export to Markdown/JSON.
- Direct Anthropic API integration with Extended Thinking.
- Shared approved maps across users via server storage.

## Local Setup

1. Install dependencies:

```bash
cd "/Users/marciasuzuki/Documents/New project/ruth-meaning-map-app"
npm install
```

2. Create a local `.env` file from `.env.example` and add your Anthropic key.

3. Run both frontend and API server:

```bash
npm run dev:full
```

- Frontend: `http://localhost:5173`
- API server: `http://localhost:8787`

If you want to run them separately:

```bash
npm run dev
npm run dev:server
```

## Vercel Deployment (Single Host)

This repo is ready for Vercel. The `/api` folder contains serverless functions.

1. Push this repo to GitHub.
2. Import the repo into Vercel.
3. In Vercel → Project → Settings → Environment Variables, add:

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL` (default `claude-opus-4-6`)
- `ANTHROPIC_THINKING_BUDGET` (default `2000`)
- `ANTHROPIC_MAX_TOKENS` (default `4096`)

### Shared Data (Multi-user)

Approved meaning maps are shared through server storage. For production, add an **Upstash Redis** integration (Vercel Marketplace) and set these env vars:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

If the Redis variables are missing, the app falls back to in-memory storage (not shared, resets on deploy).

## Configuration

- Server variables are read from `.env`.
- The frontend can override the API base URL with `VITE_API_BASE_URL`.
- The UI exposes model, max tokens, temperature, and Extended Thinking budget controls.

## BHSA Data

The Ruth BHSA dataset is bundled as JSON in:

`/Users/marciasuzuki/Documents/New project/ruth-meaning-map-app/src/data/ruth_bhsa.json`

To regenerate from your local BHSA TF dataset:

```bash
npm run extract:bhsa
```

