from langchain_openai import ChatOpenAI
from app.config import settings

_llm = None


def get_llm():
    global _llm
    if _llm is None:
        _llm = ChatOpenAI(
            api_key=settings.kimi_api_key,
            base_url=settings.llm_base_url,
            model=settings.llm_model,
        )
    return _llm
