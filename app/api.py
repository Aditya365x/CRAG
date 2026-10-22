"""FastAPI app: REST endpoints under /api and the web UI at /."""
import shutil
import threading
import uuid
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.concurrency import run_in_threadpool
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from . import config, storage
from .ingest import build_index, doc_dir, list_docs, read_meta, write_meta
from .service import ask, book_report

app = FastAPI(title="Corrective RAG API")

_here = Path(__file__).parent
app.mount("/static", StaticFiles(directory=_here / "static"), name="static")
templates = Jinja2Templates(directory=_here / "templates")


@app.on_event("startup")
def preload_demo_pdf():
    """Index the demo PDF once if the image didn't already ship it prebuilt (see app/seed_demo.py)."""
    path = Path(config.DEMO_PDF)
    if not path.exists() or read_meta(config.DEMO_DOC_ID).get("status") == "ready":
        return
    threading.Thread(target=build_index, daemon=True,
                     args=(config.DEMO_DOC_ID, str(path), path.name),
                     kwargs={"max_pages": 10_000}).start()


class QueryIn(BaseModel):
    doc_id: str
    question: str


def _public(meta: dict) -> dict:
    return {k: v for k, v in meta.items() if k != "verdicts"}


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse(request, "index.html")


@app.get("/api/health")
def health():
    return {"ok": True, "llm": config.LLM_MODEL, "web_search": bool(config.TAVILY_API_KEY)}


@app.get("/api/config")
def settings():
    """What the UI shows about how documents are embedded and searched."""
    return {
        "llm": config.LLM_MODEL,
        "web_search": bool(config.TAVILY_API_KEY),
        "max_upload_mb": config.MAX_UPLOAD_MB,
        "max_pages": config.MAX_PAGES,
        "demo_doc_id": config.DEMO_DOC_ID,
        "demo_questions": config.DEMO_QUESTIONS,
        "embeddings": {
            "model": config.EMBED_MODEL,
            "dimensions": config.EMBED_DIM,
            "chunk_size": config.CHUNK_SIZE,
            "chunk_overlap": config.CHUNK_OVERLAP,
            "retrieval": f"Hybrid: BM25 + vectors, RRF (k={config.RRF_K})",
            "candidates": config.CANDIDATES,
            "top_k": config.TOP_K,
            "vector_store": "FAISS IndexFlatIP (cosine)",
        },
    }


@app.post("/api/upload")
async def upload(file: UploadFile, bg: BackgroundTasks):
    if not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are supported.")
    doc_id = uuid.uuid4().hex[:8]
    d = doc_dir(doc_id)
    d.mkdir(parents=True, exist_ok=True)
    with open(d / "source.pdf", "wb") as f:
        shutil.copyfileobj(file.file, f)
    if (d / "source.pdf").stat().st_size > config.MAX_UPLOAD_MB * 1024 * 1024:
        shutil.rmtree(d)
        raise HTTPException(413, f"File is larger than {config.MAX_UPLOAD_MB} MB.")
    write_meta(doc_id, name=file.filename, status="queued", progress=0.0)
    if storage.ENABLED:
        # Stateless hosts: finish indexing inside this request, then the index lives in shared storage.
        meta = await run_in_threadpool(build_index, doc_id, str(d / "source.pdf"), file.filename)
        return {"doc_id": doc_id, "status": meta["status"]}
    bg.add_task(build_index, doc_id, str(d / "source.pdf"), file.filename)
    return {"doc_id": doc_id, "status": "queued"}


@app.get("/api/status/{doc_id}")
def status(doc_id: str):
    meta = read_meta(doc_id)
    if not meta:
        raise HTTPException(404, "Unknown doc_id.")
    return _public(meta)


@app.get("/api/docs")
def docs():
    return [{**_public(d), "report": book_report(d["doc_id"])} for d in list_docs()]


@app.post("/api/query")
def query(body: QueryIn):
    try:
        return ask(body.doc_id, body.question)
    except ValueError as e:
        raise HTTPException(409, str(e)) from e
    except Exception as e:  # noqa: BLE001  (LLM / provider failures)
        raise HTTPException(502, f"Pipeline failed: {e}") from e


@app.get("/api/report/{doc_id}")
def report(doc_id: str):
    if not read_meta(doc_id):
        raise HTTPException(404, "Unknown doc_id.")
    return book_report(doc_id)


if __name__ == "__main__":
    import os

    import uvicorn

    uvicorn.run("app.api:app", host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
