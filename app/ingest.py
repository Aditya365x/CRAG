"""PDF -> page-aware chunks -> MiniLM embeddings -> FAISS index on disk (one folder per doc_id)."""
import json
import re
import threading
import time
from typing import Callable, Optional

import faiss
import numpy as np
from pypdf import PdfReader
from langchain_text_splitters import RecursiveCharacterTextSplitter

from . import config

_embedder = None
_lock = threading.Lock()
_meta_lock = threading.Lock()


def get_embedder():
    """Load MiniLM once per process (about 1 s from the local cache)."""
    global _embedder
    with _lock:
        if _embedder is None:
            from fastembed import TextEmbedding
            _embedder = TextEmbedding(config.EMBED_MODEL, cache_dir=config.MODEL_CACHE)
    return _embedder


def embed(texts: list[str]) -> np.ndarray:
    vecs = np.array(list(get_embedder().embed(texts, batch_size=config.EMBED_BATCH)), dtype="float32")
    faiss.normalize_L2(vecs)                       # cosine similarity = inner product
    return vecs


def doc_dir(doc_id: str):
    return config.DATA_DIR / doc_id


def read_meta(doc_id: str) -> dict:
    p = doc_dir(doc_id) / "meta.json"
    return json.loads(p.read_text()) if p.exists() else {}


def write_meta(doc_id: str, **fields) -> dict:
    with _meta_lock:
        meta = {**read_meta(doc_id), **fields}
        d = doc_dir(doc_id)
        d.mkdir(parents=True, exist_ok=True)
        (d / "meta.json").write_text(json.dumps(meta, indent=2))
    return meta


def list_docs() -> list[dict]:
    docs = []
    for d in sorted(config.DATA_DIR.iterdir()) if config.DATA_DIR.exists() else []:
        meta = read_meta(d.name)
        if meta:
            docs.append({"doc_id": d.name, **meta})
    return docs


def _clean(text: str) -> str:
    text = text.encode("utf-8", "ignore").decode("utf-8", "ignore")
    text = re.sub(r"-\n(\w)", r"\1", text)          # join words hyphenated across lines
    return re.sub(r"[ \t]+", " ", text).strip()


def _describe(reader: PdfReader) -> dict:
    """Title, author and top-level numbered chapters from the PDF, when it has them."""
    info = reader.metadata or {}
    try:
        outline = [o.title for o in reader.outline if not isinstance(o, list)]
    except Exception:  # noqa: BLE001  (malformed outlines are common)
        outline = []
    outline = [re.sub(r"\s+", " ", t).strip() for t in outline]
    return {
        "title": (info.get("/Title") or "").strip(),
        "author": (info.get("/Author") or "").strip(),
        "chapters": [t for t in outline if re.match(r"^\d+\.", t)],
    }


def load_chunks(pdf_path: str, max_pages: int = config.MAX_PAGES) -> tuple[list[dict], int, dict]:
    reader = PdfReader(pdf_path)
    n_pages = min(len(reader.pages), max_pages)
    splitter = RecursiveCharacterTextSplitter(chunk_size=config.CHUNK_SIZE, chunk_overlap=config.CHUNK_OVERLAP)
    chunks = []
    for i in range(n_pages):
        text = _clean(reader.pages[i].extract_text() or "")
        for piece in splitter.split_text(text):
            if len(piece) > 50:                      # skip headers, page numbers, empty bits
                chunks.append({"text": piece, "page": i + 1})
    return chunks, n_pages, {**_describe(reader), "total_pages": len(reader.pages)}


def build_index(doc_id: str, pdf_path: str, name: str,
                progress: Optional[Callable[[float, str], None]] = None,
                max_pages: int = config.MAX_PAGES) -> dict:
    """Runs in the background after upload. Writes chunks.json, index.faiss and meta.json."""
    t0 = time.time()
    report = progress or (lambda f, msg: None)
    try:
        write_meta(doc_id, name=name, status="indexing", progress=0.0)
        report(0.02, "Reading PDF")
        chunks, n_pages, info = load_chunks(pdf_path, max_pages)
        if not chunks:
            raise ValueError("No text found. Scanned PDFs need OCR before upload.")
        write_meta(doc_id, **info)

        vecs, batch = [], 128
        for start in range(0, len(chunks), batch):
            vecs.append(embed([c["text"] for c in chunks[start:start + batch]]))
            frac = min(1.0, (start + batch) / len(chunks))
            write_meta(doc_id, progress=round(frac, 2))
            report(0.05 + 0.9 * frac, f"Embedding chunks {min(start + batch, len(chunks))}/{len(chunks)}")
        vecs = np.vstack(vecs)

        index = faiss.IndexFlatIP(vecs.shape[1])     # exact search; fine up to ~100k chunks
        index.add(vecs)
        d = doc_dir(doc_id)
        faiss.write_index(index, str(d / "index.faiss"))
        (d / "chunks.json").write_text(json.dumps(chunks))
        return write_meta(doc_id, status="ready", progress=1.0, pages=n_pages,
                          chunks=len(chunks), index_seconds=round(time.time() - t0, 1))
    except Exception as e:  # noqa: BLE001  (surface any failure to the UI)
        return write_meta(doc_id, status="error", error=str(e))
