# Answer From Web Implementation Plan

**Goal:** Add a server-side workflow that turns web search results into a cited ranked answer by fetching and scraping source pages.

**Plan:**
- Add failing tests for provider limit propagation and `answerFromWeb` aggregation.
- Add an answer module that searches, fetches top source pages, extracts ranked/list candidates, aggregates candidates, and returns citations.
- Wire `answer_from_web` through `run_workflow` and capability discovery without adding a new public MCP tool.
- Run focused tests, full tests, build, and a live/manual query check where provider credentials allow it.
