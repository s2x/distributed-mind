.PHONY: web web-dev

# Run the web app locally for development (with watch). No Docker.
web: web-dev

web-dev:
	cd web && bun run dev
