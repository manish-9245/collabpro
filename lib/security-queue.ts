import { ResilientQueue } from './queue';
import { getOctokit } from '@actions/github';

export interface SecurityScanPayload {
  commitSha: string;
  branch: string;
  repository: string;
}

// Instantiate the resilient queue specifically for security scans
const securityScanQueue = new ResilientQueue<SecurityScanPayload>('collabpro:queue:security-scans');

/**
 * Enqueues a security scan request into the Resilient Queue
 */
export async function enqueueSecurityScan(payload: SecurityScanPayload): Promise<void> {
  await securityScanQueue.enqueue(payload);
}

/**
 * Pops and dispatches security scans asynchronously using the GitHub Actions REST API
 */
export async function processSecurityQueue(): Promise<{ dispatchedCount: number }> {
  let result = { dispatchedCount: 0 };

  const success = await securityScanQueue.process(async (payload) => {
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

      result = { dispatchedCount: 1 };
    } catch (err: any) {
      console.error(`❌ [Security Queue] Failed to dispatch workflow: ${err.message}`);
      result = { dispatchedCount: 0 };
    }
  });

  return success ? result : { dispatchedCount: 0 };
}
