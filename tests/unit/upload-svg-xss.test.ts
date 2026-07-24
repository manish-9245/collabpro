import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as uploadPOST } from "@/app/api/upload/route";
import { GET as serveGET } from "@/app/api/upload/[id]/route";

// Mock database prisma (same pattern as tests/unit/security-endpoints.test.ts)
const mockUploadedFileFindUnique = vi.fn();
const mockUploadedFileCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    uploadedFile: {
      findUnique: (...args: any[]) => mockUploadedFileFindUnique(...args),
      create: (...args: any[]) => mockUploadedFileCreate(...args),
    },
  },
}));

function buildUploadRequest(filename: string, mimeType: string, content: string) {
  const req = new Request("http://localhost/api/upload", { method: "POST" });
  req.headers.set("content-type", "multipart/form-data");
  const bytes = new TextEncoder().encode(content);
  req.formData = async () => {
    const data = new Map();
    data.set("file", {
      name: filename,
      type: mimeType,
      size: bytes.byteLength,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    return {
      get: (key: string) => data.get(key),
    } as any;
  };
  return req;
}

describe("Issue #195: SVG upload XSS validation bypass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadedFileCreate.mockImplementation(async ({ data }: any) => ({
      id: "new-id",
      ...data,
    }));
  });

  const maliciousSvgs: Array<{ name: string; svg: string }> = [
    {
      name: "onload event handler",
      svg: `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.domain)"/>`,
    },
    {
      name: "onerror via <image>",
      svg: `<svg xmlns="http://www.w3.org/2000/svg"><image href="x" onerror="alert(1)"/></svg>`,
    },
    {
      name: "javascript: URI in <a href>",
      svg: `<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><rect width="10" height="10"/></a></svg>`,
    },
    {
      name: "foreignObject + iframe javascript:",
      svg: `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><iframe src="javascript:alert(1)"></iframe></body></foreignObject></svg>`,
    },
  ];

  it.each(maliciousSvgs)(
    "accepts but never allows the browser to execute a malicious SVG ($name)",
    async ({ svg }) => {
      const req = buildUploadRequest("evil.svg", "image/svg+xml", svg);
      const res = await uploadPOST(req as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(1);

      // The stored mime type must never remain image/svg+xml, since that is
      // what allows a browser to render the SVG as a live, scriptable document.
      expect(mockUploadedFileCreate).toHaveBeenCalledTimes(1);
      const createCall = mockUploadedFileCreate.mock.calls[0][0];
      expect(createCall.data.mimeType).not.toMatch(/svg/i);

      // And when served back, it must come back as a forced download, not an
      // inline, browser-renderable document.
      mockUploadedFileFindUnique.mockResolvedValue({
        id: "evil-id",
        filename: createCall.data.filename,
        mimeType: createCall.data.mimeType,
        payload: createCall.data.payload,
      });
      const getReq = new Request("http://localhost/api/upload/evil-id");
      const getRes = await serveGET(getReq as any, {
        params: Promise.resolve({ id: "evil-id" }),
      });
      expect(getRes.headers.get("Content-Type")).toBe("application/octet-stream");
      expect(getRes.headers.get("Content-Disposition")).toContain("attachment");
      expect(getRes.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
  );

  it("rejects a non-SVG file that merely contains the bytes '<svg' inside its first 512 bytes", async () => {
    const padding = "A".repeat(100);
    // Does NOT start with <svg / <?xml / <!doctype svg, and is not a valid
    // PNG/JPEG/GIF/WebP either — just an arbitrary file with "<svg" buried inside it.
    const content = `${padding}<svg>fake</svg>${padding}`;
    const req = buildUploadRequest("not-an-image.bin", "application/octet-stream", content);
    const res = await uploadPOST(req as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(0);
    expect(body.message).toContain("Invalid or corrupted image file format");
    expect(mockUploadedFileCreate).not.toHaveBeenCalled();
  });

  it("still accepts a legitimate, clean SVG with no scripting", async () => {
    const cleanSvg = `<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10" fill="blue"/></svg>`;
    const req = buildUploadRequest("logo.svg", "image/svg+xml", cleanSvg);
    const res = await uploadPOST(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(1);
    expect(mockUploadedFileCreate).toHaveBeenCalledTimes(1);
  });
});

describe("Issue #195 follow-up: filename/mimetype spoofing bypass (cubic + CodeRabbit findings)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUploadedFileCreate.mockImplementation(async ({ data }: any) => ({
      id: "new-id",
      ...data,
    }));
  });

  const maliciousSvgBody = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.domain)"/>`;

  it("cubic bypass: real SVG bytes uploaded as evil.png / image/png must still get safe SVG treatment", async () => {
    const req = buildUploadRequest("evil.png", "image/png", maliciousSvgBody);
    const res = await uploadPOST(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(1);

    // The SVG classification must come from the validated buffer content, not the
    // client-supplied filename/mimetype — so this must be stored exactly like any
    // other detected SVG: forced to a generic, non-renderable content type.
    expect(mockUploadedFileCreate).toHaveBeenCalledTimes(1);
    const createCall = mockUploadedFileCreate.mock.calls[0][0];
    expect(createCall.data.mimeType).toBe("application/octet-stream");

    mockUploadedFileFindUnique.mockResolvedValue({
      id: "evil-id",
      filename: createCall.data.filename,
      mimeType: createCall.data.mimeType,
      payload: createCall.data.payload,
    });
    const getReq = new Request("http://localhost/api/upload/evil-id");
    const getRes = await serveGET(getReq as any, {
      params: Promise.resolve({ id: "evil-id" }),
    });
    expect(getRes.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(getRes.headers.get("Content-Disposition")).toContain("attachment");
  });

  it("CodeRabbit bypass: real SVG bytes uploaded as evil.html / text/html must never be served as text/html", async () => {
    const req = buildUploadRequest("evil.html", "text/html", maliciousSvgBody);
    const res = await uploadPOST(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(1);

    expect(mockUploadedFileCreate).toHaveBeenCalledTimes(1);
    const createCall = mockUploadedFileCreate.mock.calls[0][0];
    expect(createCall.data.mimeType).toBe("application/octet-stream");
    expect(createCall.data.mimeType).not.toMatch(/html/i);

    mockUploadedFileFindUnique.mockResolvedValue({
      id: "evil-id-2",
      filename: createCall.data.filename,
      mimeType: createCall.data.mimeType,
      payload: createCall.data.payload,
    });
    const getReq = new Request("http://localhost/api/upload/evil-id-2");
    const getRes = await serveGET(getReq as any, {
      params: Promise.resolve({ id: "evil-id-2" }),
    });
    expect(getRes.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(getRes.headers.get("Content-Type")).not.toMatch(/html/i);
    expect(getRes.headers.get("Content-Disposition")).toContain("attachment");
  });

  it("CodeRabbit finding: a non-SVG XML document is rejected, not given SVG treatment just for starting with <?xml", async () => {
    const nonSvgXml = `<?xml version="1.0" encoding="UTF-8"?><catalog><book>Not an SVG</book></catalog>`;
    const req = buildUploadRequest("fake.xml", "application/xml", nonSvgXml);
    const res = await uploadPOST(req as any);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(0);
    expect(body.message).toContain("Invalid or corrupted image file format");
    expect(mockUploadedFileCreate).not.toHaveBeenCalled();
  });

  it("S3 redirect bypass: a legacy SVG-labeled S3 object is proxied with safe headers instead of redirected", async () => {
    const fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(
        new Response(maliciousSvgBody, {
          status: 200,
          headers: { "Content-Type": "image/svg+xml" },
        })
      );

    // Simulates a record created before this fix: unsafe metadata already stored on S3.
    mockUploadedFileFindUnique.mockResolvedValue({
      id: "legacy-svg-id",
      filename: "legacy.svg",
      mimeType: "image/svg+xml",
      payload: "https://s3.example.com/collabpro-images/legacy.svg",
    });

    const getReq = new Request("http://localhost/api/upload/legacy-svg-id");
    const getRes = await serveGET(getReq as any, {
      params: Promise.resolve({ id: "legacy-svg-id" }),
    });

    // Must NOT be a redirect straight to the (unsafe) S3 object — the browser would
    // receive S3's own unsafe headers if we redirected.
    expect(getRes.status).not.toBe(302);
    expect(getRes.status).not.toBe(307);
    expect(getRes.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(getRes.headers.get("Content-Disposition")).toContain("attachment");
    expect(getRes.headers.get("X-Content-Type-Options")).toBe("nosniff");

    fetchSpy.mockRestore();
  });
});
