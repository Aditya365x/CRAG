import re
from typing import List


def decompose_to_sentences(text: str) -> List[str]:
    """Split text into individual sentences, filtering out fragments."""
    text = re.sub(r"\s+", " ", text).strip()
    sentences = re.split(r"(?<=[.!?])\s+", text)
    return [s.strip() for s in sentences if len(s.strip()) > 20]
