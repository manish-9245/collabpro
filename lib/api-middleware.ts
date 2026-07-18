import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";

export type RouteHandler = (
  request: any,
  context?: any
) => Promise<NextResponse> | NextResponse;

export function withErrorHandler(handler: RouteHandler): RouteHandler {
  return async (request: any, context?: any) => {
    const start = Date.now();
    
    // Fallbacks for non-request or mock objects
    const method = request && typeof request.method === "string" ? request.method : "GET";
    const url = request && typeof request.url === "string" ? request.url : "http://localhost/api";
    
    try {
      logger.info(`Incoming request: ${method} ${url}`, { url, method });
      const response = await handler(request, context);
      const duration = Date.now() - start;
      logger.info(`Request completed: ${method} ${url} with status ${response.status}`, {
        url,
        method,
        status: response.status,
        durationMs: duration
      });
      return response;
    } catch (error: any) {
      const duration = Date.now() - start;
      logger.error(`Unhandled exception in route: ${method} ${url}`, error, {
        url,
        method,
        durationMs: duration
      });
      
      return NextResponse.json(
        {
          error: "Internal Server Error",
          message: process.env.NODE_ENV === "production" 
            ? "An unexpected error occurred." 
            : error.message || String(error)
        },
        { status: 500 }
      );
    }
  };
}
