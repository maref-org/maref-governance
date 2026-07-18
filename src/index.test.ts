// MAREF Governance extension tests.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type {
  GateDecision,
  GovernanceStatus,
} from "@maref-org/sdk";
import plugin from "./index.ts";

// ── Mocks ─────────────────────────────────────────────────────────────

vi.mock("openclaw/plugin-sdk/plugin-entry", () => ({
  definePluginEntry: vi.fn((pluginDef) => pluginDef),
}));
vi.mock("openclaw/plugin-sdk/types", () => ({}));

vi.mock("@maref-org/sdk", () => {
  const client = {
    checkBeforeWrite: vi.fn(),
    checkBeforeExecute: vi.fn(),
    reportAction: vi.fn().mockResolvedValue(undefined),
    getGovernanceStatus: vi.fn(),
  };
  // Store on global so tests can reference it
  (globalThis as any).__marefMockClient = client;
  function MockMAREFClient() {
    return client;
  }
  MockMAREFClient.prototype.constructor = MockMAREFClient;
  return { MAREFClient: MockMAREFClient };
});

// ── Helpers ───────────────────────────────────────────────────────────

function makeAllowDecision(overrides?: Partial<GateDecision>): GateDecision {
  return {
    verdict: "allow",
    rule_id: "ALLOW-TEST",
    reason: "Policy allows this operation",
    risk_score: 0.1,
    decision_latency_ms: 5,
    actor: "test-agent",
    breaker_state: "closed",
    metadata: {},
    ...overrides,
  };
}

function makeBlockDecision(overrides?: Partial<GateDecision>): GateDecision {
  return {
    verdict: "block",
    rule_id: "BLOCK-TEST",
    reason: "Policy blocks this operation",
    risk_score: 0.9,
    decision_latency_ms: 5,
    actor: "test-agent",
    breaker_state: "closed",
    metadata: {},
    ...overrides,
  };
}

function makeHITLDecision(overrides?: Partial<GateDecision>): GateDecision {
  return {
    verdict: "hitl_required",
    rule_id: "HITL-TEST",
    reason: "Human review required",
    risk_score: 0.7,
    decision_latency_ms: 5,
    actor: "test-agent",
    breaker_state: "closed",
    metadata: {},
    ...overrides,
  };
}

function captureRegisterHook(
  api: OpenClawPluginApi,
): Map<string, (event: unknown, ctx: unknown) => unknown> {
  const hooks = new Map<
    string,
    (event: unknown, ctx: unknown) => unknown
  >();
  api.registerHook = vi.fn((name: string, handler: (event: unknown, ctx: unknown) => unknown) => {
    hooks.set(name, handler);
  }) as typeof api.registerHook;
  api.on = vi.fn((name: string, handler: (event: unknown, ctx: unknown) => unknown) => {
    hooks.set(name, handler);
  }) as typeof api.on;
  return hooks;
}

/** Minimal plugin API with defaults for maref-governance tests. */
function createTestApi(
  overrides?: Partial<OpenClawPluginApi>,
): OpenClawPluginApi {
  return {
    id: "maref-governance",
    name: "MAREF Governance",
    source: "test",
    registrationMode: "full",
    pluginConfig: {},
    config: {},
    runtime: {} as OpenClawPluginApi["runtime"],
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerTool: vi.fn(),
    registerHook: vi.fn(),
    registerHttpRoute: vi.fn(),
    registerHostedMediaResolver: vi.fn(),
    registerMcpServerConnectionResolver: vi.fn(),
    registerChannel: vi.fn(),
    registerGatewayMethod: vi.fn(),
    registerSessionCatalog: vi.fn(),
    registerCli: vi.fn(),
    registerNodeCliFeature: vi.fn(),
    registerCliBackend: vi.fn(),
    registerTextTransforms: vi.fn(),
    registerService: vi.fn(),
    registerGatewayDiscoveryService: vi.fn(),
    registerReload: vi.fn(),
    registerNodeHostCommand: vi.fn(),
    registerNodeInvokePolicy: vi.fn(),
    registerSecurityAuditCollector: vi.fn(),
    registerConfigMigration: vi.fn(),
    registerMigrationProvider: vi.fn(),
    registerAutoEnableProbe: vi.fn(),
    registerProvider: vi.fn(),
    registerModelCatalogProvider: vi.fn(),
    registerEmbeddingProvider: vi.fn(),
    registerSpeechProvider: vi.fn(),
    registerRealtimeTranscriptionProvider: vi.fn(),
    registerRealtimeVoiceProvider: vi.fn(),
    registerMediaUnderstandingProvider: vi.fn(),
    registerTranscriptSourceProvider: vi.fn(),
    registerImageGenerationProvider: vi.fn(),
    registerMusicGenerationProvider: vi.fn(),
    registerVideoGenerationProvider: vi.fn(),
    registerWebFetchProvider: vi.fn(),
    registerWebSearchProvider: vi.fn(),
    registerWorkerProvider: vi.fn(),
    registerInteractiveHandler: vi.fn(),
    onConversationBindingResolved: vi.fn(),
    registerCommand: vi.fn(),
    registerContextEngine: vi.fn(),
    registerCompactionProvider: vi.fn(),
    registerAgentHarness: vi.fn(),
    registerCodexAppServerExtensionFactory: vi.fn(),
    registerAgentToolResultMiddleware: vi.fn(),
    registerDetachedTaskRuntime: vi.fn(),
    registerSessionExtension: vi.fn(),
    registerTrustedToolPolicy: vi.fn(),
    registerToolMetadata: vi.fn(),
    registerControlUiDescriptor: vi.fn(),
    registerRuntimeLifecycle: vi.fn(),
    registerAgentEventSubscription: vi.fn(),
    registerSchedulerJob: vi.fn(),
    sendSessionAttachment: vi.fn(),
    scheduleSessionTurn: vi.fn(),
    unscheduleSessionTurnsByTag: vi.fn(),
    enqueueNextTurnInjection: vi.fn(),
    setRunContext: vi.fn(),
    getRunContext: vi.fn(),
    clearRunContext: vi.fn(),
    resolvePath: (input: string) => input,
    on: vi.fn(),
    ...overrides,
  } as unknown as OpenClawPluginApi;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe("maref-governance plugin", () => {
  let api: OpenClawPluginApi;
  let hooks: Map<string, (event: unknown, ctx: unknown) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    api = createTestApi();
    hooks = captureRegisterHook(api);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function registerPlugin(config: Record<string, unknown> = {}): void {
    api.pluginConfig = config;
    plugin.register(api);
  }

  /** Convenience: get the before_tool_call handler or throw. */
  function getBeforeToolCallHandler(): (
    event: unknown,
    ctx: unknown,
  ) => unknown {
    const handler = hooks.get("before_tool_call");
    if (!handler) throw new Error("before_tool_call hook not registered");
    return handler;
  }

  /** Get any hook handler by name, or throw if not registered. */
  function getHookHandler(name: string): (event: unknown, ctx: unknown) => unknown {
    const handler = hooks.get(name);
    if (!handler) throw new Error(`"${name}" hook not registered`);
    return handler;
  }

  /** Convenience: get the security audit collector or throw. */
  function getSecurityAuditCollector(): { collect: () => unknown } {
    const call = vi.mocked(api.registerSecurityAuditCollector).mock.calls[0];
    if (!call) throw new Error("securityAuditCollector not registered");
    return call[0] as unknown as { collect: () => unknown };
  }

  describe("registration", () => {
    it("registers before_tool_call hook and security audit collector", () => {
      registerPlugin();
      expect(api.registerHook).toHaveBeenCalledWith(
        "before_tool_call",
        expect.any(Function),
      );
      expect(api.registerSecurityAuditCollector).toHaveBeenCalledWith(
        expect.objectContaining({
          collectorId: "maref-governance",
          label: "MAREF Governance",
        }),
      );
    });
  });

  describe("logging mode", () => {
    beforeEach(() => {
      registerPlugin({ mode: "logging" });
    });

    it("passes through all tool calls without checking sidecar", async () => {
      const handler = getBeforeToolCallHandler();
      const result = await handler(
        { toolName: "write", params: { file_path: "/tmp/test.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      );
      expect(result).toEqual({});
      expect(globalThis.__marefMockClient.checkBeforeWrite).not.toHaveBeenCalled();
      expect(globalThis.__marefMockClient.checkBeforeExecute).not.toHaveBeenCalled();
    });

    it("passes through any tool call (including exec) without checking sidecar", async () => {
      const handler = getBeforeToolCallHandler();
      const result = await handler(
        { toolName: "Bash", params: { command: "rm -rf /" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      );
      expect(result).toEqual({});
      expect(globalThis.__marefMockClient.checkBeforeExecute).not.toHaveBeenCalled();
    });
  });

  describe("advisory mode", () => {
    beforeEach(() => {
      registerPlugin({ mode: "advisory" });
    });

    it("passes through even when sidecar blocks", async () => {
      globalThis.__marefMockClient.checkBeforeWrite.mockResolvedValue(makeBlockDecision());
      const handler = getBeforeToolCallHandler();
      const result = await handler(
        { toolName: "write", params: { file_path: "/tmp/test.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      );
      // Advisory mode always passes
      expect(result).toEqual({});
      expect(globalThis.__marefMockClient.checkBeforeWrite).toHaveBeenCalledTimes(1);
    });

    it("passes through block verdict and calls reportAction", async () => {
      globalThis.__marefMockClient.checkBeforeWrite.mockResolvedValue(makeBlockDecision());
      const handler = getBeforeToolCallHandler();
      await handler(
        { toolName: "write", params: { file_path: "/tmp/test.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      );
      expect(globalThis.__marefMockClient.reportAction).toHaveBeenCalled();
    });

    it("passes through on sidecar error (fail-open)", async () => {
      globalThis.__marefMockClient.checkBeforeWrite.mockRejectedValue(new Error("ECONNREFUSED"));
      const handler = getBeforeToolCallHandler();
      const result = await handler(
        { toolName: "write", params: { file_path: "/tmp/test.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      );
      expect(result).toEqual({});
    });
  });

  describe("enforcing mode", () => {
    beforeEach(() => {
      registerPlugin({ mode: "enforcing", failClosed: true });
    });

    it("allows when verdict is allow", async () => {
      globalThis.__marefMockClient.checkBeforeWrite.mockResolvedValue(makeAllowDecision());
      const handler = getBeforeToolCallHandler();
      const result = await handler(
        { toolName: "write", params: { file_path: "/tmp/test.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      );
      expect(result).toEqual({});
    });

    it("blocks when verdict is block", async () => {
      globalThis.__marefMockClient.checkBeforeWrite.mockResolvedValue(makeBlockDecision());
      const handler = getBeforeToolCallHandler();
      const result = await handler(
        { toolName: "write", params: { file_path: "/tmp/test.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      ) as { block?: boolean; blockReason?: string };
      expect(result.block).toBe(true);
      expect(result.blockReason).toContain("BLOCKED");
      expect(result.blockReason).toContain("BLOCK-TEST");
    });

    it("blocks when HITL is required", async () => {
      globalThis.__marefMockClient.checkBeforeWrite.mockResolvedValue(makeHITLDecision());
      const handler = getBeforeToolCallHandler();
      const result = await handler(
        { toolName: "write", params: { file_path: "/tmp/test.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      ) as { block?: boolean; blockReason?: string };
      expect(result.block).toBe(true);
      expect(result.blockReason).toContain("HITL required");
    });

    it("blocks command execution when verdict is block", async () => {
      globalThis.__marefMockClient.checkBeforeExecute.mockResolvedValue(makeBlockDecision());
      const handler = getBeforeToolCallHandler();
      const result = await handler(
        { toolName: "exec", params: { command: "rm -rf /" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      ) as { block?: boolean; blockReason?: string };
      expect(result.block).toBe(true);
      expect(result.blockReason).toContain("execute");
    });

    it("allows command execution when verdict is allow", async () => {
      globalThis.__marefMockClient.checkBeforeExecute.mockResolvedValue(makeAllowDecision());
      const handler = getBeforeToolCallHandler();
      const result = await handler(
        { toolName: "exec", params: { command: "echo hello" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      );
      expect(result).toEqual({});
    });

    it("calls reportAction with correct context", async () => {
      globalThis.__marefMockClient.checkBeforeWrite.mockResolvedValue(makeAllowDecision());
      const handler = getBeforeToolCallHandler();
      await handler(
        { toolName: "write", params: { file_path: "/tmp/test.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      );
      expect(globalThis.__marefMockClient.reportAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "openclaw:before_tool_call",
        }),
      );
    });
  });

  describe("fail-closed behavior", () => {
    it("blocks when sidecar unreachable in enforcing mode", async () => {
      registerPlugin({ mode: "enforcing", failClosed: true });
      globalThis.__marefMockClient.checkBeforeWrite.mockRejectedValue(new Error("ECONNREFUSED"));
      const handler = getBeforeToolCallHandler();
      const result = await handler(
        { toolName: "write", params: { file_path: "/tmp/test.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      ) as { block?: boolean; blockReason?: string };
      expect(result.block).toBe(true);
      expect(result.blockReason).toContain("FAIL-CLOSED");
    });

    it("does not block on sidecar error when failClosed is false", async () => {
      registerPlugin({ mode: "enforcing", failClosed: false });
      globalThis.__marefMockClient.checkBeforeWrite.mockRejectedValue(new Error("ECONNREFUSED"));
      const handler = getBeforeToolCallHandler();
      const result = await handler(
        { toolName: "write", params: { file_path: "/tmp/test.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      );
      expect(result).toEqual({});
    });

    it("does not block on sidecar error in advisory mode even with failClosed true", async () => {
      registerPlugin({ mode: "advisory", failClosed: true });
      globalThis.__marefMockClient.checkBeforeWrite.mockRejectedValue(new Error("ECONNREFUSED"));
      const handler = getBeforeToolCallHandler();
      const result = await handler(
        { toolName: "write", params: { file_path: "/tmp/test.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      );
      expect(result).toEqual({});
    });
  });

  describe("non-file/non-command tool calls pass through", () => {
    it("allows tools with neither file_path nor command params", async () => {
      registerPlugin({ mode: "enforcing" });
      const handler = getBeforeToolCallHandler();
      const result = await handler(
        { toolName: "think", params: { thought: "hmm" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      );
      expect(result).toEqual({});
      expect(globalThis.__marefMockClient.checkBeforeWrite).not.toHaveBeenCalled();
      expect(globalThis.__marefMockClient.checkBeforeExecute).not.toHaveBeenCalled();
    });
  });

  describe("default config values", () => {
    it("defaults to enforcing mode, fail-closed, localhost sidecar", async () => {
      // pluginConfig not set — should use defaults
      registerPlugin();
      const handler = getBeforeToolCallHandler();
      globalThis.__marefMockClient.checkBeforeWrite.mockRejectedValue(new Error("ECONNREFUSED"));
      const result = await handler(
        { toolName: "write", params: { file_path: "/tmp/test.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      ) as { block?: boolean; blockReason?: string };
      expect(result.block).toBe(true);
      expect(result.blockReason).toContain("FAIL-CLOSED");
    });
  });

  describe("session_start hook", () => {
    it("reports session start to MAREF", async () => {
      registerPlugin({ mode: "enforcing" });
      const handler = getHookHandler("session_start");
      await handler(
        {
          sessionId: "sess-123",
          sessionKey: "sk-abc",
          resumedFrom: null,
        },
        { agentId: "test-agent", sessionId: "sess-123" },
      );
      expect(globalThis.__marefMockClient.reportAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "openclaw:session_start",
          actor: "test-agent",
          session_id: "sess-123",
        }),
      );
    });

    it("skips reporting in logging mode", async () => {
      registerPlugin({ mode: "logging" });
      const handler = getHookHandler("session_start");
      await handler(
        {
          sessionId: "sess-123",
          sessionKey: "sk-abc",
          resumedFrom: undefined,
        },
        { agentId: "test-agent", sessionId: "sess-123" },
      );
      expect(globalThis.__marefMockClient.reportAction).not.toHaveBeenCalled();
    });

    it("handles sidecar error gracefully", () => {
      registerPlugin({ mode: "enforcing" });
      globalThis.__marefMockClient.reportAction.mockRejectedValue(
        new Error("ECONNREFUSED"),
      );
      const handler = getHookHandler("session_start");
      expect(() =>
        handler(
          {
            sessionId: "sess-123",
            sessionKey: "sk-abc",
            resumedFrom: undefined,
          },
          { agentId: "test-agent", sessionId: "sess-123" },
        ),
      ).not.toThrow();
    });
  });

  describe("session_end hook", () => {
    it("reports session end to MAREF with metadata", async () => {
      registerPlugin({ mode: "enforcing" });
      const handler = getHookHandler("session_end");
      await handler(
        {
          sessionId: "sess-123",
          sessionKey: "sk-abc",
          messageCount: 42,
          durationMs: 60000,
          reason: "idle",
          transcriptArchived: true,
          nextSessionId: "sess-124",
        },
        { agentId: "test-agent", sessionId: "sess-123" },
      );
      expect(globalThis.__marefMockClient.reportAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "openclaw:session_end",
          actor: "test-agent",
          session_id: "sess-123",
          result: expect.objectContaining({
            messageCount: 42,
            durationMs: 60000,
            reason: "idle",
          }),
        }),
      );
    });

    it("skips reporting in logging mode", async () => {
      registerPlugin({ mode: "logging" });
      const handler = getHookHandler("session_end");
      await handler(
        {
          sessionId: "sess-123",
          messageCount: 0,
          reason: "new",
        },
        { agentId: "test-agent", sessionId: "sess-123" },
      );
      expect(globalThis.__marefMockClient.reportAction).not.toHaveBeenCalled();
    });
  });

  describe("llm_input hook", () => {
    it("reports LLM input metadata to MAREF", async () => {
      registerPlugin({ mode: "enforcing" });
      const handler = getHookHandler("llm_input");
      await handler(
        {
          runId: "run-1",
          sessionId: "sess-123",
          provider: "openai",
          model: "gpt-4",
          systemPrompt: "You are a helpful assistant",
          prompt: "Hello, how are you?",
          historyMessages: [{ role: "user", content: "hi" }],
          imagesCount: 0,
          tools: [{ name: "bash", description: "Run a command" }],
        },
        { agentId: "test-agent", sessionId: "sess-123" },
      );
      expect(globalThis.__marefMockClient.reportAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "openclaw:llm_input",
          actor: "test-agent",
          session_id: "sess-123",
          result: expect.objectContaining({
            provider: "openai",
            model: "gpt-4",
            systemPromptLength: expect.any(Number),
            promptLength: expect.any(Number),
            historyMessagesCount: 1,
            imagesCount: 0,
            toolsCount: 1,
          }),
        }),
      );
    });

    it("skips reporting in logging mode", async () => {
      registerPlugin({ mode: "logging" });
      const handler = getHookHandler("llm_input");
      await handler(
        {
          runId: "run-1",
          sessionId: "sess-123",
          provider: "openai",
          model: "gpt-4",
          prompt: "test",
          imagesCount: 0,
        },
        { agentId: "test-agent", sessionId: "sess-123" },
      );
      expect(globalThis.__marefMockClient.reportAction).not.toHaveBeenCalled();
    });
  });

  describe("llm_output hook", () => {
    it("reports LLM output metadata to MAREF", async () => {
      registerPlugin({ mode: "enforcing" });
      const handler = getHookHandler("llm_output");
      await handler(
        {
          runId: "run-1",
          sessionId: "sess-123",
          provider: "openai",
          model: "gpt-4",
          assistantTexts: ["Hello! How can I help you today?"],
          usage: { input: 50, output: 10, total: 60 },
        },
        { agentId: "test-agent", sessionId: "sess-123" },
      );
      expect(globalThis.__marefMockClient.reportAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "openclaw:llm_output",
          actor: "test-agent",
          session_id: "sess-123",
          result: expect.objectContaining({
            provider: "openai",
            model: "gpt-4",
            assistantTextsCount: 1,
            usage: { input: 50, output: 10, total: 60 },
          }),
        }),
      );
    });

    it("skips reporting in logging mode", async () => {
      registerPlugin({ mode: "logging" });
      const handler = getHookHandler("llm_output");
      await handler(
        {
          runId: "run-1",
          sessionId: "sess-123",
          provider: "openai",
          model: "gpt-4",
          assistantTexts: [],
        },
        { agentId: "test-agent", sessionId: "sess-123" },
      );
      expect(globalThis.__marefMockClient.reportAction).not.toHaveBeenCalled();
    });
  });

  describe("decision cache", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      registerPlugin({
        mode: "enforcing",
        failClosed: true,
        cacheTtlMs: 60_000,
        cacheBlockTtlMs: 120_000,
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("returns cached allow decision on repeated check", async () => {
      globalThis.__marefMockClient.checkBeforeWrite.mockResolvedValue(makeAllowDecision());
      const handler = getBeforeToolCallHandler();

      // First call — should hit sidecar
      const result1 = await handler(
        { toolName: "write", params: { file_path: "/tmp/test.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      );
      expect(result1).toEqual({});
      expect(globalThis.__marefMockClient.checkBeforeWrite).toHaveBeenCalledTimes(1);

      // Second call — should use cache, skip sidecar
      const result2 = await handler(
        { toolName: "write", params: { file_path: "/tmp/test.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      );
      expect(result2).toEqual({});
      expect(globalThis.__marefMockClient.checkBeforeWrite).toHaveBeenCalledTimes(1);
    });

    it("returns cached block decision on repeated check", async () => {
      globalThis.__marefMockClient.checkBeforeWrite.mockResolvedValue(makeBlockDecision());
      const handler = getBeforeToolCallHandler();

      const result1 = await handler(
        { toolName: "write", params: { file_path: "/tmp/test.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      ) as { block?: boolean };
      expect(result1.block).toBe(true);
      expect(globalThis.__marefMockClient.checkBeforeWrite).toHaveBeenCalledTimes(1);

      // Cached block
      const result2 = await handler(
        { toolName: "write", params: { file_path: "/tmp/test.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      ) as { block?: boolean };
      expect(result2.block).toBe(true);
      expect(globalThis.__marefMockClient.checkBeforeWrite).toHaveBeenCalledTimes(1);
    });

    it("expires cache entry after TTL", async () => {
      globalThis.__marefMockClient.checkBeforeWrite.mockResolvedValue(makeAllowDecision());
      const handler = getBeforeToolCallHandler();

      await handler(
        { toolName: "write", params: { file_path: "/tmp/test.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      );
      expect(globalThis.__marefMockClient.checkBeforeWrite).toHaveBeenCalledTimes(1);

      // Advance time past TTL
      vi.advanceTimersByTime(60_001);

      // Change mock response to verify fresh call is made
      globalThis.__marefMockClient.checkBeforeWrite.mockResolvedValue(makeBlockDecision());
      const result = await handler(
        { toolName: "write", params: { file_path: "/tmp/test.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      ) as { block?: boolean };
      expect(result.block).toBe(true);
      expect(globalThis.__marefMockClient.checkBeforeWrite).toHaveBeenCalledTimes(2);
    });

    it("does not cache when cacheTtlMs is 0", async () => {
      vi.useRealTimers();
      registerPlugin({
        mode: "enforcing",
        cacheTtlMs: 0,
        cacheBlockTtlMs: 0,
      });
      globalThis.__marefMockClient.checkBeforeWrite.mockResolvedValue(makeAllowDecision());
      const handler = getBeforeToolCallHandler();

      await handler(
        { toolName: "write", params: { file_path: "/tmp/test.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      );
      await handler(
        { toolName: "write", params: { file_path: "/tmp/test.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      );
      expect(globalThis.__marefMockClient.checkBeforeWrite).toHaveBeenCalledTimes(2);
    });

    it("does not cache HITL decisions", async () => {
      globalThis.__marefMockClient.checkBeforeWrite.mockResolvedValue(makeHITLDecision());
      const handler = getBeforeToolCallHandler();

      await handler(
        { toolName: "write", params: { file_path: "/tmp/test.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      );
      await handler(
        { toolName: "write", params: { file_path: "/tmp/test.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      );
      // HITL decisions should always hit sidecar
      expect(globalThis.__marefMockClient.checkBeforeWrite).toHaveBeenCalledTimes(2);
    });

    it("caches different keys independently", async () => {
      globalThis.__marefMockClient.checkBeforeWrite.mockResolvedValue(makeAllowDecision());
      const handler = getBeforeToolCallHandler();

      await handler(
        { toolName: "write", params: { file_path: "/tmp/a.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      );
      await handler(
        { toolName: "write", params: { file_path: "/tmp/b.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      );
      // Two different files should result in two sidecar calls
      expect(globalThis.__marefMockClient.checkBeforeWrite).toHaveBeenCalledTimes(2);

      // Repeat — both should be cached now
      await handler(
        { toolName: "write", params: { file_path: "/tmp/a.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      );
      await handler(
        { toolName: "write", params: { file_path: "/tmp/b.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      );
      expect(globalThis.__marefMockClient.checkBeforeWrite).toHaveBeenCalledTimes(2);
    });

    it("reports cache stats in security audit collector", async () => {
      vi.useRealTimers();
      registerPlugin();
      globalThis.__marefMockClient.checkBeforeWrite.mockResolvedValue(makeAllowDecision());
      globalThis.__marefMockClient.getGovernanceStatus.mockResolvedValue({
        state: "active",
        circuit_breaker: "CLOSED",
        agent_count: 5,
        trust_score_avg: 0.85,
        drift_level: "LOW",
        timestamp: Date.now(),
      });

      const handler = getBeforeToolCallHandler();
      await handler(
        { toolName: "write", params: { file_path: "/tmp/test.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      );
      await handler(
        { toolName: "write", params: { file_path: "/tmp/test.txt" } },
        { agentId: "test-agent", sessionId: "sess-1" },
      );

      const collector = getSecurityAuditCollector();
      const result = await collector.collect() as { status: string; data: Record<string, unknown> };
      expect(result.status).toBe("ok");
      expect(result.data).toHaveProperty("cache");
    });
  });

  describe("security audit collector", () => {
    it("returns ok status when sidecar is reachable", async () => {
      registerPlugin();
      globalThis.__marefMockClient.getGovernanceStatus.mockResolvedValue({
        state: "active",
        circuit_breaker: "CLOSED",
        agent_count: 5,
        trust_score_avg: 0.85,
        drift_level: "LOW",
        timestamp: Date.now(),
      });
      const collector = getSecurityAuditCollector();
      const result = await collector.collect() as { status: string; data: Record<string, unknown> };
      expect(result.status).toBe("ok");
      expect(result.data.governance_state).toBe("active");
      expect(result.data.circuit_breaker).toBe("CLOSED");
      expect(result.data.trust_score_avg).toBe(0.85);
      expect(result.data.drift_level).toBe("LOW");
    });

    it("returns error status when sidecar is unreachable", async () => {
      registerPlugin();
      globalThis.__marefMockClient.getGovernanceStatus.mockRejectedValue(new Error("ECONNREFUSED"));
      const collector = getSecurityAuditCollector();
      const result = await collector.collect() as { status: string; data: Record<string, unknown> };
      expect(result.status).toBe("error");
      expect(result.data.error).toContain("unreachable");
    });
  });
});
