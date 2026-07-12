import { getRedisClient } from './redis-cache';
import { getOctokit } from '@actions/github';

export interface SecurityScanPayload {
  commitSha: string;
  branch: string;
  repository: string;
}

const inMemoryQueue: string[] = [];

/**
 * Enqueues a security scan request into the Redis queue
 */
export async function enqueueSecurityScan(payload: SecurityScanPayload): Promise<void> {
  const queueKey = 'collabpro:queue:security-scans';
  const client = getRedisClient();
  const serialized = JSON.stringify(payload);

  if (client) {
    try {
      await client.rpush(queueKey, serialized);
      console.log(`📥 [Security Queue] Enqueued security audit for commit ${payload.commitSha} on Redis`);
      return;
    } catch (err: any) {
      console.warn('⚠️ Redis queue push failed, falling back to In-Memory Queue: ', err.message);
    }
  }

  inMemoryQueue.push(serialized);
  console.log(`📥 [Security Queue] Enqueued security audit for commit ${payload.commitSha} in memory`);
}

/**
 * Pops and dispatches security scans asynchronously using the GitHub Actions REST API
 */
export async function processSecurityQueue(): Promise<{ dispatchedCount: number }> {
  const queueKey = 'collabpro:queue:security-scans';
  const client = getRedisClient();
  let serializedPayload: string | null = null;

  if (client) {
    try {
      serializedPayload = await client.lpop(queueKey);
    } catch (err: any) {
      console.warn('⚠️ Redis queue pop failed, falling back to In-Memory: ', err.message);
    }
  }

  if (!serializedPayload) {
    serializedPayload = inMemoryQueue.shift() || null;
  }

  if (!serializedPayload) {
    return { dispatchedCount: 0 };
  }

  const payload: SecurityScanPayload = JSON.parse(serializedPayload);

  try {
    const githubToken = process.env.GITHUB_TOKEN || 'dummy-token';
    const octokit = getOctokit(githubToken);

    // Extract owner and repo from repository path (e.g. "manish-9245/collabpro")
    const [owner, repo] = payload.repository.split('/');

    console.log(`📡 [Security Queue] Dispatching async workflow security-scan.yml for commit ${payload.commitSha}...`);

    await octokit.rest.actions.createWorkflowDispatch({
      owner: owner || 'manish-9245',
      repo: repo || 'collabpro',
      workflow_id: 'security-scan.yml',
      ref: payload.branch || 'main',
      inputs: {
        commit_sha: payload.commitSha,
      },
    });

    return { dispatchedCount: 1 };
  } catch (err: any) {
    console.error(`❌ [Security Queue] Failed to dispatch workflow: ${err.message}`);
    return { dispatchedCount: 0 };
  }
}
