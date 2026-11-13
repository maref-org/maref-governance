# Changelog

## 0.2.3 (2026-11-13)

- 修复 `openclaw.install.minHostVersion` 格式：必须是 semver floor `>=2026.7.2`
  （0.2.2 写 `2026.7.2`，被 OpenClaw 2026.11.3 拒绝安装）

## 0.2.2 (2026-11-13)

- 修复发布制品缺失 `dist/index.js`（0.2.1 的 ClawHub/npm 包无法加载入口）
- 新增 `files` 白名单，确保 dist/、README、LICENSE、manifest 进入发布包
- `before_tool_call` 改用 typed hook API `api.on(...)`（`registerHook` 为 internal hook，缺 name 会抛错）
- 新增 `openclaw.install.minHostVersion`：`2026.7.2`

## 0.2.1 (2026-07-19)

- 兼容性标注: 适配 MAREF v0.37.0-dev（G2 门禁恢复 + 覆盖提升 + CI 修复）

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
