.PHONY: build serve stats test clean

# weekly is a render surface. Issue pages and the emails.json index are
# committed in by WT Builder (wt-builder); the topic graph is pushed in by
# librarian-thing. These targets just build, preview, refresh weekly's own
# stats, and clean. Publishing lives in WT Builder; the archive, corpus, and
# Lambda live in librarian-thing.

# Full production build → _site/  (Eleventy + Pagefind)
build:
	npm run build
	npm run build:search

# Local dev server (Eleventy --serve)
serve:
	npm run serve

# Refresh weekly's own landing-page stats (subscriber + supporter numbers).
# Needs BUTTONDOWN_API_KEY + STRIPE_API_KEY in the environment.
stats:
	npm run refresh-stats

# Playwright end-to-end tests against the built site (served statically from
# _site/, Pagefind index included) + Thingy redirects.
test: build
	npx playwright test

# Remove build output + local test artifacts (and any leftover Python cruft
# from the pre-cutover monorepo that still lingers on disk).
clean:
	rm -rf _site cache tmp test-results playwright-report
	find . -type d -name __pycache__ -prune -exec rm -rf {} +
	find . -type f \( -name '*.pyc' -o -name '*.pyo' \) -delete
