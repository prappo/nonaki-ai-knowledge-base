/** Every agent session gets all the MCP servers by default. */

import { describe, expect, it } from "vitest";
import {
  CONTROL_MCP_NAME,
  mcpAccessFromEnv,
  sessionMcpOptions,
  sessionProcessEnv,
} from "../console/server/runs/mcpAccess.ts";

const paired = { RELEASE_SERVER: "https://kb.example.com/", RELEASE_AGENT_TOKEN: "nk_agent_secret", RELEASE_CHROME: "1" };

describe("sessionMcpOptions", () => {
  it("adds the control server's MCP server with the agent token, project servers and Chrome", () => {
    const options = sessionMcpOptions(mcpAccessFromEnv(paired));

    expect(options.mcpServers).toEqual({
      [CONTROL_MCP_NAME]: {
        type: "http",
        url: "https://kb.example.com/api/mcp",
        headers: { Authorization: "Bearer nk_agent_secret" },
      },
    });
    expect(options.settings).toEqual({ enableAllProjectMcpServers: true });
    expect(options.extraArgs).toEqual({ chrome: null });
  });

  it("turns Chrome on unless the agent says there is no browser", () => {
    expect(mcpAccessFromEnv({}).chrome).toBe(true);
    expect(sessionMcpOptions(mcpAccessFromEnv({ RELEASE_CHROME: "0" })).extraArgs).toBeUndefined();
  });

  it("leaves Chrome out of one session on request", () => {
    expect(sessionMcpOptions(mcpAccessFromEnv(paired), { chrome: false }).extraArgs).toBeUndefined();
  });

  it("skips the control server when the agent isn't paired, but keeps the rest", () => {
    const options = sessionMcpOptions(mcpAccessFromEnv({}));

    expect(options.mcpServers).toBeUndefined();
    expect(options.settings).toEqual({ enableAllProjectMcpServers: true });
  });
});

describe("sessionProcessEnv", () => {
  it("never hands the agent token to sessions", () => {
    const env = sessionProcessEnv({ ...paired, PATH: "/usr/bin", HOME: "/home/me" });

    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/home/me" });
  });
});
