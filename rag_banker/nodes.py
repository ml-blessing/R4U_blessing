import os
from typing import Dict, Any

from dotenv import load_dotenv

from langchain_google_genai import ChatGoogleGenerativeAI 
from langchain_core.prompts import PromptTemplate

from langchain_chroma import Chroma
from langchain_community.embeddings import HuggingFaceEmbeddings

from rag_banker.state import RagState


# ============================================================
# ENVIRONMENT
# ============================================================

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

if not GEMINI_API_KEY or GEMINI_API_KEY == "your_gemini_api_key_here":
    llm = None
else:
    llm = ChatGoogleGenerativeAI(
        model="gemini-3.6-flash",
        google_api_key=GEMINI_API_KEY,
        temperature=0
    )

# ============================================================
# CHROMA CONFIGURATION
# ============================================================

CHROMA_PATH = os.path.abspath("./rag_storage/chroma_db")

retriever = None


# ============================================================
# RETRIEVER
# ============================================================

def get_retriever():
    """
    Lazily initialize ChromaDB retriever.
    """

    global retriever

    if retriever is not None:
        return retriever

    if not os.path.exists(CHROMA_PATH):
        print(
            "Chroma DB path does not exist. "
            "Please run rag_banker/ingest.py first."
        )
        return None

    try:

        embeddings = HuggingFaceEmbeddings(
            model_name="all-MiniLM-L6-v2"
        )

        db = Chroma(
            persist_directory=CHROMA_PATH,
            embedding_function=embeddings
        )

        retriever = db.as_retriever(
            search_kwargs={"k": 100}
        )

        return retriever

    except Exception as e:

        print(f"Failed to initialize ChromaDB: {e}")

        return None


# ============================================================
# RETRIEVAL NODE
# ============================================================

def retrieve(state: RagState) -> Dict[str, Any]:

    print("---RETRIEVE---")

    query = state["query"]

    # -----------------------------------------
    # Validate LLM configuration
    # -----------------------------------------

    if llm is None:
        return {
            "error": "GEMINI_API_KEY is not configured.",
            "documents": []
        }

    # -----------------------------------------
    # Get retriever
    # -----------------------------------------

    r = get_retriever()

    if r is None:
        return {
            "documents": [],
            "error": (
                "No vector database found. "
                "Please run the data ingestion script first."
            )
        }

    # -----------------------------------------
    # Retrieve documents
    # -----------------------------------------

    try:

        results = r.invoke(query)

        if not results:
            return {
                "documents": [],
                "error": "No relevant documents found."
            }

        retrieved_docs = []

        for doc in results:

            retrieved_docs.append({
                "content": doc.page_content,
                "metadata": doc.metadata
            })

        return {
            "documents": retrieved_docs
        }

    except Exception as e:

        print(f"Error querying ChromaDB: {e}")

        return {
            "documents": [],
            "error": f"Failed to query vector database: {e}"
        }


# ============================================================
# GENERATION NODE
# ============================================================

def generate(state: RagState) -> Dict[str, Any]:

    print("---GENERATE---")

    query = state["query"]

    documents = state.get("documents", [])

    error = state.get("error")

    # -----------------------------------------
    # Handle previous errors
    # -----------------------------------------

    if error:
        return {
            "generation": error
        }

    if not documents:
        return {
            "generation": (
                "Information not available in the provided documents."
            )
        }

    # -----------------------------------------
    # Build context
    # -----------------------------------------

    context_parts = []

    for i, doc in enumerate(documents, start=1):

        content = doc.get("content", "")
        metadata = doc.get("metadata", {})

        source = metadata.get(
            "source",
            "Unknown source"
        )

        context_parts.append(
            f"""
DOCUMENT {i}
Source: {source}

Content:
{content}
"""
        )

    context = "\n".join(context_parts)

    # -----------------------------------------
    # RAG Prompt
    # -----------------------------------------

    prompt = PromptTemplate(
        template="""
You are an expert AI Banker Assistant.

Your job is to answer the banker's query using ONLY
the information available in the provided documents.

STRICT RULES:

1. Do not invent customer information.
2. Do not assume missing values.
3. Do not use outside knowledge for customer-specific facts.
4. If the requested information is not present, clearly say:
   "Information not available in the provided documents."
5. OUTPUT ONLY THE EXACT INFORMATION REQUESTED. If the user asks for a list of names, ONLY provide the list of names. Do NOT provide extraneous details, financial metrics, or summaries unless explicitly requested.
6. Clearly distinguish between stated facts and missing information.
7. Keep the response professional, highly concise, and formatted clearly (use bullet points for lists).

Retrieved Documents:
{context}

Banker Query:
{query}

Answer:
""",
        input_variables=[
            "context",
            "query"
        ]
    )

    chain = prompt | llm

    # -----------------------------------------
    # Generate response
    # -----------------------------------------

    try:

        response = chain.invoke({
            "context": context,
            "query": query
        })

        content = response.content
        # Handle cases where Gemini returns a list of blocks instead of a string
        if isinstance(content, list):
            content = "".join(
                block.get("text", "") if isinstance(block, dict) else str(block) 
                for block in content
            )
        else:
            content = str(content)

        return {
            "generation": content
        }

    except Exception as e:

        return {
            "error": str(e),
            "generation": f"Failed to generate response: {e}"
        }