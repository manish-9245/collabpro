import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerSession } from "@/lib/session-auth/server";
import { renderWhiteboardSvg, parseWhiteboardElements, svgMessage } from "@/lib/whiteboard-svg";

export async function GET(request: Request) {
  const session = getServerSession();
  const sessionUser = await session.getUser();
  if (!sessionUser || !sessionUser.email) {
    return new NextResponse(
      svgMessage({ title: "Unauthorized Access", body: "You must be logged in to export this workspace.", tone: "error" }),
      { status: 401, headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store, max-age=0" } }
    );
  }
  const email = sessionUser.email;
  const { searchParams } = new URL(request.url);
  const fileId = searchParams.get("fileId");

  if (!fileId) {
    return new NextResponse(
      svgMessage({ title: "CollabPro Vector Export Error", body: "Missing required 'fileId' query parameter.", footer: "Provide a valid board UUID to load elements." }),
      { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store, max-age=0" } }
    );
  }

  try {
    const file = await prisma.file.findUnique({
      where: { id: fileId }
    });

    if (!file) {
      return new NextResponse(
        svgMessage({ title: "Workspace File Not Found", body: "The requested whiteboard document ID does not exist.", footer: "Check ID or team permissions.", tone: "error" }),
        { status: 404, headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store, max-age=0" } }
      );
    }

    // Authorization check
    let hasAccess = file.createdBy === email;
    if (!hasAccess) {
      const membership = await prisma.teamMember.findFirst({
        where: {
          teamId: file.teamId,
          userEmail: email
        }
      });
      if (membership) {
        hasAccess = true;
      }
    }

    if (!hasAccess) {
      return new NextResponse(
        svgMessage({ title: "Access Forbidden", body: "You do not have permission to view or export this whiteboard.", tone: "error" }),
        { status: 403, headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store, max-age=0" } }
      );
    }

    const elements = parseWhiteboardElements(file.whiteboard);
    const svgContent = renderWhiteboardSvg(elements, file.fileName);

    return new NextResponse(svgContent, {
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=60, s-maxage=60"
      }
    });

  } catch (error: any) {
    console.error("Error generating vector export:", error);
    return new NextResponse(
      svgMessage({ title: "Server Exporter Crash", body: "An exception occurred inside the vector renderer.", footer: error.message || "Unknown execution error", tone: "error" }),
      { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
