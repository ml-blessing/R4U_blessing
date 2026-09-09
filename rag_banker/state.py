from typing import TypedDict, List
from operator import add
from typing import Annotated

class RagState(TypedDict):
    query: str
    documents: List[str]
    generation: str
    error: str
