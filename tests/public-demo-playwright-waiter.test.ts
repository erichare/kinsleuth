import { describe, expect, it } from "vitest";

describe("public demo Playwright waiter observation", () => {
  it("returns the identical waiter while immediately observing an early rejection", async () => {
    const browserCanaryUrl: string = new URL(
      "../scripts/public-demo-browser-canary.mjs",
      import.meta.url
    ).href;
    const browserCanary = await import(browserCanaryUrl) as {
      observePlaywrightWaiter?: <T>(waiter: Promise<T>) => Promise<T>;
    };
    const { observePlaywrightWaiter } = browserCanary;

    expect(observePlaywrightWaiter).toBeTypeOf("function");
    if (typeof observePlaywrightWaiter !== "function") return;

    const rejection = Object.freeze({ code: "test-waiter-rejection" });
    const unhandled: Array<{ promise: Promise<unknown>; reason: unknown }> = [];
    const onUnhandled = (reason: unknown, promise: Promise<unknown>) => {
      unhandled.push({ promise, reason });
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const waiter = Promise.reject(rejection);
      const returned = observePlaywrightWaiter(waiter);
      expect(returned).toBe(waiter);

      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(unhandled.filter(({ promise }) => promise === waiter)).toEqual([]);
      await expect(returned).rejects.toBe(rejection);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
