from langchain_openai import ChatOpenAI
from app.config import settings

_llm = None


def get_llm():
    global _llm
    if _llm is None:
        if not settings.openrouter_api_key:
            raise RuntimeError("OPENROUTER_API_KEY is not set")
        _llm = ChatOpenAI(
            api_key=settings.openrouter_api_key,
            base_url=settings.llm_base_url,
            model=settings.llm_model,
            temperature=settings.llm_temperature,
            default_headers={"X-Title": "CRAG - Corrective RAG"},
        )
    return _llm
