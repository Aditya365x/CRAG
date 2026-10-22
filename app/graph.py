"""Corrective RAG as a LangGraph state machine."""
import re
from functools import lru_cache
from typing import List, TypedDict

import openai
from langchain_core.documents import Document
from langchain_core.prompts import ChatPromptTemplate
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from pydantic import BaseModel

from . import config
from .retrieval import get_index


class State(TypedDict, total=False):
    doc_id: str
    question: str
    docs: List[Document]
    scores: List[float]
    good_docs: List[Document]
    verdict: str
    reason: str
    web_query: str
    web_docs: List[Document]
    strips: List[dict]          # {"text", "source": "book"|"web", "ref": page or url}
    kept_strips: List[dict]
    refined_context: str
    answer: str


RETRYABLE = (openai.RateLimitError, openai.APITimeoutError, openai.APIConnectionError, openai.InternalServerError)
BATCH_CFG = {"max_concurrency": config.MAX_CONCURRENCY}


@lru_cache(maxsize=1)
def llm() -> ChatOpenAI:
    return ChatOpenAI(model=config.LLM_MODEL, api_key=config.LLM_API_KEY, base_url=config.LLM_BASE_URL,
                      temperature=0, timeout=60, max_retries=2)


def retrying(chain):
    return chain.with_retry(retry_if_exception_type=RETRYABLE, wait_exponential_jitter=True,
                            exponential_jitter_params={"initial": 2, "max": 30}, stop_after_attempt=4)


def structured(schema):
    return llm().with_structured_output(schema, method="function_calling")


class DocEvalScore(BaseModel):
    score: float
    reason: str


class WebQuery(BaseModel):
    query: str


class KeptSentences(BaseModel):
    keep_ids: List[int]


GRADE_PROMPT = ChatPromptTemplate.from_messages([
    ("system", "You are a strict retrieval evaluator for RAG.\n"
               "You will be given ONE retrieved chunk and a question.\n"
               "Return a relevance score in [0.0, 1.0].\n"
               "- 1.0: chunk alone is sufficient to answer fully/mostly\n"
               "- 0.5: chunk is on topic and answers part of the question\n"
               "- 0.0: chunk is irrelevant\n"
               "Also return a short reason. Output JSON only."),
    ("human", "Question: {question}\n\nChunk:\n{chunk}"),
])

REWRITE_PROMPT = ChatPromptTemplate.from_messages([
    ("system", "Rewrite the user question into a web search query composed of keywords.\n"
               "Rules: 6-14 words; add a recency constraint only if the question implies it; "
               "do NOT answer the question. Return JSON with a single key: query"),
    ("human", "Question: {question}"),
])

FILTER_PROMPT = ChatPromptTemplate.from_messages([
    ("system", "You are a relevance filter. You get a question and a numbered list of sentences.\n"
               "Return the ids of sentences that help answer the question, including ones that help partially.\n"
               "Judge each sentence on its own. Return an empty list if none help. Output JSON only."),
    ("human", "Question: {question}\n\nSentences:\n{sentences}"),
])

ANSWER_PROMPT = ChatPromptTemplate.from_messages([
    ("system", "You are a helpful tutor. Answer ONLY using the provided context.\n"
               "Each context line starts with its source tag, like [p.12] or [web 2]. "
               "Cite the tags you used at the end of each sentence.\n"
               "If the context is empty or insufficient, say: 'I don't know.'"),
    ("human", "Question: {question}\n\nContext:\n{context}"),
])


@lru_cache(maxsize=1)
def chains():
    return {
        "grade": retrying(GRADE_PROMPT | structured(DocEvalScore)),
        "rewrite": retrying(REWRITE_PROMPT | structured(WebQuery)),
        "filter": retrying(FILTER_PROMPT | structured(KeptSentences)),
        "answer": retrying(ANSWER_PROMPT | llm()),
    }


def retrieve_node(state: State) -> State:
    return {"docs": get_index(state["doc_id"]).search(state["question"])}


def eval_each_doc_node(state: State) -> State:
    outs = chains()["grade"].batch(
        [{"question": state["question"], "chunk": d.page_content} for d in state["docs"]], config=BATCH_CFG)
    scores = [max(0.0, min(1.0, float(o.score))) for o in outs]
    good = [d for d, s in zip(state["docs"], scores) if s > config.LOWER_TH]

    if any(s > config.UPPER_TH for s in scores):
        return {"scores": scores, "good_docs": good, "verdict": "CORRECT",
                "reason": f"At least one chunk scored > {config.UPPER_TH}."}
    if scores and all(s < config.LOWER_TH for s in scores):
        return {"scores": scores, "good_docs": [], "verdict": "INCORRECT",
                "reason": f"All chunks scored < {config.LOWER_TH}."}
    return {"scores": scores, "good_docs": good, "verdict": "AMBIGUOUS",
            "reason": f"No chunk > {config.UPPER_TH}, but not all < {config.LOWER_TH}."}


def rewrite_query_node(state: State) -> State:
    return {"web_query": chains()["rewrite"].invoke({"question": state["question"]}).query}


def web_search_node(state: State) -> State:
    if not config.TAVILY_API_KEY:
        return {"web_docs": []}
    from tavily import TavilyClient
    try:
        res = TavilyClient(api_key=config.TAVILY_API_KEY).search(
            state.get("web_query") or state["question"], max_results=config.WEB_RESULTS)
    except Exception as e:  # noqa: BLE001  (answer from the PDF alone rather than fail the request)
        print(f"Web search failed: {e}")
        return {"web_docs": []}
    docs = [Document(page_content=r.get("content", ""),
                     metadata={"source": "web", "url": r.get("url", ""), "title": r.get("title", "")})
            for r in res.get("results", []) if r.get("content")]
    return {"web_docs": docs}


def split_sentences(text: str) -> List[str]:
    text = re.sub(r"\s+", " ", text).strip()
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if len(s.strip()) > 20]


def decompose(docs: List[Document]) -> List[dict]:
    strips = []
    for d in docs:
        src = d.metadata.get("source", "book")
        ref = d.metadata.get("page") if src == "book" else d.metadata.get("url")
        strips += [{"text": s, "source": src, "ref": ref} for s in split_sentences(d.page_content)]
    return strips


def filter_strips(question: str, strips: List[dict]) -> List[dict]:
    if not strips:
        return []
    groups = [strips[i:i + config.FILTER_GROUP] for i in range(0, len(strips), config.FILTER_GROUP)]
    inputs = [{"question": question,
               "sentences": "\n".join(f"[{i}] {s['text']}" for i, s in enumerate(g))} for g in groups]
    outs = chains()["filter"].batch(inputs, config=BATCH_CFG)
    kept = []
    for g, o in zip(groups, outs):
        ids = set(o.keep_ids)
        kept += [s for i, s in enumerate(g) if i in ids]
    return kept


def format_context(kept: List[dict]) -> str:
    urls = list(dict.fromkeys(s["ref"] for s in kept if s["source"] == "web"))
    lines = []
    for s in kept:
        tag = f"[p.{s['ref']}]" if s["source"] == "book" else f"[web {urls.index(s['ref']) + 1}]"
        lines.append(f"{tag} {s['text']}")
    return "\n".join(lines)


def refine_node(state: State) -> State:
    verdict = state.get("verdict")
    if verdict == "CORRECT":
        docs = state.get("good_docs", [])
    elif verdict == "INCORRECT":
        docs = state.get("web_docs", [])
    else:
        docs = state.get("good_docs", []) + state.get("web_docs", [])
    strips = decompose(docs)
    kept = filter_strips(state["question"], strips)
    return {"strips": strips, "kept_strips": kept, "refined_context": format_context(kept)}


def generate_node(state: State) -> State:
    out = chains()["answer"].invoke({"question": state["question"], "context": state.get("refined_context", "")})
    return {"answer": out.content}


def route_after_eval(state: State) -> str:
    return "refine" if state["verdict"] == "CORRECT" else "rewrite_query"


def build_graph():
    g = StateGraph(State)
    g.add_node("retrieve", retrieve_node)
    g.add_node("eval_each_doc", eval_each_doc_node)
    g.add_node("rewrite_query", rewrite_query_node)
    g.add_node("web_search", web_search_node)
    g.add_node("refine", refine_node)
    g.add_node("generate", generate_node)
    g.add_edge(START, "retrieve")
    g.add_edge("retrieve", "eval_each_doc")
    g.add_conditional_edges("eval_each_doc", route_after_eval,
                            {"refine": "refine", "rewrite_query": "rewrite_query"})
    g.add_edge("rewrite_query", "web_search")
    g.add_edge("web_search", "refine")
    g.add_edge("refine", "generate")
    g.add_edge("generate", END)
    return g.compile()


crag_app = build_graph()
