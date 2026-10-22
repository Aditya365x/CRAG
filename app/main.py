import os
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from app.schemas import AskRequest, AskResponse
from app.pipeline import build_graph
from app.document_store import get_vector_store
app = FastAPI(title="CRAG — Corrective RAG")

# Serve static assets & templates
static_dir = os.path.join(os.path.dirname(__file__), "static")
templates_dir = os.path.join(os.path.dirname(__file__), "templates")
app.mount("/static", StaticFiles(directory=static_dir), name="static")
templates = Jinja2Templates(directory=templates_dir)

_graph = None


@app.on_event("startup")
def startup():
    global _graph
    get_vector_store()
    _graph = build_graph()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.post("/ask", response_model=AskResponse)
def ask(req: AskRequest):
    global _graph
    try:
        result = _graph.invoke({"question": req.question})
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Pipeline failed: {e}")

    return AskResponse(
        question=req.question,
        answer=result.get("answer") or "No answer generated.",
        verdict=result.get("verdict") or "UNKNOWN",
        reason=result.get("reason") or "",
        good_docs_count=len(result.get("good_docs") or []),
        web_docs_count=len(result.get("web_docs") or []),
        refined_context=result.get("refined_context") or "",
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.getenv("PORT", 8000)))
