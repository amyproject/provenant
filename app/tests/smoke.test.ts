import { describe, expect, it } from "vitest";
import type { FlagId } from "@/contracts";

describe("vitest setup", () => {
  it("resolves the @/ alias to src/", async () => {
    const mod = await import("@/contracts");
    expect(mod).toBeTypeOf("object");
    const id: FlagId = "F01_SIGNATURE_INVALID";
    expect(id).toBe("F01_SIGNATURE_INVALID");
  });
});
