# Changelog

## 0.2.0 (2026-07-18)

- First standalone release extracted from `frankiehot-tech/openclaw` monorepo
- Owned and published by @maref-org on ClawHub
- Full test suite (37 tests) passes in standalone environment
- CI/CD workflows for automated testing and ClawHub publishing
- Decision cache with configurable TTLs
- Security audit collector with cache stats
- Session lifecycle and LLM input/output hooks

## 0.1.0 (2026-07-18)

- Initial release
- Intercept file writes and command execution via MAREF sidecar
- Three governance modes: enforcing, advisory, logging
- Decision caching with configurable TTL
- Fail-closed / fail-open on sidecar unreachable
- Session lifecycle hooks (session_start, session_end)
- LLM input/output reporting hooks
- Security audit collector with cache stats
