import { ResilientQueue } from './queue';
import { kafkaBroker } from './kafka';

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

// Register Kafka consumer subscription for telemetry tracing and log output
kafkaBroker.subscribe('collabpro-notifications', async (message) => {
  console.log(`📥 [Kafka Subscriber: collabpro-notifications] Consumer group processed event for commit ${message.value.commit} (partition ${message.partition}, offset ${message.offset})`);
});

/**
 * Enqueues a notification payload into the Resilient Queue and publishes to Kafka.
 */
export async function enqueueNotification(payload: NotificationPayload): Promise<void> {
  // Publish to Kafka event-driven system first
  await kafkaBroker.publish('collabpro-notifications', payload, payload.commit);
  
  // Hand off to consumer queue abstraction for test verification & background task processing
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
 * Renders a responsive email template following email design best practices:
 * table-based layout, bulletproof buttons, inline styles, mobile-first
 */
function compileEmailTemplate(payload: NotificationPayload): string {
  const buildSuccess = payload.build.status === 'success';
  const statusColor = buildSuccess ? '#10B981' : '#EF4444';
  const statusBadge = buildSuccess ? 'SUCCESS' : 'FAILED';
  const statusText = buildSuccess ? 'passed all checks' : 'encountered failures';
  const durationMin = (payload.build.durationMs / 60000).toFixed(2);
  const testPct = payload.tests.total > 0 ? ((payload.tests.passed / payload.tests.total) * 100).toFixed(0) : '0';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="light dark">
    <meta name="supported-color-schemes" content="light dark">
    <title>Build ${statusBadge} — ${payload.repository}</title>
    <style>
      @media only screen and (max-width: 480px) {
        .responsive-table { width: 100% !important; }
        .responsive-padding { padding: 16px !important; }
        .responsive-stack { display: block !important; width: 100% !important; }
        .responsive-gap { margin-bottom: 12px !important; }
        .responsive-hide { display: none !important; }
        .responsive-text-center { text-align: center !important; }
        .responsive-fs-14 { font-size: 14px !important; }
      }
      @media (prefers-color-scheme: dark) {
        .dark-bg { background-color: #0A0F1D !important; }
        .dark-card { background-color: #111827 !important; }
        .dark-border { border-color: #1F2937 !important; }
        .dark-text { color: #F3F4F6 !important; }
        .dark-text-muted { color: #9CA3AF !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f3f4f6;">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"><tr><td><![endif]-->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;" class="responsive-table">
            <tr>
              <td style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
                <!-- Hidden preheader -->
                <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
                  Build ${statusBadge} — ${payload.repository}: ${statusText}
                </div>

                <!-- Header -->
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td style="background:linear-gradient(135deg,#1E1B4B,#0F172A);padding:32px;text-align:center;">
                      <h1 style="margin:0;font-size:22px;font-weight:800;color:#6366F1;letter-spacing:-0.5px;">CollabPro Build</h1>
                      <p style="margin:6px 0 0 0;font-size:13px;color:#9CA3AF;">Continuous Integration Report</p>
                    </td>
                  </tr>
                </table>

                <!-- Status badge -->
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td style="padding:24px;text-align:center;border-bottom:1px solid #e5e7eb;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
                        <tr>
                          <td style="background-color:${statusColor}1A;border:1px solid ${statusColor};border-radius:9999px;padding:6px 16px;">
                            <span style="color:${statusColor};font-weight:700;font-size:13px;letter-spacing:0.5px;">BUILD ${statusBadge}</span>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <!-- Build metadata -->
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td style="padding:24px 24px 8px;" class="responsive-padding">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                        <tr>
                          <td style="padding:6px 0;color:#6B7280;font-size:13px;width:35%;">Repository</td>
                          <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;">${payload.repository}</td>
                        </tr>
                        <tr>
                          <td style="padding:6px 0;color:#6B7280;font-size:13px;">Branch</td>
                          <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;font-family:monospace;">${payload.branch}</td>
                        </tr>
                        <tr>
                          <td style="padding:6px 0;color:#6B7280;font-size:13px;">Commit</td>
                          <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;font-family:monospace;">${payload.commit.substring(0, 12)}</td>
                        </tr>
                        <tr>
                          <td style="padding:6px 0;color:#6B7280;font-size:13px;">Author</td>
                          <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;">${payload.author}</td>
                        </tr>
                        <tr>
                          <td style="padding:6px 0;color:#6B7280;font-size:13px;">Duration</td>
                          <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;">${durationMin} min</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <!-- Test results -->
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td style="padding:8px 24px 24px;" class="responsive-padding">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;">
                        <tr>
                          <td style="padding:16px;">
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                              <tr>
                                <td style="font-size:14px;font-weight:700;color:#111827;">Unit & Integration Tests</td>
                                <td align="right" style="font-size:14px;font-weight:700;color:#6366F1;">${payload.tests.passed}/${payload.tests.total} passed</td>
                              </tr>
                            </table>
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:10px;background-color:#E5E7EB;border-radius:9999px;height:8px;">
                              <tr>
                                <td width="${testPct}%" style="background-color:#6366F1;border-radius:9999px;height:8px;line-height:8px;font-size:8px;">&nbsp;</td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <!-- Vulnerability diagnostics -->
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td style="padding:0 24px 24px;" class="responsive-padding">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;">
                        <tr>
                          <td style="padding:16px;">
                            <h3 style="margin:0 0 12px 0;font-size:14px;font-weight:700;color:#111827;">Security Vulnerabilities (Snyk)</h3>
                            <!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><![endif]-->
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                              <tr>
                                <td width="50%" style="vertical-align:top;padding-right:6px;" class="responsive-stack responsive-gap">
                                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#ffffff;border:1px solid #E5E7EB;border-radius:6px;">
                                    <tr>
                                      <td align="center" style="padding:12px;">
                                        <div style="color:#EF4444;font-size:20px;font-weight:800;">${payload.snyk.high}</div>
                                        <div style="color:#6B7280;font-size:11px;font-weight:600;text-transform:uppercase;margin-top:4px;">High</div>
                                      </td>
                                    </tr>
                                  </table>
                                </td>
                                <td width="50%" style="vertical-align:top;padding-left:6px;" class="responsive-stack">
                                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#ffffff;border:1px solid #E5E7EB;border-radius:6px;">
                                    <tr>
                                      <td align="center" style="padding:12px;">
                                        <div style="color:#F59E0B;font-size:20px;font-weight:800;">${payload.snyk.medium}</div>
                                        <div style="color:#6B7280;font-size:11px;font-weight:600;text-transform:uppercase;margin-top:4px;">Medium</div>
                                      </td>
                                    </tr>
                                  </table>
                                </td>
                              </tr>
                            </table>
                            <!--[if mso]></tr></table><![endif]-->
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <!-- Footer -->
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td style="background-color:#F9FAFB;padding:24px;text-align:center;border-top:1px solid #E5E7EB;">
                      <p style="margin:0;font-size:12px;color:#6B7280;line-height:1.5;">
                        This build notification was automatically dispatched from CollabPro CI.<br>
                        Commit ${payload.commit} &middot; ${payload.branch}
                      </p>
                      <p style="margin:12px 0 0 0;font-size:11px;color:#9CA3AF;">
                        <a href="{{unsubscribe_url}}" style="color:#6B7280;text-decoration:underline;">Unsubscribe from build notifications</a>
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
          <!--[if mso]></td></tr></table><![endif]-->
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
