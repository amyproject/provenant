// Security: the tamper path walks attacker-supplied dot paths; it must not reach Object.prototype.
import { afterEach, describe, expect, it } from "vitest";
import { call } from "../helpers/route";
import { routes } from "../helpers/routes";
import { stopAutopilot } from "../helpers/demo";

afterEach(() => {
  delete (Object.prototype as Record<string, unknown>).qaPolluted;
});

describe("POST /api/demo/tamper path safety", () => {
  it.each(["__proto__.qaPolluted", "constructor.prototype.qaPolluted", "components.__proto__.qaPolluted"])(
    "%s does not pollute Object.prototype",
    async (path) => {
      await stopAutopilot();
      await call(await routes.demoReset(), "POST", "/api/demo/reset");
      const r = await call(await routes.demoTamper(), "POST", "/api/demo/tamper", {
        body: { passportId: "pp_A_1", path, value: "yes" },
      });
      expect(({} as Record<string, unknown>).qaPolluted, "Object.prototype was polluted").toBeUndefined();
      expect([]).not.toHaveProperty("qaPolluted");
      expect(r.status).toBe(400);
    },
  );
});
