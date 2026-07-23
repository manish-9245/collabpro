import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/session-auth/server';
import { withErrorHandler } from '@/lib/api-middleware';

async function POST_handler(request: NextRequest) {
  const session = getServerSession();
  const sessionUser = await session.getUser();
  if (!sessionUser?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { orgId, token } = body || {};
  if (!orgId || !token) {
    return NextResponse.json({ error: 'orgId and token are required' }, { status: 400 });
  }

  const baseUrl = 'https://api.snyk.io/api/v1';

  const projectsRes = await fetch(`${baseUrl}/org/${orgId}/projects`, {
    headers: {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!projectsRes.ok) {
    const errText = await projectsRes.text();
    return NextResponse.json(
      { error: `Snyk API error: ${projectsRes.status}`, detail: errText },
      { status: projectsRes.status }
    );
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

  return NextResponse.json({
    projectCount: projects.length,
    totalCritical,
    totalHigh,
    totalMedium,
    totalLow,
    projects: projects.map((p: any) => ({ id: p.id, name: p.name })),
  });
}

export const POST = withErrorHandler(POST_handler);
