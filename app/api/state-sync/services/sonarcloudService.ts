import { prisma } from '@/lib/db';

export async function handleSonarcloudService(path: string, args: any, _authUserEmail: string | null, _ipAddress?: string): Promise<any> {
  switch (path) {
    case 'sonarcloud:getSettings': {
      const { userId } = args || {};
      if (!userId) {
        throw new Error('userId is required');
      }
      let settings = await prisma.sonarcloudSettings.findUnique({
        where: { userId },
      });
      if (!settings) {
        settings = await prisma.sonarcloudSettings.create({
          data: {
            userId,
            organization: '',
            projectKey: '',
            token: '',
          },
        });
      }
      return settings;
    }

    case 'sonarcloud:saveSettings': {
      const { userId, organization, projectKey, token } = args || {};
      if (!userId) {
        throw new Error('userId is required');
      }
      const result = await prisma.sonarcloudSettings.upsert({
        where: { userId },
        update: {
          ...(organization !== undefined ? { organization } : {}),
          ...(projectKey !== undefined ? { projectKey } : {}),
          ...(token !== undefined ? { token } : {}),
        },
        create: {
          userId,
          organization: organization || '',
          projectKey: projectKey || '',
          token: token || '',
        },
      });
      return result;
    }

    case 'sonarcloud:getMetrics': {
      const { organization, projectKey, token, metrics } = args || {};
      if (!organization || !projectKey || !token) {
        throw new Error('organization, projectKey, and token are required');
      }
      const metricKeys = metrics || ['alert_status', 'bugs', 'code_smells', 'coverage', 'vulnerabilities'];
      const url = `https://sonarcloud.io/api/measures/component?component=${encodeURIComponent(projectKey)}&metricKeys=${metricKeys.join(',')}`;
      const encoded = Buffer.from(`${token}:`).toString('base64');
      const response = await fetch(url, {
        headers: { Authorization: `Basic ${encoded}` },
      });
      if (!response.ok) {
        throw new Error(`SonarCloud API error: ${response.status} ${response.statusText}`);
      }
      const data = await response.json();
      const measures: Record<string, string> = {};
      if (data.component?.measures) {
        for (const measure of data.component.measures) {
          measures[measure.metric] = measure.value;
        }
      }
      return {
        qualityGate: measures.alert_status || 'NONE',
        bugs: parseInt(measures.bugs || '0', 10),
        codeSmells: parseInt(measures.code_smells || '0', 10),
        coverage: parseFloat(measures.coverage || '0'),
        vulnerabilities: parseInt(measures.vulnerabilities || '0', 10),
        rawMeasures: measures,
      };
    }

    default:
      throw new Error(`Path ${path} not supported in sonarcloudService`);
  }
}
