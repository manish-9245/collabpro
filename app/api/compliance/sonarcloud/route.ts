import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/session-auth/server';
import { prisma } from '@/lib/db';

export async function POST(request: Request) {
  const session = getServerSession();
  const user = await session.getUser();
  if (!user?.email) {
    return NextResponse.json({ error: 'Unauthorized: valid session required' }, { status: 401 });
  }
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { organization, projectKey, metrics } = body || {};
  if (!organization || !projectKey) {
    return NextResponse.json({ error: 'organization and projectKey are required' }, { status: 400 });
  }
  const settings = await prisma.sonarcloudSettings.findUnique({
    where: { userId: user.email },
  });
  if (!settings?.token) {
    return NextResponse.json({ error: 'SonarCloud token not configured. Save settings first.' }, { status: 400 });
  }
  const metricKeys = metrics || ['alert_status', 'bugs', 'code_smells', 'coverage', 'vulnerabilities'];
  const url = `https://sonarcloud.io/api/measures/component?component=${encodeURIComponent(projectKey)}&metricKeys=${metricKeys.join(',')}`;
  const encoded = Buffer.from(`${settings.token}:`).toString('base64');
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Basic ${encoded}` },
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: `SonarCloud API error: ${response.status} ${response.statusText}` },
        { status: response.status },
      );
    }
    const data = await response.json();
    const measures: Record<string, string> = {};
    if (data.component?.measures) {
      for (const measure of data.component.measures) {
        measures[measure.metric] = measure.value;
      }
    }
    return NextResponse.json({
      qualityGate: measures.alert_status || 'NONE',
      bugs: parseInt(measures.bugs || '0', 10),
      codeSmells: parseInt(measures.code_smells || '0', 10),
      coverage: parseFloat(measures.coverage || '0'),
      vulnerabilities: parseInt(measures.vulnerabilities || '0', 10),
      rawMeasures: measures,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Failed to fetch SonarCloud metrics: ${err.message}` },
      { status: 502 },
    );
  }
}
