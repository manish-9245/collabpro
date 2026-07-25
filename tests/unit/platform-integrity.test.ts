import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('GrahakAI Platform & Database Integrity Security Audit Suite', () => {
  it('should enforce relational referential integrity via @relation directives in prisma/schema.prisma', () => {
    const schemaPath = path.resolve(process.cwd(), 'prisma/schema.prisma');
    const content = fs.readFileSync(schemaPath, 'utf8');

    // Schema must establish real structural relationships rather than letting orphaned records exist
    expect(content).toContain('@relation');

    // 1. File to Team relationship
    expect(content).toMatch(/File\s+{[^}]*team\s+Team\s+@relation\(/);
    // 2. TeamMember to Team relationship
    expect(content).toMatch(/TeamMember\s+{[^}]*team\s+Team\s+@relation\(/);
    // 3. TeamMember to User relationship
    expect(content).toMatch(/TeamMember\s+{[^}]*user\s+User\s+@relation\(/);
    // 4. FileVersion to File relationship
    expect(content).toMatch(/FileVersion\s+{[^}]*file\s+File\s+@relation\(/);
    // 5. FilePresence to File relationship
    expect(content).toMatch(/FilePresence\s+{[^}]*file\s+File\s+@relation\(/);
    // 6. FilePresence to User relationship
    expect(content).toMatch(/FilePresence\s+{[^}]*user\s+User\s+@relation\(/);
    // 7. Invitation to Team relationship
    expect(content).toMatch(/Invitation\s+{[^}]*team\s+Team\s+@relation\(/);
    // 8. Notification to User relationship
    expect(content).toMatch(/Notification\s+{[^}]*user\s+User\s+@relation\(/);
    // 9. SharedLibraryItem to Team relationship
    expect(content).toMatch(/SharedLibraryItem\s+{[^}]*team\s+Team\s+@relation\(/);
    // 10. ApiKey to User relationship
    expect(content).toMatch(/ApiKey\s+{[^}]*user\s+User\s+@relation\(/);
    // 11. SharedLink to File relationship
    expect(content).toMatch(/SharedLink\s+{[^}]*file\s+File\s+@relation\(/);
    // 12. OrgSetting to Team relationship
    expect(content).toMatch(/OrgSetting\s+{[^}]*team\s+Team\s+@relation\(/);
    // 13. AuditLog to Team relationship — optional, because authentication
    // events (login/logout/register) have no team context, so the FK is
    // nullable. This is deliberately stricter than the other 12 checks
    // above: it isolates the AuditLog model block and asserts on all three
    // properties together (nullable scalar FK column, optional relation
    // type, and onDelete: SetNull) so a regression on any one of them — the
    // scalar column becoming required again, the relation losing its `?`,
    // or `onDelete` reverting to Cascade (which would delete audit rows
    // when the audited team is deleted, defeating the point of an audit
    // trail) — fails this test.
    const auditLogBlock = content.match(/model AuditLog \{([^}]*)\}/);
    expect(auditLogBlock).not.toBeNull();
    const auditLogBody = auditLogBlock![1];
    expect(auditLogBody).toMatch(/teamId\s+String\?/);
    expect(auditLogBody).toMatch(/team\s+Team\?\s+@relation\([^)]*onDelete:\s*SetNull/);
  });

  it('should not contain destructive schema push commands in package.json start routine', () => {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const startScript = packageJson.scripts?.start || '';

    expect(startScript).not.toContain('--accept-data-loss');
    expect(startScript).not.toContain('db push');
  });

  it('should eliminate hardcoded secrets from docker-compose.yml', () => {
    const dockerComposePath = path.resolve(process.cwd(), 'docker-compose.yml');
    const content = fs.readFileSync(dockerComposePath, 'utf8');

    expect(content).not.toContain('collabpro_secure_password');
    expect(content).not.toContain('hzqq uzmb ldnl idjl');
    expect(content).toContain('${DB_PASSWORD}');
    expect(content).toContain('${SMTP_PASSWORD}');
  });

  it('should eliminate hardcoded secrets from helm configuration charts', () => {
    const valuesPath = path.resolve(process.cwd(), 'charts/collabpro/values.yaml');
    const content = fs.readFileSync(valuesPath, 'utf8');

    expect(content).not.toContain('collabpro_secure_password');
    expect(content).not.toContain('hzqq uzmb ldnl idjl');
    expect(content).toContain('${DB_PASSWORD}');
    expect(content).toContain('${SMTP_PASSWORD}');
  });
});
