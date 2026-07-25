/**
 * Durable-write dispatch for the standalone WebSocket gateway (issue found in
 * review round 2, Group 1 — regression against #172).
 *
 * Previously `queueDbWrite` resolved as soon as a message was handed to
 * RabbitMQ, not once the DB write actually completed — so the caller
 * (`runMutation`) reported success to the client before the write was even
 * attempted, and if the queue consumer later failed, the client already
 * believed it had saved. That's a phantom save, exactly what #172 was
 * supposed to eliminate.
 *
 * The authoritative save is now always executed and awaited synchronously —
 * the result/rejection returned here IS the truth the client is told. A
 * configured durability queue is used purely as a secondary, best-effort
 * replay/audit record published AFTER the direct write succeeds; a failure
 * to enqueue it never affects the already-determined result.
 */

export interface DurabilityQueue {
  sendToQueue: (queueName: string, payload: Buffer, options: Record<string, any>) => void;
}

export async function queueDbWrite<T>(
  queue: DurabilityQueue | null,
  queueName: string,
  fileId: string,
  type: 'document' | 'whiteboard' | 'fileName',
  value: string,
  executeSave: () => Promise<T>
): Promise<T> {
  // Authoritative write — awaited. A rejection here propagates straight to
  // the caller and no durability record is published for a write that never
  // happened.
  const result = await executeSave();

  if (queue) {
    try {
      const payload = { fileId, type, value, timestamp: Date.now() };
      queue.sendToQueue(queueName, Buffer.from(JSON.stringify(payload)), { persistent: true });
    } catch (err) {
      console.warn('[RabbitMQ Queue Error] Failed to publish durability record (write already succeeded):', err);
    }
  }

  return result;
}
