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
| **LLM** | Kimi K2.6 (Moonshot) via OpenAI-compatible API |
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

Create `.env` in `crag-app/` or edit `app/config.py`:

```env
KIMI_API_KEY=your-moonshot-api-key
HUGGINGFACE_API_KEY=your-hf-key      # optional for public models
TAVILY_API_KEY=your-tavily-key       # for web search fallback
```

Configurable settings in `app/config.py`:

| Setting | Default | Description |
|---------|---------|-------------|
| `llm_model` | `kimi-k2.6` | LLM model name |
| `llm_base_url` | `https://api.moonshot.ai/v1` | LLM API endpoint |
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

Open [http://localhost:8000](http://localhost:8000) and ask questions about the documents in the `documents/` directory.

### API

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
├── requirements.txt
└── .env
```
