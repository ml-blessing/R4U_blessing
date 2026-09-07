import os
from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI

print("1. Starting Gemini test...")

# Load .env from project root
load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")

print("2. API key loaded:", bool(api_key))

if not api_key:
    raise ValueError(
        "GEMINI_API_KEY is not being loaded from .env"
    )

print("3. Creating Gemini client...")

llm = ChatGoogleGenerativeAI(
    model="gemini-3.6-flash",
    google_api_key=api_key,
    temperature=0
)

print("4. Calling Gemini...")

try:
    response = llm.invoke(
        "Say hello in one sentence."
    )

    print("5. Response received!")
    print("6. CONTENT:")
    print(response.content)

except Exception as e:
    print("GEMINI ERROR:")
    print(type(e).__name__)
    print(str(e))