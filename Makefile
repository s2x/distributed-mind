.PHONY: help web web-dev test test-web test-rag install-local release-patch release-minor release-major release-simulate

help: ## Show available commands
	@echo "mind project tasks"
	@echo
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | sed 's/:.*## /\t/; s/^/  /'

web: ## Run the web app in dev mode (alias for web-dev)
	$(MAKE) web-dev

web-dev: ## Run the web app locally with Bun
	cd web && bun run dev

test: ## Run unit tests
	bun test test/ web/test

test-web: ## Run web-only tests
	bun test web/test

test-rag: ## Run RAG E2E integration test (requires OPENAI_API_KEY)
	./scripts/test-rag.sh

install-local: ## Install mind locally using scripts/install.sh (no curl)
	./scripts/install.sh

release-patch: ## Create a patch release from main (real release)
	./scripts/release.sh patch

release-minor: ## Create a minor release from main (real release)
	./scripts/release.sh minor

release-major: ## Create a major release from main (real release)
	./scripts/release.sh major

release-simulate: ## Simulate release flow without changing anything (TYPE=patch|minor|major)
	@type=$${TYPE:-patch}; ./scripts/release.sh $$type --simulate
