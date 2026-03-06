.PHONY: web web-dev test test-rag

# Run the web app locally for development (with watch). No Docker.
web: web-dev

web-dev:
	cd web && bun run dev

# Run unit tests
test:
	bun test cli/test

# Run RAG E2E integration test (requires OPENAI_API_KEY, makes real API calls)
test-rag:
	./scripts/test-rag.sh
