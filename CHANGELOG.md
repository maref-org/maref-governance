# Changelog

## 0.1.0 (2026-07-18)

- Initial release
- Intercept file writes and command execution via MAREF sidecar
- Three governance modes: enforcing, advisory, logging
- Decision caching with configurable TTL
- Fail-closed / fail-open on sidecar unreachable
- Session lifecycle hooks (session_start, session_end)
- LLM input/output reporting hooks
- Security audit collector with cache stats
