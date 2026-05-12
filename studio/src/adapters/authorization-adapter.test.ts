import { describe, expect, it, vi } from "vitest";

import type { IsfHttpClient, IsfHttpClientOptions } from "../infra/isf-http-client";
import { DefaultAuthorizationAdapter } from "./authorization-adapter";

describe("DefaultAuthorizationAdapter", () => {
  it("uses kweaverBaseUrl and forwards authorization operations", async () => {
    const client: IsfHttpClient = {
      forwardRequest: vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers(),
        body: "{}"
      })
    };
    const createClient = vi.fn((_: IsfHttpClientOptions) => client);
    const adapter = new DefaultAuthorizationAdapter({
      getEnv: () => ({
        port: 3000,
        bknBackendUrl: "http://bkn",
        kweaverBaseUrl: "http://kweaver",
        hydraAdminUrl: "http://hydra",
        isDevelopment: false,
        openClawGatewayUrl: "ws://gateway",
        openClawGatewayHttpUrl: "http://gateway",
        openClawGatewayTimeoutMs: 5000,
        openClawLocalWorkspaceDir: "/tmp"
      }),
      createClient
    });

    await adapter.listAccessorPolicies({ accessor_id: "app-1" }, "token-1");
    await adapter.createPolicies([{ id: "policy-1" }], "token-1");

    expect(createClient).toHaveBeenCalledWith({
      baseUrl: "http://kweaver",
      timeoutMs: 5000
    });
    expect(client.forwardRequest).toHaveBeenNthCalledWith(
      1,
      "/api/authorization/v1/accessor-policy",
      {
        method: "GET",
        query: { accessor_id: "app-1" },
        bearerToken: "token-1"
      }
    );
    expect(client.forwardRequest).toHaveBeenNthCalledWith(
      2,
      "/api/authorization/v1/policy",
      {
        method: "POST",
        body: [{ id: "policy-1" }],
        bearerToken: "token-1"
      }
    );
  });
});
