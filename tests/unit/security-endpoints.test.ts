import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as stateSyncPOST } from "@/app/api/state-sync/route";
import { GET as exportGET } from "@/app/api/export/route";
import { POST as uploadPOST } from "@/app/api/upload/route";
import { GET as serveGET } from "@/app/api/upload/[id]/route";

// Mock database prisma
const mockFileFindUnique = vi.fn();
const mockFileUpdate = vi.fn();
const mockFileCreate = vi.fn();
const mockTeamFindUnique = vi.fn();
const mockTeamMemberFindFirst = vi.fn();
const mockUploadedFileFindUnique = vi.fn();
const mockUploadedFileCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    file: {
      findUnique: (...args: any[]) => mockFileFindUnique(...args),
      update: (...args: any[]) => mockFileUpdate(...args),
      create: (...args: any[]) => mockFileCreate(...args),
    },
    team: {
      findUnique: (...args: any[]) => mockTeamFindUnique(...args),
    },
    teamMember: {
      findFirst: (...args: any[]) => mockTeamMemberFindFirst(...args),
    },
    uploadedFile: {
      findUnique: (...args: any[]) => mockUploadedFileFindUnique(...args),
      create: (...args: any[]) => mockUploadedFileCreate(...args),
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

describe("Security Endpoints Protection & TDD Audit (Issue 140 & 148)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. IDOR Access Control (Issue 140)", () => {
    it("should reject state-sync file operations if user is not the creator and not a team member", async () => {
      mockGetUser.mockResolvedValue({ email: "attacker@malicious.com" });
      mockFileFindUnique.mockResolvedValue({
        id: "file-secret-123",
        createdBy: "victim@trusted.com",
        teamId: "team-victim",
      });
      mockTeamMemberFindFirst.mockResolvedValue(null); // Not a member of the victim's team

      const req = new Request("http://localhost/api/state-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "files:updateDocument",
          args: { _id: "file-secret-123", document: "{}" },
        }),
      });

      const res = await stateSyncPOST(req);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain("Forbidden");
    });

    it("should reject whiteboard export if user is not authorized to access the file", async () => {
      mockGetUser.mockResolvedValue({ email: "attacker@malicious.com" });
      mockFileFindUnique.mockResolvedValue({
        id: "file-secret-123",
        createdBy: "victim@trusted.com",
        teamId: "team-victim",
      });
      mockTeamMemberFindFirst.mockResolvedValue(null);

      const req = new Request("http://localhost/api/export?fileId=file-secret-123");
      const res = await exportGET(req);
      expect(res.status).toBe(403);
    });
  });

  describe("2. SVG Generation Stored XSS Mitigation (Issue 148)", () => {
    it("should properly escape attributes like strokeColor and backgroundColor in whiteboard export SVG", async () => {
      mockGetUser.mockResolvedValue({ email: "trusted@collabpro.com" });
      mockFileFindUnique.mockResolvedValue({
        id: "file-123",
        createdBy: "trusted@collabpro.com",
        whiteboard: JSON.stringify([
          {
            type: "rectangle",
            x: 10,
            y: 10,
            width: 100,
            height: 100,
            strokeColor: '"><script>alert(1)</script>',
            backgroundColor: '"><script>alert(2)</script>',
          },
        ]),
      });

      const req = new Request("http://localhost/api/export?fileId=file-123");
      const res = await exportGET(req);
      expect(res.status).toBe(200);
      const svgText = await res.text();
      expect(svgText).not.toContain('stroke=""><script>alert(1)</script>"');
      expect(svgText).not.toContain('fill=""><script>alert(2)</script>"');
      expect(svgText).toContain('stroke="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
      expect(svgText).toContain('fill="&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;"');
    });
  });

  describe("3. SVG Script Block & Restrictive Serving Headers (Issue 148)", () => {
    it("should block SVG image uploads containing script tags", async () => {
      const maliciousSvg = `<svg><rect width="100" height="100"/><script>alert("XSS")</script></svg>`;
      const req = new Request("http://localhost/api/upload", {
        method: "POST",
      });
      req.headers.set("content-type", "multipart/form-data");
      req.formData = async () => {
        const data = new Map();
        data.set("file", {
          name: "malicious.svg",
          type: "image/svg+xml",
          size: maliciousSvg.length,
          arrayBuffer: async () => {
            const buf = new TextEncoder().encode(maliciousSvg);
            return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
          }
        });
        return {
          get: (key: string) => data.get(key),
        } as any;
      };

      const res = await uploadPOST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain("scripts are not allowed");
    });

    it("should serve uploaded SVGs with strict CSP and Content-Disposition attachment headers", async () => {
      mockUploadedFileFindUnique.mockResolvedValue({
        id: "svg-file-id",
        filename: "safe.svg",
        mimeType: "image/svg+xml",
        payload: Buffer.from("<svg></svg>").toString("base64"),
      });

      const req = new Request("http://localhost/api/upload/svg-file-id");
      const res = await serveGET(req, { params: Promise.resolve({ id: "svg-file-id" }) });
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none';");
      expect(res.headers.get("Content-Disposition")).toContain("attachment; filename=\"safe.svg\"");
    });
  });
});
