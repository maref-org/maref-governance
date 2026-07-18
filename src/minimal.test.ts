import { describe, expect, it, vi } from "vitest";

vi.mock("openclaw/plugin-sdk/plugin-entry", () => ({
  definePluginEntry: vi.fn((x: any) => x),
}));
vi.mock("openclaw/plugin-sdk/types", () => ({}));

vi.mock("@maref-org/sdk", () => {
  const client = {
    checkBeforeWrite: vi.fn().mockResolvedValue({ verdict: "allow" }),
    checkBeforeExecute: vi.fn(),
    reportAction: vi.fn().mockResolvedValue(undefined),
    getGovernanceStatus: vi.fn(),
  };
  (globalThis as any).__marefMockClient2 = client;
  function MockMAREFClient() {
    return client;
  }
  MockMAREFClient.prototype.constructor = MockMAREFClient;
  return { MAREFClient: MockMAREFClient };
});

import plugin from "./index.ts";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

describe("minimal test", () => {
  it("plugin has register", () => {
    expect(plugin).toBeDefined();
    expect(typeof plugin.register).toBe("function");
  });

  it("mock client works", () => {
    const c = (globalThis as any).__marefMockClient2;
    expect(c).toBeDefined();
    expect(typeof c.checkBeforeWrite).toBe("function");
  });
});
