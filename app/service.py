"""Runs one question through CRAG and turns the raw state into the numbers the user sees."""
import threading
import time
from collections import Counter

from langchain_core.callbacks import BaseCallbackHandler

from . import config, storage
from .graph import crag_app
from .ingest import read_meta, write_meta

_cache: dict[tuple[str, str], dict] = {}
_history_lock = threading.Lock()


class CallCounter(BaseCallbackHandler):
    def __init__(self):
        self.calls = 0

    def on_llm_end(self, response, **kwargs):
        self.calls += 1


def ask(doc_id: str, question: str) -> dict:
    if not config.LLM_API_KEY:
        raise ValueError("LLM_API_KEY is not set. Add it to .env or your host's environment variables.")
    meta = read_meta(doc_id)
    if not meta:
        raise ValueError("This document is no longer available (uploads are cleared when the server "
                         "restarts). Please upload it again.")
    if meta.get("status") != "ready":
        raise ValueError(f"Document {doc_id} is not ready (status: {meta.get('status', 'unknown')}).")
    question = question.strip()
    key = (doc_id, question.lower())
    if key in _cache:
        return {**_cache[key], "cached": True}

    counter, t0 = CallCounter(), time.perf_counter()
    state = crag_app.invoke({"doc_id": doc_id, "question": question}, config={"callbacks": [counter]})
    result = build_report(state, latency=time.perf_counter() - t0, llm_calls=counter.calls)
    record_verdict(doc_id, result["verdict"])
    result["book_report"] = book_report(doc_id)
    _cache[key] = result
    return {**result, "cached": False}


def build_report(state: dict, latency: float, llm_calls: int) -> dict:
    kept = state.get("kept_strips", [])
    n_book = sum(s["source"] == "book" for s in kept)
    n_web = len(kept) - n_book
    total = max(len(kept), 1)
    kept_pages = {s["ref"] for s in kept if s["source"] == "book"}

    chunk_scores = [
        {"rank": i + 1, "page": d.metadata["page"], "score": round(s, 2),
         "used": s > config.LOWER_TH and state["verdict"] != "INCORRECT",
         "preview": d.page_content[:120] + "..."}
        for i, (d, s) in enumerate(zip(state.get("docs", []), state.get("scores", [])))
    ]
    web_sources = [{"title": d.metadata.get("title", ""), "url": d.metadata.get("url", "")}
                   for d in state.get("web_docs", [])]
    return {
        "question": state["question"],
        "answer": state.get("answer", ""),
        "verdict": state["verdict"],
        "reason": state.get("reason", ""),
        "best_book_score": round(max(state.get("scores", [0.0]) or [0.0]), 2),
        "chunk_scores": chunk_scores,
        "evidence_from_book_pct": round(100 * n_book / total) if kept else 0,
        "evidence_from_web_pct": round(100 * n_web / total) if kept else 0,
        "book_pages_used": sorted(kept_pages),
        "web_query": state.get("web_query", ""),
        "web_sources": web_sources,
        "sentences_in": len(state.get("strips", [])),
        "sentences_kept": len(kept),
        "llm_calls": llm_calls,
        "latency_s": round(latency, 2),
    }


def record_verdict(doc_id: str, verdict: str) -> None:
    with _history_lock:
        history = read_meta(doc_id).get("verdicts", [])
        write_meta(doc_id, verdicts=history + [verdict])
    storage.push(doc_id, "meta.json")


def book_report(doc_id: str) -> dict:
    verdicts = read_meta(doc_id).get("verdicts", [])
    n = len(verdicts)
    c = Counter(verdicts)
    return {
        "questions": n,
        **{f"{v.lower()}_pct": (round(100 * c[v] / n) if n else 0) for v in ("CORRECT", "AMBIGUOUS", "INCORRECT")},
    }
