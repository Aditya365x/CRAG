---
title: CRAG Corrective RAG
emoji: 🧭
colorFrom: indigo
colorTo: pink
sdk: docker
app_port: 7860
pinned: false
---

# CRAG — Corrective RAG: ask any PDF

Upload a PDF and ask a question. A LangGraph pipeline grades how well your PDF answers it, falls back to web search when it doesn't, and answers with page and web citations.

```
User uploads PDF ─► chunk (with page numbers) ─► MiniLM embeddings + BM25 ─► saved under doc_id
User asks question ─► hybrid search in that PDF ─► LLM grades 4 chunks (0–1)
      ├─ CORRECT   (any > 0.7) ─► answer from PDF only
      ├─ AMBIGUOUS (between)   ─► PDF + web search
      └─ INCORRECT (all < 0.3) ─► web search only
─► sentence filter ─► answer with citations [p.12] / [web 1]
─► report: verdict, chunk scores, % PDF vs % web, pages, URLs, LLM calls, latency
─► per-PDF stats: % of questions answered from the PDF
```

A demo document (Bishop, *Pattern Recognition and Machine Learning*) is indexed at build time, so the app works with zero uploads.

## Tech stack

| Layer | Tools |
|-------|-------|
| Orchestration | LangGraph |
| LLM | `meta-llama/llama-3.3-70b-instruct` via OpenRouter (any OpenAI-compatible provider) |
| Embeddings | `all-MiniLM-L6-v2` (384-dim) via fastembed / ONNX — no torch |
| Retrieval | FAISS `IndexFlatIP` (cosine) + BM25, fused with reciprocal rank fusion |
| Web search | Tavily |
| Backend / UI | FastAPI + vanilla HTML/CSS/JS |

## Run locally

```bash
cd crag-app
py -3.11 -m venv .venv            # Python 3.11
.venv\Scripts\activate             # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env             # then fill in LLM_API_KEY and TAVILY_API_KEY

python -m app.seed_demo            # optional: prebuild the demo book (~2.5 min)
uvicorn app.api:app --port 8000
```

Open http://localhost:8000 for the app and http://localhost:8000/docs for the API docs. Uploaded PDFs and their indexes live in `data/<doc_id>/`.

## API

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/upload` | Upload a PDF (multipart `file`); indexing runs in the background |
| `GET` | `/api/status/{doc_id}` | Indexing status and progress |
| `GET` | `/api/docs` | All documents with metadata and per-PDF stats |
| `POST` | `/api/query` | `{"doc_id", "question"}` → answer, verdict, chunk scores, sources, timings |
| `GET` | `/api/report/{doc_id}` | % of questions answered from the PDF / PDF + web / web only |
| `GET` | `/api/config` | Embedding and retrieval settings shown in the UI |
| `GET` | `/api/health` | Health check |

## Deploy

All targets use the Docker image, which bakes in the MiniLM model and the demo index. Set `LLM_API_KEY` (or `OPENROUTER_API_KEY`) and `TAVILY_API_KEY` as secrets on the host.

- **Render**: *New → Blueprint*, pick this repo; `render.yaml` defines the service.
- **Vercel**: `Dockerfile.vercel` runs the image as a container function. `vercel link`, add the two keys with `vercel env add`, then `vercel deploy --prod`. Vercel limits request bodies to 4.5 MB, so larger uploads fail there, and instances are stateless: uploads are kept only while an instance is warm.
- **Hugging Face Spaces**: create a Docker Space and push this folder; the YAML header above configures it.

On every host, uploads are stored on the container's disk and disappear on restart; the demo document is rebuilt into the image and always available.

## Project structure

```
crag-app/
├── app/
│   ├── config.py      # all settings, overridable with env vars
│   ├── ingest.py      # PDF → page-aware chunks → MiniLM → FAISS (one folder per doc_id)
│   ├── retrieval.py   # hybrid BM25 + vector search with RRF
│   ├── graph.py       # the CRAG LangGraph state machine
│   ├── service.py     # runs a question, builds the report, per-PDF stats
│   ├── api.py         # FastAPI: /api endpoints + web UI
│   ├── seed_demo.py   # prebuilds the demo document's index
│   ├── static/        # style.css, script.js
│   └── templates/     # index.html
├── documents/         # demo PDF
├── Dockerfile         # Render / Hugging Face Spaces
├── Dockerfile.vercel  # Vercel container
├── render.yaml
├── requirements.txt
└── .env.example
```
