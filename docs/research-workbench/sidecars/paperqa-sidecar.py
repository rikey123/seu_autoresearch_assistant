#!/usr/bin/env python3
"""paper-qa sidecar adapter for the Research Workbench RAG module.

Deployment material (not shipped server code): point the server's
RAG_SIDECAR_BIN at this file and RAG_SIDECAR_PYTHON at a Python 3.10-3.12
interpreter with `pip install paper-qa` installed.

Pinned protocol (single JSON object on stdin -> single JSON object on stdout;
all progress goes to stderr):

  request  {"action": "index", "papers": [{"id", "title", "path"}, ...]}
  request  {"action": "ask", "papers": [...], "question": "..."}

  response {"status": "ok", "action": "index", "chunks": <int>, "engine": "paper-qa"}
  response {"status": "ok", "action": "ask", "answer": "<text>",
            "citations": [{"paperId", "page", "snippet"}, ...], "engine": "paper-qa"}
  response {"status": "error", "error": "<message>"}

API-first: paper-qa is configured for OpenAI-compatible HTTP endpoints through
environment variables only (OPENAI_API_KEY, OPENAI_BASE_URL, OPENAI_MODEL,
RAG_EMBEDDING_MODEL). No local model is downloaded or executed; indexing uses
defer_embedding so building the index never calls the embedding API.
"""

from __future__ import annotations

import asyncio
import json
import sys
import traceback


def read_request() -> dict:
    raw = sys.stdin.read()
    request = json.loads(raw)
    if not isinstance(request, dict) or request.get("action") not in ("index", "ask"):
        raise ValueError("request must be a JSON object with action 'index' or 'ask'")
    papers = request.get("papers")
    if not isinstance(papers, list) or not papers:
        raise ValueError("papers must be a non-empty JSON array")
    return request


async def build_docs(request: dict):
    from paperqa import Docs, Settings

    # litellm prints a provider-list banner to stdout on unknown-model
    # fallbacks; the pinned protocol needs stdout to stay a single JSON object.
    import litellm

    litellm.suppress_debug_info = True
    settings = Settings()
    # API-first: model names come from the environment; litellm routes every
    # call to the OpenAI-compatible endpoint given via OPENAI_BASE_URL.
    import os

    model = os.environ.get("OPENAI_MODEL", "").strip()
    if model:
        settings.llm = model
        settings.summary_llm = model
        settings.agent = settings.agent.model_copy(update={"prompt_llm": model})
    embedding = os.environ.get("RAG_EMBEDDING_MODEL", "").strip()
    if embedding:
        # litellm needs a provider prefix to route to the OpenAI-compatible
        # endpoint (OPENAI_BASE_URL); bare custom names get 'openai/'.
        if "/" not in embedding:
            embedding = f"openai/{embedding}"
        settings.embedding = embedding
    settings.parsing = settings.parsing.model_copy(
        update={
            "defer_embedding": True,  # index building must not call the embedding API
            "use_doc_details": False,  # no external metadata lookups during intake
        }
    )

    docs = Docs()
    for paper in request["papers"]:
        await docs.aadd(
            paper["path"],
            docname=paper["id"],
            title=paper.get("title") or paper["id"],
            citation="",  # explicit citation: no LLM call during intake
            settings=settings,
        )
    return docs, settings


async def do_index(request: dict) -> dict:
    docs, _settings = await build_docs(request)
    chunks = len(docs.texts)
    return {"status": "ok", "action": "index", "chunks": chunks, "engine": "paper-qa"}


async def do_ask(request: dict) -> dict:
    from paperqa import Docs

    docs, settings = await build_docs(request)
    response = await docs.aquery(request["question"], settings=settings)
    citations = []
    for context in response.contexts:
        text = context.text
        page = None
        if text.name and "-" in text.name:
            head = text.name.split("-", 1)[0]
            if head.isdigit():
                page = int(head)
        citations.append(
            {
                "paperId": text.doc.docname,
                "page": page,
                "snippet": (text.text or "")[:500],
            }
        )
    return {
        "status": "ok",
        "action": "ask",
        "answer": response.answer,
        "citations": citations,
        "engine": "paper-qa",
    }


def main() -> int:
    try:
        request = read_request()
        handler = do_index if request["action"] == "index" else do_ask
        result = asyncio.run(handler(request))
        sys.stdout.write(json.dumps(result, ensure_ascii=False))
        sys.stdout.write("\n")
        return 0
    except Exception as error:  # noqa: BLE001 - the protocol needs one JSON answer
        sys.stderr.write("paper-qa sidecar failed:\n")
        sys.stderr.write(traceback.format_exc())
        sys.stdout.write(json.dumps({"status": "error", "error": str(error)}))
        sys.stdout.write("\n")
        return 1


if __name__ == "__main__":
    sys.exit(main())
