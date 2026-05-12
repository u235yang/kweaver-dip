import { describe, expect, it, vi } from "vitest";

import type { IsfHttpClient, IsfHttpClientOptions } from "../infra/isf-http-client";
import { DefaultUserManagementAdapter } from "./user-management-adapter";

describe("DefaultUserManagementAdapter", () => {
  it("uses kweaverBaseUrl and forwards user-management operations", async () => {
    const client: IsfHttpClient = {
      forwardRequest: vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers(),
        body: "{}"
      })
    };
    const createClient = vi.fn((_: IsfHttpClientOptions) => client);
    const adapter = new DefaultUserManagementAdapter({
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

    await adapter.listApps({ keyword: "a" }, "token-1");
    await adapter.createApp({ name: "a", password: "" }, "token-1");
    await adapter.createAppToken({ id: "app-1" }, "token-1");

    expect(createClient).toHaveBeenCalledWith({
      baseUrl: "http://kweaver",
      timeoutMs: 5000
    });
    expect(client.forwardRequest).toHaveBeenNthCalledWith(
      1,
      "/api/user-management/v1/apps",
      {
        method: "GET",
        query: { keyword: "a" },
        bearerToken: "token-1"
      }
    );
    expect(client.forwardRequest).toHaveBeenNthCalledWith(
      2,
      "/api/user-management/v1/apps",
      {
        method: "POST",
        body: { name: "a", password: "" },
        bearerToken: "token-1"
      }
    );
    expect(client.forwardRequest).toHaveBeenNthCalledWith(
      3,
      "/api/user-management/v1/console/app-tokens",
      {
        method: "POST",
        body: { id: "app-1" },
        bearerToken: "token-1"
      }
    );
  });
});
