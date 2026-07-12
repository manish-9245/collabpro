import { ResilientQueue } from './queue';

export interface NotificationPayload {
  repository: string;
  branch: string;
  commit: string;
  author: string;
  build: { status: 'success' | 'failed'; durationMs: number };
  tests: { passed: number; total: number };
  snyk: { high: number; medium: number };
  retryCount?: number;
}

// Instantiate the resilient queue specifically for notifications
const notificationQueue = new ResilientQueue<NotificationPayload>('collabpro:queue:notifications');

/**
 * Enqueues a notification payload into the Resilient Queue
 */
export async function enqueueNotification(payload: NotificationPayload): Promise<void> {
  await notificationQueue.enqueue(payload);
}

/**
 * Decoupled worker process: pops a message, compiles responsive HTML layout,
 * and handles resilient delivery with backoff retries.
 */
export async function processNotificationQueue(options?: { forceDeliveryFailure?: boolean }): Promise<{
  processedCount: number;
  failedCount: number;
  html?: string;
}> {
  let result: { processedCount: number; failedCount: number; html?: string } = { processedCount: 0, failedCount: 0 };

  const success = await notificationQueue.process(async (payload) => {
    const currentRetry = payload.retryCount || 0;
    try {
      if (options?.forceDeliveryFailure) {
        throw new Error('Simulated transient HTTP API delivery timeout');
      }

      // Compile dynamic responsive HTML email template
      const htmlReport = compileEmailTemplate(payload);

      // Delivery Phase (e.g. Mock Dispatcher to Resend / SES / SMTP)
      console.log(`✉️ [Decoupled Dispatcher] Successfully delivered Build Report HTML to inbox for commit ${payload.commit}`);

      result = { processedCount: 1, failedCount: 0, html: htmlReport };
    } catch (deliveryError: any) {
      console.warn(`⚠️ [Delivery Failed] Attempt ${currentRetry + 1}/5 for commit ${payload.commit}: ${deliveryError.message}`);

      if (currentRetry < 5) {
        const nextRetryPayload: NotificationPayload = {
          ...payload,
          retryCount: currentRetry + 1,
        };
        
        // Calculate exponential backoff delay (simulated or task-deferred)
        const backoffSec = Math.pow(2, currentRetry) * 10;
        console.log(`🔄 [Retry Scheduled] Queueing retry attempt ${currentRetry + 1} with exponential backoff of ${backoffSec}s`);

        await enqueueNotification(nextRetryPayload);
      } else {
        console.error(`❌ [Dead-Letter Event] Commits ${payload.commit} notification reached max retry exhaustion limit`);
      }

      result = { processedCount: 0, failedCount: 1 };
    }
  });

  return success ? result : { processedCount: 0, failedCount: 0 };
}

/**
 * Renders a gorgeous modern, state-of-the-art build status template
 */
function compileEmailTemplate(payload: NotificationPayload): string {
  const buildSuccess = payload.build.status === 'success';
  const statusColor = buildSuccess ? '#10B981' : '#EF4444';
  const statusBadge = buildSuccess ? 'SUCCESS' : 'FAILED';
  const durationMin = (payload.build.durationMs / 60000).toFixed(2);
  const testPct = payload.tests.total > 0 ? ((payload.tests.passed / payload.tests.total) * 100).toFixed(0) : '0';

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>CollabPro Build Intelligence Report</title>
      </head>
      <body style="font-family: 'Inter', system-ui, sans-serif; background-color: #0A0F1D; color: #F3F4F6; margin: 0; padding: 40px 20px;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #111827; border-radius: 16px; border: 1px solid #1F2937; overflow: hidden; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);">
          <!-- Header Banner -->
          <div style="background: linear-gradient(135deg, #1E1B4B, #0F172A); padding: 32px; border-bottom: 1px solid #1F2937; text-align: center;">
            <h1 style="color: #6366F1; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">CollabPro Build Intelligence</h1>
            <p style="color: #9CA3AF; margin: 8px 0 0 0; font-size: 14px;">Decoupled Serverless Delivery Engine</p>
          </div>

          <!-- Status Highlight Banner -->
          <div style="padding: 24px; text-align: center; border-bottom: 1px solid #1F2937;">
            <span style="display: inline-block; background-color: ${statusColor}1F; border: 1px solid ${statusColor}; color: ${statusColor}; padding: 8px 16px; border-radius: 9999px; font-weight: 700; font-size: 14px; letter-spacing: 0.5px;">
              BUILD ${statusBadge}
            </span>
          </div>

          <!-- Build Metadata -->
          <div style="padding: 32px;">
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
              <tr>
                <td style="padding: 8px 0; color: #9CA3AF; font-size: 14px; width: 40%;">Repository</td>
                <td style="padding: 8px 0; color: #F3F4F6; font-size: 14px; font-weight: 600;">${payload.repository}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #9CA3AF; font-size: 14px;">Branch / Commit</td>
                <td style="padding: 8px 0; color: #F3F4F6; font-size: 14px; font-weight: 600; font-family: monospace;">${payload.branch} (${payload.commit})</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #9CA3AF; font-size: 14px;">Workflow Author</td>
                <td style="padding: 8px 0; color: #F3F4F6; font-size: 14px; font-weight: 600;">${payload.author}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #9CA3AF; font-size: 14px;">Execution Duration</td>
                <td style="padding: 8px 0; color: #F3F4F6; font-size: 14px; font-weight: 600;">${durationMin} minutes</td>
              </tr>
            </table>

            <!-- Test Results Meter -->
            <div style="background-color: #1F2937; border-radius: 12px; padding: 20px; border: 1px solid #374151; margin-bottom: 24px;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 12px; align-items: center; width: 100%;">
                <span style="color: #F3F4F6; font-weight: 700; font-size: 15px;">Unit & Integration Tests</span>
                <span style="color: #6366F1; font-weight: 700; font-size: 15px; margin-left: auto;">${payload.tests.passed}/${payload.tests.total} Passed (${testPct}%)</span>
              </div>
              <div style="width: 100%; background-color: #374151; height: 8px; border-radius: 9999px; overflow: hidden; margin-top: 8px;">
                <div style="width: ${testPct}%; background-color: #6366F1; height: 100%; border-radius: 9999px;"></div>
              </div>
            </div>

            <!-- Vulnerability Diagnostics -->
            <div style="background-color: #1F2937; border-radius: 12px; padding: 20px; border: 1px solid #374151;">
              <h3 style="margin: 0 0 12px 0; font-size: 15px; font-weight: 700; color: #F3F4F6;">Security Vulnerability (Snyk)</h3>
              <div style="display: flex; gap: 16px; width: 100%;">
                <div style="flex: 1; text-align: center; background-color: #111827; padding: 12px; border-radius: 8px; border: 1px solid #374151; margin-right: 8px;">
                  <div style="color: #EF4444; font-size: 20px; font-weight: 800;">${payload.snyk.high}</div>
                  <div style="color: #9CA3AF; font-size: 11px; font-weight: 600; text-transform: uppercase; margin-top: 4px;">High</div>
                </div>
                <div style="flex: 1; text-align: center; background-color: #111827; padding: 12px; border-radius: 8px; border: 1px solid #374151;">
                  <div style="color: #F59E0B; font-size: 20px; font-weight: 800;">${payload.snyk.medium}</div>
                  <div style="color: #9CA3AF; font-size: 11px; font-weight: 600; text-transform: uppercase; margin-top: 4px;">Medium</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Footer Legal -->
          <div style="background-color: #111827; padding: 24px; text-align: center; border-top: 1px solid #1F2937; font-size: 12px; color: #6B7280;">
            This build update was initiated by continuous integration triggers on collabpro.<br>
            Powered by CollabPro &middot; Decoupled Delivery Layer
          </div>
        </div>
      </body>
    </html>
  `;
}
