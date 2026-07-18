import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger } from "@/lib/logger";
import { UserRepository, UserService } from "@/lib/services/user-service";
import { UploadService } from "@/lib/services/upload-service";

describe("Structured Logging & Global Exceptions - Issue #151", () => {
  let logSpy: any;
  let warnSpy: any;
  let errorSpy: any;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (process.env as any).LOG_LEVEL;
    delete (process.env as any).NODE_ENV;
  });

  it("should output structured logging in production format", () => {
    (process.env as any).NODE_ENV = "production";
    (process.env as any).LOG_LEVEL = "INFO";

    logger.info("Test info message", { userId: "123" });

    expect(logSpy).toHaveBeenCalled();
    const lastCall = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(lastCall);
    expect(parsed.level).toBe("INFO");
    expect(parsed.message).toBe("Test info message");
    expect(parsed.context).toEqual({ userId: "123" });
    expect(parsed.timestamp).toBeDefined();
  });

  it("should honor LOG_LEVEL settings", () => {
    (process.env as any).NODE_ENV = "production";
    (process.env as any).LOG_LEVEL = "WARN";

    logger.info("Should not log info level");
    expect(logSpy).not.toHaveBeenCalled();

    logger.warn("Should log warn level");
    expect(warnSpy).toHaveBeenCalled();
  });

  it("should catch unhandled exceptions, log them, and mask in production mode", async () => {
    const { withErrorHandler } = await import("@/lib/api-middleware");
    const { NextRequest } = await import("next/server");

    (process.env as any).NODE_ENV = "production";

    const failingHandler = async () => {
      throw new Error("Sensitive DB Query Failed!");
    };

    const wrapped = withErrorHandler(failingHandler);
    const mockRequest = new NextRequest("http://localhost/api/test", { method: "GET" });
    const response = await wrapped(mockRequest);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Internal Server Error");
    expect(data.message).toBe("An unexpected error occurred.");
    expect(errorSpy).toHaveBeenCalled();
  });

  it("should catch unhandled exceptions, log them, and show details in development mode", async () => {
    const { withErrorHandler } = await import("@/lib/api-middleware");
    const { NextRequest } = await import("next/server");

    (process.env as any).NODE_ENV = "development";

    const failingHandler = async () => {
      throw new Error("Sensitive DB Query Failed!");
    };

    const wrapped = withErrorHandler(failingHandler);
    const mockRequest = new NextRequest("http://localhost/api/test", { method: "GET" });
    const response = await wrapped(mockRequest);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe("Internal Server Error");
    expect(data.message).toBe("Sensitive DB Query Failed!");
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe("SOLID Principles Violations - Issue #152", () => {
  it("should dynamically inject database clients using Dependency Inversion", async () => {
    // 1. Define a mock database client adhering to interface
    const mockDbClient = {
      findUnique: vi.fn().mockResolvedValue({ id: "user-123", email: "test@example.com" }),
    };

    // 2. Instantiate a Repository with the injected mock client
    const repo = new UserRepository(mockDbClient as any);
    const service = new UserService(repo);

    const user = await service.getUserById("user-123");

    expect(mockDbClient.findUnique).toHaveBeenCalledWith({
      where: { id: "user-123" },
    });
    expect(user).toEqual({ id: "user-123", email: "test@example.com" });
  });

  it("should support Liskov Substitution and Open-Closed principles for storage services", async () => {
    const mockRepo = {
      createUpload: vi.fn().mockResolvedValue({ id: "record-123", filename: "test.png", payload: "mock-payload" }),
    };

    const mockStorage = {
      store: vi.fn().mockResolvedValue("mock-payload"),
    };

    const uploadService = new UploadService(mockRepo, mockStorage);
    const content = new Uint8Array([1, 2, 3]);
    const result = await uploadService.handleUpload("test.png", "image/png", content);

    expect(mockStorage.store).toHaveBeenCalledWith("test.png", "image/png", content);
    expect(mockRepo.createUpload).toHaveBeenCalledWith("test.png", "image/png", "mock-payload");
    expect(result.id).toBe("record-123");
  });
});
