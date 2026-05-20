from typing import List, Literal
from langchain_core.documents import Document
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel

from app.config import settings
from app.llm import get_llm
from app.document_store import get_retriever
from app.decompose import decompose_to_sentences

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------
class GraphState(BaseModel):
    question: str = ""
    docs: List[Document] = []
    good_docs: List[Document] = []
    web_docs: List[Document] = []
    verdict: str = ""
    reason: str = ""
    strips: List[str] = []
    kept_strips: List[str] = []
    refined_context: str = ""
    answer: str = ""

# ---------------------------------------------------------------------------
# Pydantic schemas for structured LLM output
# ---------------------------------------------------------------------------
class DocEvalScore(BaseModel):
    score: float
    reason: str


class KeepOrDrop(BaseModel):
    keep: bool


# ---------------------------------------------------------------------------
# Build reusable prompt + chain helpers (lazy — uses current LLM instance)
# ---------------------------------------------------------------------------
def _eval_chain():
    llm = get_llm()
    prompt = ChatPromptTemplate.from_messages([
        (
            "system",
            "You are a strict retrieval evaluator for RAG.\n"
            "Return a relevance score in [0.0, 1.0].\n"
            "- 1.0: chunk alone is sufficient to answer fully/mostly\n"
            "- 0.0: chunk is irrelevant\n"
            "Be conservative with high scores.\n"
            "Also return a short reason.\n"
            "Output JSON only.",
        ),
        ("human", "Question: {question}\n\nChunk:\n{chunk}"),
    ])
    return prompt | llm.with_structured_output(DocEvalScore)


def _filter_chain():
    llm = get_llm()
    prompt = ChatPromptTemplate.from_messages([
        (
            "system",
            "You are a strict relevance filter.\n"
            "Return keep=true only if the sentence directly helps answer the question.\n"
            "Use ONLY the sentence. Output JSON only.",
        ),
        ("human", "Question: {question}\n\nSentence:\n{sentence}"),
    ])
    return prompt | llm.with_structured_output(KeepOrDrop)


# ---------------------------------------------------------------------------
# Graph nodes
# ---------------------------------------------------------------------------
def retrieve_node(state: GraphState) -> dict:
    """Retrieve relevant document chunks from the vector store."""
    q = state.question
    retriever = get_retriever()
    if retriever is None:
        return {"docs": []}
    docs = retriever.invoke(q)
    return {"docs": docs}


def eval_each_doc_node(state: GraphState) -> dict:
    """Score each retrieved chunk; decide CORRECT / INCORRECT / AMBIGUOUS."""
    q = state.question
    docs = state.docs

    if not docs:
        return {
            "good_docs": [],
            "verdict": "INCORRECT",
            "reason": "No documents retrieved.",
        }

    chain = _eval_chain()
    scores: List[float] = []
    good: List[Document] = []

    for d in docs:
        out = chain.invoke({"question": q, "chunk": d.page_content})
        scores.append(out.score)
        if out.score > settings.lower_th:
            good.append(d)

    if any(s > settings.upper_th for s in scores):
        return {
            "good_docs": good,
            "verdict": "CORRECT",
            "reason": f"At least one chunk scored > {settings.upper_th}.",
        }

    if scores and all(s < settings.lower_th for s in scores):
        return {
            "good_docs": [],
            "verdict": "INCORRECT",
            "reason": f"All chunks scored < {settings.lower_th}.",
        }

    return {
        "good_docs": good,
        "verdict": "AMBIGUOUS",
        "reason": f"No chunk scored > {settings.upper_th}, but not all were < {settings.lower_th}.",
    }


def web_search_node(state: GraphState) -> dict:
    """Fallback web search via Tavily (used for INCORRECT & AMBIGUOUS)."""
    from langchain_community.tools.tavily_search import TavilySearchResults

    q = state.question

    try:
        tavily = TavilySearchResults(
            max_results=3,
            tavily_api_key=settings.tavily_api_key,
        )
        results = tavily.invoke({"query": q})

        web_docs = []
        for r in results:
            content = r.get("content", "")
            if content:
                web_docs.append(
                    Document(
                        page_content=content,
                        metadata={"source": r.get("url", "web")},
                    )
                )
        return {"web_docs": web_docs}
    except Exception as e:
        print(f"Web search failed: {e}")
        return {"web_docs": []}


def refine_node(state: GraphState) -> dict:
    """Decompose → filter → recompose the context based on verdict."""
    q = state.question
    verdict = state.verdict

    if verdict == "CORRECT":
        docs_to_use = state.good_docs
    elif verdict == "INCORRECT":
        docs_to_use = state.web_docs
    else:  # AMBIGUOUS
        docs_to_use = state.good_docs + state.web_docs

    if not docs_to_use:
        return {
            "strips": [],
            "kept_strips": [],
            "refined_context": "",
        }

    context = "\n\n".join(d.page_content for d in docs_to_use).strip()

    # 1) decompose
    strips = decompose_to_sentences(context)

    # 2) filter with LLM
    chain = _filter_chain()
    kept: List[str] = []
    for s in strips:
        try:
            if chain.invoke({"question": q, "sentence": s}).keep:
                kept.append(s)
        except Exception:
            kept.append(s)  # keep on error — be permissive

    # 3) recompose
    refined_context = "\n".join(kept).strip()

    return {
        "strips": strips,
        "kept_strips": kept,
        "refined_context": refined_context,
    }


def generate_node(state: GraphState) -> dict:
    """Generate the final answer from the refined context."""
    llm = get_llm()

    prompt = ChatPromptTemplate.from_messages([
        (
            "system",
            "You are a helpful ML tutor. Answer ONLY using the provided context.\n"
            "If the context is empty or insufficient, say: "
            "'I don't know based on the provided context.'",
        ),
        ("human", "Question: {question}\n\nRefined context:\n{refined_context}"),
    ])

    out = (prompt | llm).invoke({
        "question": state.question,
        "refined_context": state.refined_context,
    })

    return {"answer": out.content}


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------
def route_after_eval(state: GraphState) -> Literal["refine", "web_search"]:
    """Route to refine (CORRECT) or web_search (INCORRECT / AMBIGUOUS)."""
    if state.verdict == "CORRECT":
        return "refine"
    return "web_search"
