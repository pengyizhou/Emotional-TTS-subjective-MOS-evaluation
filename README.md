# Emotional TTS Subjective MOS Evaluation

This project now supports **Azure VM deployment with Nginx + backend API**, so evaluator progress and ratings can be saved in near real-time on the server.

## What this system does
- Collect evaluator email on welcome page.
- Emotion labels are not shown to evaluators during scoring (blind setup).
- Enforce fixed emotion sequence:
  `happy -> sad -> surprised -> disgusted -> neutral -> fearful -> angry`.
- 5 tasks per emotion (35 tasks total).
- Each task contains 1 reference clip (`model0`, ground-truth, not scored) followed by 6 model clips shown in deterministic shuffled order.
- For each clip, collect 4 metrics (0–5):
  - Intelligibility（可懂度）
  - Naturalness（自然度）
  - Emotional expressiveness（情感表达丰富度）
  - Overall quality（音频质量）
- Resume support if user disconnects.
- Realtime server persistence when API is available.

---

## Data structure

```text
data/
  manifest.json
  happy/model1/sample1.wav ... sample5.wav
  ...
  angry/model0/sample1.wav ... sample5.wav
  angry/model6/sample1.wav ... sample5.wav
```

`data/manifest.json` includes transcript text and audio paths.

> Use web paths (e.g., `./data/happy/model1/sample1.wav`), **not local filesystem paths** like `/home/...`.
> The frontend tries to auto-convert accidental absolute paths containing `/data/`, but relative web paths are strongly recommended.

### Important manifest fields

```json
{
  "repository": "OWNER/REPO",
  "apiBase": "/api"
}
```

- `apiBase`: backend API base URL.
  - On same domain with Nginx reverse proxy: `"/api"`.
  - If API is separate host: e.g. `"https://your-api.example.com/api"`.

---

## Realtime save behavior

### With Azure Nginx + API (recommended)
- Frontend saves to localStorage **and** POSTs state to backend API each step.
- Backend stores:
  - `results/sessions/<evaluatorId>.json` (latest full session state)
  - `results/events.jsonl` (append-only event log)

### Without API (GitHub Pages-only mode)
- Falls back to localStorage only.
- Still allows JSON download / GitHub Issue submission.

---

## Azure deployment (Nginx + API)

This repo includes:
- `docker-compose.yml`
- `deploy/nginx/default.conf`
- `backend/server.py` (Flask API)

### 1) Prepare VM
Install Docker + Docker Compose plugin on Azure VM.

### 2) Run services

```bash
docker compose up -d --build
```

This starts:
- `web` (Nginx, port 80)
- `api` (Flask API, internal)

### 3) Verify

```bash
curl http://<your-domain-or-ip>/api/health
```

Expected:

```json
{"status":"ok", ...}
```

### 4) Results location
Server-side files are written under:

```text
results/
  events.jsonl
  sessions/
    <evaluatorId>.json
```

---

## API endpoints

- `GET /api/health`
- `POST /api/state/load` body: `{ "evaluatorId": "..." }`
- `POST /api/state/save` body: `{ "state": {...}, "source": "next|start|restart|completed" }`
- `POST /api/result/finalize` body: `{ "state": {...} }`

---

## Privacy & notes
- Email is currently stored in session JSON for resume purposes.
- If needed, you can anonymize further by storing only hashed IDs.
- If you need data in Git history, add a periodic cron/job to commit `results/` to a private repository.


### Troubleshooting audio path cache
If you changed `manifest.json` paths but still see old broken audio links, click **Start over** (or clear browser localStorage) so cached session task paths are refreshed.
