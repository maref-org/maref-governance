<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://maref.cc/brand/maref-governance-dark.svg">
  <img alt="MAREF Governance" src="https://maref.cc/brand/maref-governance-light.svg">
</picture>

# MAREF Governance Plugin

**AI agent safety enforcement with fail-closed guardrails — intercepts file writes and command execution at the plugin level.**

[![npm](https://img.shields.io/npm/v/maref-governance)](https://www.npmjs.com/package/maref-governance)
[![ClawHub](https://img.shields.io/badge/ClawHub-maref--governance-7B2FBE)](https://clawhub.com/packages/maref-governance)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![CI](https://github.com/maref-org/maref-governance/actions/workflows/ci.yml/badge.svg)](https://github.com/maref-org/maref-governance/actions/workflows/ci.yml)

A plugin for [OpenClaw](https://openclaw.ai) that checks file writes and command execution against an external [MAREF](https://maref.cc) sidecar. When the sidecar is unreachable, rejects credentials, or lacks the expected endpoint, the plugin **fails closed** — blocking the operation rather than allowing it silently.

> Read tools are **not** intercepted. The sidecar exposes no read-protection endpoint, so the plugin does not pretend to protect reads.

---

## How It Works

```
                    ┌──────────────────────┐
  Agent Tool Call   │  OpenClaw Runtime    │
  (write, exec...)  │  maref-governance    │
     ─────────────►  │  plugin              │
                    └──────┬───────────────┘
                           │ check policy
                           ▼
                    ┌──────────────────────┐
                    │  MAREF Sidecar        │
                    │  (external process)   │
                    ├──────────────────────┤
                    │  check-before-write     │
                    │  check-before-execute   │
                    └──────┬───────────────┘
                           │ allow / block / hitl_required
                           ▼
                    ┌──────────────────────┐
                    │  Decision             │
                    │  ─ allow → pass thru  │
                    │  ─ block → reject     │
                    │  ─ hitl → human loop  │
                    └──────────────────────┘
```

Each tool call is intercepted **before execution**. The plugin:

1. Extracts the file path or command from the tool parameters
2. Sends a policy check request to the MAREF sidecar
3. Returns `block: true` + reason if the sidecar says block, or `{}` (pass through) if allow
4. Reports the decision asynchronously to the sidecar for audit logging

---

## Features

| Feature | Description |
|---------|-------------|
| **Three modes** | `enforcing` (block on violation), `advisory` (warn only), `logging` (zero interception) |
| **Fail-closed** | Sidecar unreachable → block operations (enforcing mode only) |
| **Fail-open** | Sidecar unreachable → warn but allow (advisory/logging modes, or enforcing with `failClosed: false`) |
| **Decision cache** | Allow decisions cached for 30s, block decisions for 60s (configurable) |
| **HITL bypass** | `hitl_required` verdicts skip cache — every call re-queries the sidecar |
| **Write/exec only** | Write tools call `check-before-write`; exec tools call `check-before-execute`. Read tools pass through and are not protected |
| **Session tracking** | Reports session start/end, LLM input/output metadata to sidecar for audit |
| **Security audit collector** | Exposes governance state, circuit breaker status, and cache stats for monitoring |

---

## Installation

### Via ClawHub (recommended)

```bash
openclaw plugins install clawhub:maref-governance@latest
```

### Via npm

```bash
npm install -g maref-governance
openclaw plugins install maref-governance
```

### Manual (OpenClaw config)

Add to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "allow": ["maref-governance"],
    "entries": {
      "maref-governance": {
        "enabled": true,
        "config": {
          "mode": "enforcing",
          "sidecarUrl": "http://127.0.0.1:8931",
          "failClosed": true
        }
      }
    }
  }
}
```

Set `MAREF_API_KEY` in the environment so the plugin can authenticate. The sidecar rejects unauthenticated requests with 401.

---

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mode` | `"enforcing"` / `"advisory"` / `"logging"` | `"enforcing"` | Governance enforcement mode |
| `sidecarUrl` | `string` | `"http://localhost:8000"` | MAREF sidecar URL |
| `apiKey` | `string` | `MAREF_API_KEY` env | Bearer token for the sidecar. Prefer the env var over inline config |
| `failClosed` | `boolean` | `true` | Block when the sidecar errors (enforcing mode only) |
| `cacheTtlMs` | `number` | `30000` | TTL for cached allow decisions (0 to disable) |
| `cacheBlockTtlMs` | `number` | `60000` | TTL for cached block decisions (0 to disable) |
| `timeoutMs` | `number` | `3000` | Per-request timeout in ms |

### Sidecar contract

The plugin calls these endpoints directly (no `@maref-org/sdk` dependency):

- `POST /api/v1/guardrails/check-before-write`
- `POST /api/v1/guardrails/check-before-execute`
- `POST /api/v1/guardrails/actions` (best-effort audit)
- `GET /api/status` (security audit collector)

Errors are classified as `auth` (401/403), `endpoint_missing` (404), `unreachable`, `server` (5xx), or `invalid_response`. In `enforcing` mode with `failClosed: true`, every class blocks; the reason includes the class and a rule id (`MAREF-AUTH-FAILED`, `MAREF-ENDPOINT-MISSING`, `MAREF-SIDECAR-UNREACHABLE`, `MAREF-SIDECAR-ERROR`).

### Modes

| Mode | Block on violation | Warn on violation | Report to sidecar | Fail-closed |
|------|:---:|:---:|:---:|:---:|
| `enforcing` | ✅ | — | ✅ | ✅ (default) |
| `advisory` | — | ✅ | ✅ | — |
| `logging` | — | — | — | — |

---

## Development

```bash
# Clone
git clone https://github.com/maref-org/maref-governance.git
cd maref-governance

# Install dependencies
npm install

# Run tests (37 tests, vitest)
npm test

# Build (esbuild → dist/index.js)
npm run build
```

### Project Structure

```
maref-governance/
├── src/
│   ├── index.ts              # Plugin entry point
│   ├── index.test.ts         # Test suite (35 tests)
│   ├── minimal.test.ts       # Smoke test (2 tests)
│   └── __mocks__/
│       ├── plugin-entry.ts   # Mock for openclaw/plugin-sdk
│       └── types.ts          # Mock for plugin types
├── scripts/
│   └── build.js              # esbuild bundler script
├── dist/                     # Built output (gitignored)
├── .github/workflows/
│   ├── ci.yml                # Test + build on push/PR
│   └── clawhub-publish.yml   # Publish to ClawHub on tag
├── openclaw.plugin.json      # Plugin manifest
├── vitest.config.ts          # Test configuration
└── package.json
```

### CI/CD

| Workflow | Trigger | What it does |
|----------|---------|-------------|
| **CI** | Push to `main`, PR to `main` | `npm ci` → `npm test` → `npm run build` |
| **Publish to ClawHub** | Tag `v*` pushed | `npm test` → `npm run build` → `clawhub package publish` |

---

## Relationship to Agent Constitution Framework

This plugin is the **enforcement layer** for rules defined in the [Agent Constitution Framework](https://github.com/maref-org/agent-constitution-framework):

```
 Agent Constitution Framework          ← Policy: "what should we prevent?"
   └── maref-governance plugin         ← Enforcement: "how do we prevent it?"
         └── MAREF sidecar             ← Runtime: "is this operation allowed?"
```

- **Constitutional Governance** (Pattern 1) → defines the rule hierarchy
- **Progressive Disclosure** (Pattern 2) → defines what content is safe to release
- **Component Boundaries** (Pattern 6) → defines import and protocol rules

The plugin enforces these policies at the tool-call level, blocking violations before they reach the file system or shell.

---

## License

Apache-2.0 — see [LICENSE](LICENSE).

---

*Part of the [MAREF](https://maref.cc) ecosystem. Fail closed, ship safe.*
