---
title: CRAG Corrective RAG
emoji: 🧭
colorFrom: indigo
colorTo: pink
sdk: docker
app_port: 7860
pinned: false
---

# CRAG — Corrective Retrieval-Augmented Generation

A self-correcting RAG pipeline built with **LangGraph** and **FastAPI** that evaluates its own retrieval quality and adapts accordingly — falling back to web search when needed, then refining context at the sentence level before generating answers.

## Architecture

```
START → Retrieve → Evaluate Docs ──┬── CORRECT ──→ Refine → Generate → END
                                    │                    ↑
                                    ├── AMBIGUOUS ──→ Web Search
                                    │                    │
                                    └── INCORRECT ──→ Web Search
```

### Pipeline Steps

| Step | Node | Description |
|------|------|-------------|
| 1 | **Retrieve** | Pulls top-k chunks from the FAISS vector store |
| 2 | **Evaluate** | LLM scores each chunk for relevance to the question |
| 3 | **Route** | CORRECT (≥0.7) → refine; AMBIGUOUS / INCORRECT → web search |
| 4 | **Web Search** | Fallback: fetches external results via Tavily API |
| 5 | **Refine** | Decomposes context into sentences, filters irrelevant ones, recomposes |
| 6 | **Generate** | Produces the final answer using only the refined context |

## Tech Stack

| Layer | Tools |
|-------|-------|
| **Orchestration** | LangGraph (stateful multi-node pipeline) |
| **LLM** | `meta-llama/llama-3.2-1b-instruct` via OpenRouter (OpenAI-compatible API) |
| **Embeddings** | HuggingFace `all-MiniLM-L6-v2` |
| **Vector Store** | FAISS (in-memory) |
| **Web Search** | Tavily Search API |
| **Backend** | FastAPI + Uvicorn |
| **Frontend** | Vanilla HTML/CSS/JS (Jinja2 templates) |

## Setup

```bash
cd crag-app
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS / Linux

pip install -r requirements.txt
```

## Configuration

Copy `.env.example` to `.env` in `crag-app/` and fill in your keys (never commit `.env`):

```env
OPENROUTER_API_KEY=your-openrouter-key
TAVILY_API_KEY=your-tavily-key       # for web search fallback
```

Configurable settings in `app/config.py`:

| Setting | Default | Description |
|---------|---------|-------------|
| `llm_model` | `meta-llama/llama-3.2-1b-instruct` | OpenRouter model id |
| `llm_base_url` | `https://openrouter.ai/api/v1` | LLM API endpoint |
| `embed_model` | `all-MiniLM-L6-v2` | HuggingFace embedding model |
| `chunk_size` | `900` | Text chunk size for PDF splitting |
| `chunk_overlap` | `150` | Overlap between chunks |
| `k_retrieval` | `4` | Number of chunks to retrieve |
| `upper_th` | `0.7` | Confidence threshold for CORRECT verdict |
| `lower_th` | `0.3` | Threshold below which docs are INCORRECT |

## Usage

```bash
cd crag-app
python -m app.main
```

Open [http://localhost:8000](http://localhost:8000) and ask questions about the PDFs in `documents/`.

The FAISS index is cached in `faiss_index/`. Delete it (or run `python -m app.build_index`) after changing the documents.

## Deployment

The app ships as a Docker image that bakes in the embedding model and a prebuilt FAISS index, so cold starts don't re-embed the PDFs.

```bash
docker build -t crag-app .
docker run -p 7860:7860 -e OPENROUTER_API_KEY=... -e TAVILY_API_KEY=... crag-app
```

**Hugging Face Spaces** (free CPU tier, 16GB RAM): create a Space with the *Docker* SDK, push this folder to it, and add `OPENROUTER_API_KEY` and `TAVILY_API_KEY` under *Settings → Variables and secrets*. The YAML header at the top of this README configures the Space.

**Render**: *New → Blueprint* and point it at this repo; `render.yaml` defines the service. Set the two keys when prompted.

**Vercel**: `Dockerfile.vercel` deploys the same image as a Vercel container function (port 80, scales to zero, so expect a cold start of a few seconds). Run `vercel link`, add the keys with `vercel env add OPENROUTER_API_KEY` / `vercel env add TAVILY_API_KEY`, then `vercel deploy --prod`.

> Note: the OpenRouter provider for `llama-3.2-1b-instruct` supports neither tool calling nor JSON-schema mode, so the evaluator and filter nodes prompt for JSON and parse it leniently (`app/nodes.py`).

### API

`GET /documents` describes the knowledge base: indexed documents (title, author, pages, chunks, chapters), the embedding setup (model, dimensions, chunk size/overlap, top-k), and suggested questions. The UI's *Knowledge base* section is built from it.

```http
POST /ask
Content-Type: application/json

{"question": "What is the main topic of chapter 2?"}
```

Response:

```json
{
  "question": "...",
  "answer": "...",
  "verdict": "CORRECT",
  "reason": "At least one chunk scored > 0.7.",
  "good_docs_count": 3,
  "web_docs_count": 0,
  "refined_context": "..."
}
```

## Project Structure

```
crag-app/
├── app/
│   ├── main.py            # FastAPI server, endpoints
│   ├── build_index.py     # Prebuilds the FAISS index
│   ├── config.py          # Pydantic settings (env vars)
│   ├── llm.py             # LLM singleton (ChatOpenAI)
│   ├── embeddings.py      # HuggingFace embeddings singleton
│   ├── document_store.py  # PDF loading, chunking, FAISS indexing
│   ├── nodes.py           # LangGraph nodes + router
│   ├── pipeline.py        # Graph builder
│   ├── schemas.py         # Pydantic request/response models
│   ├── decompose.py       # Sentence decomposition utility
│   ├── static/
│   │   ├── style.css
│   │   └── script.js
│   └── templates/
│       └── index.html
├── documents/             # Source PDFs
├── Dockerfile
├── Dockerfile.vercel
├── render.yaml
├── requirements.txt
└── .env.example
```
