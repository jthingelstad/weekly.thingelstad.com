.PHONY: build serve stats test clean

# weekly is a render surface. Content (issue archives, _data indexes, the topic
# graph) is produced by Studio (studio-thing) and pushed in via the handoff.
# These targets just build, preview, refresh weekly's own stats, and clean.
# Production tooling (archive build, corpus, audio, Lambda, agents) lives in Studio.

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

# Playwright end-to-end tests against the built site + on-site Thingy UI.
test:
	npx playwright test

# Remove build output + local test artifacts (and any leftover Python cruft
# from the pre-cutover monorepo that still lingers on disk).
clean:
	rm -rf _site cache tmp test-results playwright-report
	find . -type d -name __pycache__ -prune -exec rm -rf {} +
	find . -type f \( -name '*.pyc' -o -name '*.pyo' \) -delete
