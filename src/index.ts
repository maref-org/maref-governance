/**
 * @openclaw/maref-governance — MAREF Governance Plugin for OpenClaw
 *
 * Intercepts file writes, command execution, and sensitive file reads
 * to enforce policies via an external MAREF sidecar.
 *
 * 安装:
 *   在 OpenClaw 配置中启用本 extension 并确保 MAREF sidecar 运行。
 *
 * 设计原则:
 *   - enforcing 模式: block verdict 阻止操作
 *   - advisory 模式: 只警告不拦截，用于灰度验证
 *   - logging 模式: 只记日志，零拦截
 *   - fail-closed: sidecar 不可达时 enforcing 模式默认阻断
 *   - 决策缓存: allow 默认缓存 30s, block 默认缓存 60s
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { MAREFClient, type GateDecision } from "@maref-org/sdk";
import type { PluginHookBeforeToolCallResult } from "openclaw/plugin-sdk/types";

// ── 类型定义 ─────────────────────────────────────────────────────────

type MAREFMode = "enforcing" | "advisory" | "logging";

interface MAREFConfig {
  sidecarUrl?: string;
  mode?: MAREFMode;
  failClosed?: boolean;
  cacheTtlMs?: number;
  cacheBlockTtlMs?: number;
}

/** 缓存条目 */
interface CachedDecision {
  decision: GateDecision;
  expiresAt: number;
}

/** 缓存统计 */
interface CacheStats {
  size: number;
  hits: number;
  misses: number;
}

// ── 工具 ─────────────────────────────────────────────────────────────

/** 从 tool call params 中提取文件路径 */
function extractFilePath(params: Record<string, unknown>): string | null {
  const pathKeys = ["file_path", "path", "filePath", "filename", "destination"];
  for (const key of pathKeys) {
    const val = params[key];
    if (typeof val === "string" && val.length > 0) return val;
  }
  return null;
}

/** 从 tool call params 中提取命令 */
function extractCommand(params: Record<string, unknown>): string | null {
  const cmdKeys = ["command", "cmd", "shell", "exec"];
  for (const key of cmdKeys) {
    const val = params[key];
    if (typeof val === "string" && val.length > 0) return val;
  }
  return null;
}

/** 构造缓存 key */
function cacheKey(operation: string, identifier: string): string {
  return `${operation}:${identifier}`;
}

// ── Plugin 入口 ──────────────────────────────────────────────────────

export default definePluginEntry({
  id: "maref-governance",
  name: "MAREF Governance",
  description:
    "AI agent safety enforcement with fail-closed guardrails via MAREF sidecar",

  register(api) {
    const config = (api.pluginConfig ?? {}) as MAREFConfig;
    const mode: MAREFMode = config.mode ?? "enforcing";
    const failClosed = config.failClosed ?? true;
    const sidecarUrl = config.sidecarUrl ?? "http://localhost:8000";
    const cacheTtlMs = Math.max(0, config.cacheTtlMs ?? 30_000);
    const cacheBlockTtlMs = Math.max(0, config.cacheBlockTtlMs ?? 60_000);

    const client = new MAREFClient(sidecarUrl);

    // ── 决策缓存 ──────────────────────────────────────────────────

    const decisionCache = new Map<string, CachedDecision>();
    const stats: CacheStats = { size: 0, hits: 0, misses: 0 };

    function cacheSet(key: string, decision: GateDecision): void {
      const ttl =
        decision.verdict === "block" ? cacheBlockTtlMs : cacheTtlMs;
      if (ttl <= 0) return; // 缓存禁用
      decisionCache.set(key, {
        decision,
        expiresAt: Date.now() + ttl,
      });
      stats.size = decisionCache.size;
    }

    function cacheGet(key: string): GateDecision | null {
      const entry = decisionCache.get(key);
      if (!entry) {
        stats.misses++;
        return null;
      }
      if (Date.now() > entry.expiresAt) {
        decisionCache.delete(key);
        stats.size = decisionCache.size;
        stats.misses++;
        return null;
      }
      stats.hits++;
      return entry.decision;
    }

    // ── 决策解析 ──────────────────────────────────────────────────

    function resolveDecision(
      decision: GateDecision,
      operation: string,
    ): PluginHookBeforeToolCallResult {
      if (!decision || !decision.verdict) {
        if (mode === "enforcing" && failClosed) {
          return {
            block: true,
            blockReason: `[MAREF] No valid decision for ${operation}`,
          };
        }
        return {};
      }
      switch (mode) {
        case "logging":
          return {};
        case "advisory": {
          if (decision.verdict === "block") {
            console.warn(
              `[MAREF] ADVISORY — would BLOCK ${operation}: ${decision.reason}`,
            );
          }
          return {};
        }
        case "enforcing":
        default: {
          if (decision.verdict === "block") {
            const reason = `[MAREF] BLOCKED ${operation} — rule ${decision.rule_id}: ${decision.reason}`;
            if (failClosed) {
              return { block: true, blockReason: reason };
            }
            console.warn(`[MAREF] FAIL-OPEN: ${reason}`);
            return {};
          }
          if (decision.verdict === "hitl_required") {
            return {
              block: true,
              blockReason: `[MAREF] HITL required for ${operation} — contact human operator`,
            };
          }
          return {};
        }
      }
    }

    /** 执行带缓存的治理检查 */
    async function checkedDecision(
      operation: string,
      identifier: string,
      checkFn: () => Promise<GateDecision>,
    ): Promise<GateDecision> {
      const key = cacheKey(operation, identifier);
      const cached = cacheGet(key);
      if (cached) return cached;

      const decision = await checkFn();

      // HITL 决策不缓存 —— 每次都需要重新请求
      if (decision?.verdict !== "hitl_required") {
        cacheSet(key, decision);
      }

      return decision;
    }

    // ── before_tool_call ──────────────────────────────────────────

    api.registerHook("before_tool_call", async (event: any, ctx: any) => {
      if (mode === "logging") return {};

      const filePath = extractFilePath(event.params);
      const command = extractCommand(event.params);

      if (!filePath && !command) return {};

      try {
        if (filePath) {
          const decision = await checkedDecision(
            "write",
            filePath,
            () =>
              client.checkBeforeWrite({
                file_path: filePath,
                actor: ctx.agentId ?? "openclaw-agent",
                session_id: ctx.sessionId,
              }),
          );
          client
            .reportAction({
              action: "openclaw:before_tool_call",
              result: {
                verdict: decision.verdict,
                rule_id: decision.rule_id,
                reason: decision.reason,
                risk_score: decision.risk_score,
                filePath,
                toolName: event.toolName,
              },
            })
            .catch(() => {});
          return resolveDecision(decision, `write ${filePath}`);
        }
        if (command) {
          const decision = await checkedDecision(
            "execute",
            command,
            () =>
              client.checkBeforeExecute({
                command,
                actor: ctx.agentId ?? "openclaw-agent",
                session_id: ctx.sessionId,
              }),
          );
          client
            .reportAction({
              action: "openclaw:before_tool_call",
              result: {
                verdict: decision.verdict,
                rule_id: decision.rule_id,
                reason: decision.reason,
                risk_score: decision.risk_score,
                command,
                toolName: event.toolName,
              },
            })
            .catch(() => {});
          return resolveDecision(decision, `execute ${command}`);
        }
      } catch (err) {
        if (failClosed && mode === "enforcing") {
          return {
            block: true,
            blockReason: `[MAREF] FAIL-CLOSED: Sidecar unreachable: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
        console.warn(`[MAREF] Sidecar error (fail-open): ${err}`);
        return {};
      }
      return {};
    });

    // ── session_start ─────────────────────────────────────────────
    //
    // 会话启动时向 MAREF 上报会话元数据，用于治理链路追踪。

    api.on("session_start", (event, ctx) => {
      if (mode === "logging") return;
      client.reportAction({
        action: "openclaw:session_start",
        actor: ctx.agentId ?? "openclaw-agent",
        session_id: event.sessionId,
        result: {
          sessionId: event.sessionId,
          sessionKey: event.sessionKey,
          resumedFrom: event.resumedFrom ?? null,
        },
      }).catch(() => {});
    });

    // ── session_end ───────────────────────────────────────────────
    //
    // 会话结束时上报消息数、时长、终止原因，便于 MAREF 计算
    // 会话级治理指标。

    api.on("session_end", (event, ctx) => {
      if (mode === "logging") return;
      client.reportAction({
        action: "openclaw:session_end",
        actor: ctx.agentId ?? "openclaw-agent",
        session_id: event.sessionId,
        result: {
          sessionId: event.sessionId,
          sessionKey: event.sessionKey,
          messageCount: event.messageCount,
          durationMs: event.durationMs,
          reason: event.reason,
          transcriptArchived: event.transcriptArchived,
          nextSessionId: event.nextSessionId,
        },
      }).catch(() => {});
    });

    // ── llm_input ─────────────────────────────────────────────────
    //
    // LLM 请求前上报输入内容元数据（不含完整 prompt，仅含长度和
    // 模型信息），用于审计和滥用检测。

    api.on("llm_input", (event, ctx) => {
      if (mode === "logging") return;
      client.reportAction({
        action: "openclaw:llm_input",
        actor: ctx.agentId ?? "openclaw-agent",
        session_id: event.sessionId,
        result: {
          runId: event.runId,
          sessionId: event.sessionId,
          provider: event.provider,
          model: event.model,
          systemPromptLength: event.systemPrompt?.length ?? 0,
          promptLength: event.prompt?.length ?? 0,
          historyMessagesCount: event.historyMessages?.length ?? 0,
          imagesCount: event.imagesCount,
          toolsCount: event.tools?.length ?? 0,
        },
      }).catch(() => {});
    });

    // ── llm_output ────────────────────────────────────────────────
    //
    // LLM 响应后上报输出元数据（assistant 文本数、token 用量），
    // 用于成本追踪、合规审计。

    api.on("llm_output", (event, ctx) => {
      if (mode === "logging") return;
      client.reportAction({
        action: "openclaw:llm_output",
        actor: ctx.agentId ?? "openclaw-agent",
        session_id: event.sessionId,
        result: {
          runId: event.runId,
          sessionId: event.sessionId,
          provider: event.provider,
          model: event.model,
          assistantTextsCount: event.assistantTexts?.length ?? 0,
          usage: event.usage ?? null,
        },
      }).catch(() => {});
    });

    // ── 安全审计收集器 ────────────────────────────────────────────

    api.registerSecurityAuditCollector({
      collectorId: "maref-governance",
      label: "MAREF Governance",
      collect: async () => {
        try {
          const status = await client.getGovernanceStatus();
          return {
            status: "ok",
            data: {
              governance_state: status.state,
              circuit_breaker: status.circuit_breaker,
              trust_score_avg: status.trust_score_avg,
              drift_level: status.drift_level,
              cache: {
                size: stats.size,
                hits: stats.hits,
                misses: stats.misses,
              },
            },
          };
        } catch {
          return {
            status: "error",
            data: { error: "MAREF sidecar unreachable" },
          };
        }
      },
    });
  },
});
