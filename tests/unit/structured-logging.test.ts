import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST as stateSyncPOST } from "@/app/api/state-sync/route";
import { logger } from "@/lib/logger";

// Mock database prisma
const mockFileFindUnique = vi.fn();
vi.mock("@/lib/db", () => ({
  prisma: {
    file: {
      findUnique: (...args: any[]) => mockFileFindUnique(...args),
    },
  },
}));

// Mock getServerSession
const mockGetUser = vi.fn();
vi.mock("@/lib/session-auth/server", () => ({
  getServerSession: () => ({
    getUser: mockGetUser,
  }),
}));

describe("Structured Logging & Exception Handling - Issue #151", () => {
  let logSpy: any;
  let warnSpy: any;
  let errorSpy: any;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetUser.mockResolvedValue({ id: "user-1", email: "user@test.com", name: "Test User" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (process.env as any).LOG_LEVEL;
    delete (process.env as any).NODE_ENV;
  });

  it("should exercise logging helper and output structured logs in production format", () => {
    (process.env as any).NODE_ENV = "production";
    (process.env as any).LOG_LEVEL = "INFO";

    logger.info("Structured log message", { metadata: "value" });

    expect(logSpy).toHaveBeenCalled();
    const lastCall = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(lastCall);
    expect(parsed.level).toBe("INFO");
    expect(parsed.message).toBe("Structured log message");
    expect(parsed.context).toEqual({ metadata: "value" });
    expect(parsed.timestamp).toBeDefined();
  });

  it("should handle exceptions gracefully via global exception handler wrapper for state-sync API route", async () => {
    (process.env as any).NODE_ENV = "production";

    // Force an unhandled exception inside POST by making the checkFileAccess / findUnique throw
    mockFileFindUnique.mockRejectedValue(new Error("Database connection timed out!"));

    const req = new Request("http://localhost/api/state-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "files:updateDocument",
        args: {
          _id: "file-exception-trigger",
          document: "{}",
        },
      }),
    });

    const res = await stateSyncPOST(req);

    // Verify exception handling response
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("Internal Server Error");
    expect(data.message).toBe("An unexpected error occurred.");

    // Verify that exception has been logged using the structured logger
    expect(errorSpy).toHaveBeenCalled();
    
    // In production, logger.error outputs structured JSON to console.error
    let foundStructuredLog = false;
    for (const call of errorSpy.mock.calls) {
      try {
        const parsed = JSON.parse(call[0]);
        if (parsed.level === "ERROR" && parsed.message.includes("Unhandled exception")) {
          foundStructuredLog = true;
          expect(parsed.error).toBeDefined();
          expect(parsed.error.message).toBe("Database connection timed out!");
          break;
        }
      } catch (e) {
        // Not a structured JSON log
      }
    }
    expect(foundStructuredLog).toBe(true);
  });
});
