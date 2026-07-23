import { prisma as defaultPrisma } from '@/lib/db';

export class SnykService {
  private prisma: any;

  constructor(prismaClient: any = defaultPrisma) {
    this.prisma = prismaClient;
  }

  async handle(path: string, args: any, _authUserEmail: string | null, _ipAddress: string): Promise<any> {
    let result: any = null;

    switch (path) {
      case 'snyk:getSettings': {
        const { userEmail } = args || {};
        result = await this.prisma.snykSettings.findUnique({
          where: { userId: userEmail },
        });
        break;
      }

      case 'snyk:saveSettings': {
        const { userId, token, orgId } = args || {};
        result = await this.prisma.snykSettings.upsert({
          where: { userId },
          update: { token, orgId },
          create: { userId, token, orgId },
        });
        break;
      }

      case 'snyk:deleteSettings': {
        const { userEmail } = args || {};
        result = await this.prisma.snykSettings.delete({
          where: { userId: userEmail },
        });
        break;
      }

      case 'snyk:getMetrics': {
        const { userEmail } = args || {};
        const settings = await this.prisma.snykSettings.findUnique({
          where: { userId: userEmail },
        });
        if (!settings) {
          throw new Error('Snyk settings not configured');
        }
        result = await this.fetchMetrics(settings.token, settings.orgId);
        break;
      }

      default:
        throw new Error(`Path ${path} not supported in snykService`);
    }

    return result;
  }

  private async fetchMetrics(token: string, orgId: string) {
    const baseUrl = 'https://api.snyk.io/api/v1';

    const projectsRes = await fetch(`${baseUrl}/org/${orgId}/projects`, {
      headers: {
        Authorization: `token ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!projectsRes.ok) {
      const errText = await projectsRes.text();
      throw new Error(`Snyk API error: ${projectsRes.status} ${errText}`);
    }

    const projectsData = await projectsRes.json();
    const projects = projectsData.projects || [];

    let totalCritical = 0;
    let totalHigh = 0;
    let totalMedium = 0;
    let totalLow = 0;

    for (const project of projects) {
      const issuesRes = await fetch(`${baseUrl}/org/${orgId}/project/${project.id}/aggregated-issues`, {
        headers: {
          Authorization: `token ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (issuesRes.ok) {
        const issuesData = await issuesRes.json();
        const issues = issuesData.issues || [];
        for (const issue of issues) {
          const severity = (issue.severity || '').toLowerCase();
          if (severity === 'critical') totalCritical++;
          else if (severity === 'high') totalHigh++;
          else if (severity === 'medium') totalMedium++;
          else if (severity === 'low') totalLow++;
        }
      }
    }

    const securityRating = this.calculateSecurityRating(totalCritical, totalHigh, totalMedium, totalLow);

    return {
      projectCount: projects.length,
      totalCritical,
      totalHigh,
      totalMedium,
      totalLow,
      securityRating,
      projects: projects.map((p: any) => ({
        id: p.id,
        name: p.name,
      })),
    };
  }

  private calculateSecurityRating(critical: number, high: number, medium: number, low: number): string {
    if (critical > 0) return 'F';
    if (high > 5) return 'D';
    if (high > 0) return 'C';
    if (medium > 10) return 'B';
    if (medium > 0 || low > 0) return 'A';
    return 'A+';
  }
}

export async function handleSnykService(path: string, args: any, authUserEmail: string | null, ipAddress: string): Promise<any> {
  const service = new SnykService();
  return service.handle(path, args, authUserEmail, ipAddress);
}
