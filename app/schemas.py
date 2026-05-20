from pydantic import BaseModel
from typing import List, Optional


class AskRequest(BaseModel):
    question: str


class DocInfo(BaseModel):
    content: str
    source: Optional[str] = None


class AskResponse(BaseModel):
    question: str
    answer: str
    verdict: str
    reason: str
    good_docs_count: int
    web_docs_count: int
    refined_context: str
