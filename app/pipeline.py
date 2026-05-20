from langgraph.graph import StateGraph, START, END

from app.nodes import (
    GraphState,
    retrieve_node,
    eval_each_doc_node,
    web_search_node,
    refine_node,
    generate_node,
    route_after_eval,
)

_app = None


def build_graph():
    """Build and compile the CRAG LangGraph pipeline (singleton)."""
    global _app
    if _app is not None:
        return _app

    g = StateGraph(GraphState)

    g.add_node("retrieve", retrieve_node)
    g.add_node("eval_each_doc", eval_each_doc_node)
    g.add_node("web_search", web_search_node)
    g.add_node("refine", refine_node)
    g.add_node("generate", generate_node)

    g.add_edge(START, "retrieve")
    g.add_edge("retrieve", "eval_each_doc")

    g.add_conditional_edges(
        "eval_each_doc",
        route_after_eval,
        {
            "refine": "refine",
            "web_search": "web_search",
        },
    )

    g.add_edge("web_search", "refine")
    g.add_edge("refine", "generate")
    g.add_edge("generate", END)

    _app = g.compile()
    return _app
