# Justfile for @viaalink/caddy-api-client

set dotenv-load

# Default recipe - show available commands
default:
    @just --list

# Install dependencies
install:
    bun install

# Build the package
build:
    bun run build

# Start, run, stop entire test suite
test-all: test-infra-up test test-integration test-infra-down

# Run tests
test:
    bun run test

# Run tests in watch mode
test-watch:
    bun run test:watch

# Run tests with coverage
test-coverage:
    bun run test:coverage

# Run integration tests (requires Caddy running)
test-integration:
    #!/usr/bin/env bash
    set -e
    echo "🔍 Checking if Caddy is running..."
    if ! curl -s http://127.0.0.1:2019 > /dev/null 2>&1; then
        echo "⚠️  Caddy not running. Starting with docker compose..."
        docker compose -f docker-compose.test.yml up -d
        echo "⏳ Waiting for Caddy to start..."
        sleep 2
    fi
    echo ""
    echo "🧪 Running integration tests..."
    bun run test:integration
    echo ""
    echo "✅ Integration tests completed!"

# Update integration test snapshots (Caddy config fixtures)
test-integration-update-snapshots:
    #!/usr/bin/env bash
    set -e
    echo "🔍 Checking if Caddy is running..."
    if ! curl -s http://127.0.0.1:2019 > /dev/null 2>&1; then
        echo "⚠️  Caddy not running. Starting with docker compose..."
        docker compose -f docker-compose.test.yml up -d
        echo "⏳ Waiting for Caddy to start..."
        sleep 2
    fi
    echo ""
    echo "📸 Running integration tests with UPDATE_SNAPSHOTS=true..."
    UPDATE_SNAPSHOTS=true bun run test:integration
    echo ""
    echo "✅ Snapshots updated in src/__tests__/integration/__fixtures__/"
    echo "   Review the changes and commit if correct."

# Start test infrastructure (Caddy + backends)
test-infra-up:
    docker compose -f docker-compose.test.yml up -d
    @echo "✅ Test infrastructure started"
    @echo "   Caddy Admin API: http://127.0.0.1:2019"
    @echo "   Echo server: http://127.0.0.1:5678"

# Stop test infrastructure
test-infra-down:
    docker compose -f docker-compose.test.yml down
    @echo "✅ Test infrastructure stopped"

# Type check
typecheck:
    bun run typecheck

# Lint code
lint:
    bun run lint

# Format code
format:
    bun run format

# Format only the given paths (prettier, honouring .prettierignore)
[positional-arguments]
format-paths +paths:
    bunx prettier --write --log-level warn "$@"

# Check formatting without fixing
format-check:
    bun run format:check

# Run all quality checks (format-check, lint, typecheck, test)
check:
    #!/usr/bin/env bash
    set -e
    echo "🔍 Running format check..."
    bun run format:check
    echo ""
    echo "🔍 Running linter..."
    bun run lint
    echo ""
    echo "🔍 Running type check..."
    bun run typecheck
    echo ""
    echo "🧪 Running tests..."
    bun run test
    echo ""
    echo "✅ All checks passed!"

# Link package locally for testing
link:
    #!/usr/bin/env bash
    set -e
    echo "📦 Building package..."
    bun run build
    echo ""
    echo "🔗 Linking package globally..."
    bun link
    echo ""
    echo "✅ Package linked! Use 'bun link @viaalink/caddy-api-client' in other projects."
    echo ""
    echo "To test in .asd project:"
    echo "  cd .asd"
    echo "  bun link @viaalink/caddy-api-client"

# Unlink package
unlink:
    bun unlink

# Preview next release (dry-run)
release-dry:
    #!/usr/bin/env bash
    set -e
    echo "🔍 Preview of next release (dry-run)..."
    echo ""
    bun run release:dry
    echo ""
    echo "✅ Preview completed. No changes made."

# Create a new release (patch version)
release:
    #!/usr/bin/env bash
    set -e
    echo "📦 Creating new release (patch)..."
    echo ""
    echo "This will:"
    echo "  1. Run all checks (lint, typecheck, tests)"
    echo "  2. Bump version in package.json"
    echo "  3. Generate CHANGELOG.md"
    echo "  4. Create git commit and tag"
    echo ""
    read -p "Continue? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ Release cancelled"
        exit 1
    fi
    echo ""
    bun run release
    echo ""
    echo "✅ Release created!"
    echo ""
    echo "Next steps:"
    echo "  1. Review the changes: git show HEAD"
    echo "  2. Push to GitHub: git push --follow-tags origin main"
    echo "  3. GitHub Actions will auto-publish to npm"

# Create minor version release
release-minor:
    #!/usr/bin/env bash
    set -e
    echo "📦 Creating minor version release..."
    bun run release:minor

# Create major version release
release-major:
    #!/usr/bin/env bash
    set -e
    echo "📦 Creating major version release..."
    bun run release:major

# First release (initializes CHANGELOG without bumping from 0.1.0)
release-first:
    #!/usr/bin/env bash
    set -e
    echo "📦 Creating first release..."
    bun run release:first

# Verify package contents before publishing
verify-package:
    #!/usr/bin/env bash
    set -e
    echo "🔍 Verifying package contents..."
    echo ""
    bun run build
    echo ""
    echo "📦 Package contents (npm pack --dry-run):"
    bun run verify:pack
    echo ""
    echo "✅ Verification complete!"

# Publish to NPM (dry-run by default)
publish-dry:
    #!/usr/bin/env bash
    set -e
    echo "🔍 Running all checks..."
    just check
    echo ""
    echo "📦 Dry-run publish..."
    npm publish --dry-run
    echo ""
    echo "✅ Dry-run completed! Package is ready to publish."
    echo ""
    echo "To publish for real, run: just publish"

# Publish to NPM (requires npm login)
publish:
    #!/usr/bin/env bash
    set -e
    echo "⚠️  Publishing to NPM registry..."
    echo ""
    read -p "Are you sure you want to publish? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ Publish cancelled"
        exit 1
    fi
    echo ""
    echo "🔍 Running all checks..."
    just check
    echo ""
    echo "📦 Publishing to NPM..."
    npm publish
    echo ""
    echo "✅ Published successfully!"

# Clean build artifacts
clean:
    rm -rf dist coverage

# Clean everything including node_modules
clean-all:
    rm -rf dist coverage node_modules

# Clean and reinstall
clean-install: clean-all install

# Development mode (watch and rebuild)
dev:
    bun run dev

# Run example scripts
example script:
    bun run examples/{{script}}.ts

# Show package info
info:
    #!/usr/bin/env bash
    echo "Package: @viaalink/caddy-api-client"
    echo "Version: $(cat package.json | grep '"version"' | cut -d'"' -f4)"
    echo ""
    echo "Build outputs:"
    ls -lh dist/ 2>/dev/null | grep -E '\.(js|d\.ts)$' | awk '{print "  " $9, $5}' || echo "  No build files (run 'just build')"
    echo ""
    echo "Test status:"
    bun run test 2>&1 | tail -1 || echo "  Tests not run"

# Run all checks and build (CI mode)
ci: check build
    @echo "✅ CI checks completed successfully"

# Upstreams: compare upstreams.json pins with the newest Caddy/plugin/libdns versions (exit 10 = updates). E.g. `just upstreams-check --only caddy`
[positional-arguments]
upstreams-check *args:
    bun scripts/check-upstreams.ts "$@"

# Upstreams: put every local/ clone on its pin (clones what is missing, installs the versioned tygo.yaml)
upstreams-sync:
    bun scripts/update-upstreams.ts --sync-only

# Upstreams: bump behind pins, regenerate, run the gate, write local/upstreams/summary.md (PR body). E.g. `just upstreams-update --only caddy-security --skip-vscode`
[positional-arguments]
upstreams-update *args:
    bun scripts/update-upstreams.ts "$@"

# Utility: git diff to log file
glog:
    git diff HEAD > git.log

# Utility: run Claude Code
claude:
    claude --allow-dangerously-skip-permissions

# VSCode Extension: run Playwright tests against code-server (headless); extra args go to playwright, e.g. `just vscode-test -g Snippets`
[positional-arguments]
vscode-test *args:
    cd vscode-extension && npm test -- "$@"

# VSCode Extension: run the API-level integration tests in real desktop VS Code (headless via xvfb)
vscode-test-desktop:
    cd vscode-extension && xvfb-run -a npm run test:desktop

# VSCode Extension: run both test tiers (desktop VS Code, then code-server)
vscode-test-all: vscode-test-desktop vscode-test

# VSCode Extension: run Playwright tests with visible browser
vscode-test-headed:
    cd vscode-extension && npx playwright test --headed

# VSCode Extension: run Playwright tests in debug mode
vscode-test-debug:
    cd vscode-extension && npx playwright test --debug

# VSCode Extension: install its dependencies, as CI does (library build, then npm ci)
vscode-deps: build
    cd vscode-extension && npm ci

# VSCode Extension: type check (esbuild bundles without one), as CI does
vscode-typecheck:
    cd vscode-extension && npm run typecheck

# VSCode Extension: build and package
vscode-build:
    cd vscode-extension && npm run package

# VSCode Extension: install in local VSCode
vscode-install:
    cd vscode-extension && code --install-extension vscode-caddy-tools-*.vsix --force

# variant: promo (title/end cards, captions, voice) · qa (numbered captions, slower, no cards).
# Demo films. The storyboards are in vscode-extension/demo/ (film.config.ts); the film
# engine itself is Viaalink's own tooling and not part of this repository, so these
# recipes only run where it is installed (PRODUCT_VIDEO, default ../../packages/product-video).
# Curious how we make them? Mail info@viaalink.com. Output: vscode-extension/local/video/ (gitignored).
_film board variant:
    #!/usr/bin/env bash
    set -euo pipefail
    PV="${PRODUCT_VIDEO:-../../packages/product-video}"
    if [[ ! -x "$PV/bin/film.sh" ]]; then
      echo "The film engine is not on this machine (looked in $PV)." >&2
      echo "It is Viaalink's own tooling; ask info@viaalink.com if you want to know how the films are made." >&2
      exit 1
    fi
    bash "$PV/bin/film.sh" vscode-extension/demo/film.config.ts {{board}} {{variant}}

# VSCode Extension: record the demo film (voice → record → render → contact sheet)
vscode-demo-video variant="promo":
    just _film caddy-tools {{variant}}

# VSCode Extension: both demo films, one after the other
vscode-demo-video-all:
    just _film caddy-tools promo
    CADDY_DEMO_REUSE_VSIX=1 just _film caddy-tools qa

# VSCode Extension: typecheck the storyboards (needs the film engine for its types)
vscode-demo-typecheck:
    cd vscode-extension && npx tsc -p demo/tsconfig.json

# MITMproxy demo film (needs `just demo start`): voice → record → render → contact sheet
demo-video variant="promo":
    just _film caddy-mitm {{variant}}

# MITMproxy demo (via.yaml + tpl.env, own ports per checkout): just demo start|share|stop|url
demo action:
    #!/usr/bin/env bash
    set -euo pipefail
    # via checks .env before its before-hooks run, so a fresh clone resolves tpl.env first
    grep -q '^DEMO_HTTP_PORT=' .env 2>/dev/null || via env init
    case "{{action}}" in
        start) via run up ;;
        share) via run share ;;
        stop)  via run stop ;;
        url)   echo "https://$(grep '^COMPOSE_PROJECT_NAME=' .env | cut -d= -f2).localhost/dashboard" ;;
        *)     echo "Usage: just demo [start|share|stop|url]"; exit 1 ;;
    esac
