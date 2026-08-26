import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(resolve("public/manifest.json"), "utf8")) as {
  manifest_version: number;
  permissions: string[];
  host_permissions: string[];
  optional_host_permissions: string[];
  icons: Record<string, string>;
};

describe("Manifest V3 package", () => {
  it("uses minimal install-time permissions", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).not.toContain("tabs");
    expect(manifest.permissions).not.toContain("cookies");
    expect(manifest.permissions).not.toContain("nativeMessaging");
    expect(manifest.host_permissions).not.toContain("<all_urls>");
    expect(manifest.optional_host_permissions).toEqual(["https://*/*"]);
  });

  it("ships every declared icon", () => {
    for (const icon of Object.values(manifest.icons)) {
      expect(existsSync(resolve("public", icon))).toBe(true);
    }
  });
});
