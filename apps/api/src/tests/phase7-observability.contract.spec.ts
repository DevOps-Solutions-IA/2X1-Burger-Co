import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Phase 7 observability architecture', () => {
  const root = path.resolve(__dirname, '..');

  it('keeps detailed health metrics behind role guards', () => {
    const controller = readFileSync(path.join(root, 'modules/health/health.controller.ts'), 'utf8');
    for (const route of ["@Get('metrics')", "@Get('observability')"]) {
      const position = controller.indexOf(route);
      expect(position).toBeGreaterThan(0);
      const decorators = controller.slice(Math.max(0, position - 140), position);
      expect(decorators).toContain('@UseGuards(JwtAuthGuard, RolesGuard)');
      expect(decorators).toContain("@Roles('admin', 'supervisor')");
      expect(decorators).not.toContain('@Public()');
    }
  });

  it('uses aggregate-only durable telemetry with no identifier projection', () => {
    const source = readFileSync(path.join(root, 'modules/health/operational-backlog.service.ts'), 'utf8');
    expect(source).toContain('COUNT(*) FILTER');
    expect(source).toContain('SELECT * FROM notification CROSS JOIN webhook CROSS JOIN inbound CROSS JOIN command CROSS JOIN commerce');
    expect(source).not.toMatch(/SELECT\s+(?:id|phone|customer_id|conversation_id|order_ticket_id)/i);
    expect(source).not.toContain('findMany(');
  });
});
