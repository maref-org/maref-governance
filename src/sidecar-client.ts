/**
 * Minimal MAREF sidecar client for the governance plugin.
 *
 * The npm package `@maref-org/sdk` still points at `/api/governance/check`,
 * which the sidecar removed (soft-deprecated 2026-08-13). It also sends no
 * Authorization header, so any protected route returns 401.
 *
 * This client talks to the endpoints the sidecar actually exposes:
 *   POST /api/v1/guardrails/check-before-write
 *   POST /api/v1/guardrails/check-before-execute
 *   POST /api/v1/guardrails/actions
 *   GET  /api/status                      (auth bypass)
 */

export interface GuardrailDecision {
  verdict: string;
  rule_id?: string;
  reason?: string;
  risk_score?: number;
  decision_latency_ms?: number;
  actor?: string;
  breaker_state?: string;
  metadata?: Record<string, unknown>;
}

export type SidecarErrorKind =
  | "auth"
  | "endpoint_missing"
  | "unreachable"
  | "server"
  | "invalid_response";

export class SidecarError extends Error {
  readonly kind: SidecarErrorKind;
  readonly status?: number;

  constructor(kind: SidecarErrorKind, message: string, status?: number) {
    super(message);
    this.name = "SidecarError";
    this.kind = kind;
    this.status = status;
  }
}

export interface SidecarClientOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
}

export interface WriteCheckParams {
  file_path: string;
  actor?: string;
  session_id?: string;
}

export interface ExecuteCheckParams {
  command: string;
  actor?: string;
  session_id?: string;
}

export interface ReportActionParams {
  action: string;
  actor?: string;
  session_id?: string;
  result?: Record<string, unknown>;
}

const DEFAULT_TIMEOUT_MS = 3_000;

export class SidecarClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;

  constructor(options: SidecarClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey;
    this.timeoutMs = Math.max(100, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  }

  checkBeforeWrite(params: WriteCheckParams): Promise<GuardrailDecision> {
    return this.postGuardrail("write", this.writeBody(params));
  }

  checkBeforeExecute(params: ExecuteCheckParams): Promise<GuardrailDecision> {
    return this.postGuardrail("execute", this.executeBody(params));
  }

  /** Best-effort audit record. Never throws. */
  async reportAction(params: ReportActionParams): Promise<void> {
    try {
      await this.request("/api/v1/guardrails/actions", {
        method: "POST",
        body: JSON.stringify({
          action: params.action,
          actor: params.actor ?? "unknown",
          session_id: params.session_id ?? "default",
          result: params.result ?? {},
        }),
      });
    } catch {
      // Audit is best-effort; governance decisions must not depend on it.
    }
  }

  async getGovernanceStatus(): Promise<Record<string, unknown>> {
    const res = await this.request("/api/status", { method: "GET" });
    return (await this.parseJson(res)) as Record<string, unknown>;
  }

  private writeBody(params: WriteCheckParams): Record<string, unknown> {
    return {
      actor: params.actor ?? "unknown",
      risk: "low",
      file_path: params.file_path,
      session_id: params.session_id ?? "default",
    };
  }

  private executeBody(params: ExecuteCheckParams): Record<string, unknown> {
    return {
      actor: params.actor ?? "unknown",
      risk: "low",
      command: params.command,
      session_id: params.session_id ?? "default",
    };
  }

  private async postGuardrail(
    tool: "write" | "execute",
    body: Record<string, unknown>,
  ): Promise<GuardrailDecision> {
    const res = await this.request(`/api/v1/guardrails/check-before-${tool}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const payload = await this.parseJson(res);

    if (!payload || typeof payload !== "object" || typeof (payload as GuardrailDecision).verdict !== "string") {
      throw new SidecarError("invalid_response", "sidecar response missing verdict");
    }
    return payload as GuardrailDecision;
  }

  private async request(path: string, init: { method: string; body?: string }): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: init.method,
        headers,
        body: init.body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new SidecarError("unreachable", `sidecar request failed: ${message}`);
    }

    if (res.status === 401 || res.status === 403) {
      throw new SidecarError("auth", `sidecar rejected credentials (HTTP ${res.status})`, res.status);
    }
    if (res.status === 404) {
      throw new SidecarError(
        "endpoint_missing",
        `sidecar endpoint not found: ${path} (sidecar version may be too old)`,
        res.status,
      );
    }
    if (!res.ok) {
      throw new SidecarError("server", `sidecar returned HTTP ${res.status}`, res.status);
    }
    return res;
  }

  private async parseJson(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw new SidecarError("invalid_response", "sidecar returned non-JSON body", res.status);
    }
  }
}
