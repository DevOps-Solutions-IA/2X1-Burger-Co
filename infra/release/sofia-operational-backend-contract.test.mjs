import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (...segments) => readFileSync(path.join(root, ...segments), 'utf8');

test('SecureCommand exposes a guarded admin review surface without command creation', () => {
  const controller = read('apps','api','src','modules','secure-command','secure-command-admin.controller.ts');
  const module = read('apps','api','src','modules','secure-command','secure-command.module.ts');
  const port = read('apps','api','src','modules','secure-command','ports','command-repository.port.ts');
  const repository = read('apps','api','src','modules','secure-command','persistence','prisma-command.repository.ts');

  assert.match(controller, /@Controller\('admin\/secure-commands'\)/);
  assert.match(controller, /@Get\(\)/);
  assert.match(controller, /@Get\(':id'\)/);
  assert.match(controller, /@Post\(':id\/approve'\)/);
  assert.match(controller, /@Post\(':id\/reject'\)/);
  assert.match(controller, /@Permissions\('settings\.read'\)/);
  assert.match(controller, /@Permissions\('settings\.update'\)/);
  const executableController = controller.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(executableController, /\.receive\s*\(/);
  assert.doesNotMatch(executableController, /@Post\(\s*['"](?:create|receive)/i);

  assert.match(module, /controllers:\s*\[SecureCommandAdminController\]/);
  assert.match(module, /CommandAdminReadService/);
  assert.match(module, /DeliveryOperationsModule/);

  assert.match(port, /list\(query:\s*CommandListQuery\)/);
  assert.match(port, /listApprovals\(commandId:\s*string\)/);
  assert.match(repository, /async list\(/);
  assert.match(repository, /async listApprovals\(/);
});

test('CRM exposes a paginated campaign listing while send remains separately guarded', () => {
  const dto = read('apps','api','src','modules','sofia','crm','dto','crm.dto.ts');
  const controller = read('apps','api','src','modules','sofia','crm','sofia-crm.controller.ts');
  const service = read('apps','api','src','modules','sofia','crm','sofia-crm.service.ts');
  const repository = read('apps','api','src','modules','sofia','crm','phase8-crm.repository.ts');

  assert.match(dto, /export class ListCrmCampaignsDto/);
  assert.match(controller, /@Get\('campaigns'\)/);
  assert.match(controller, /listCampaigns\(@Query\(\) dto: ListCrmCampaignsDto\)/);
  assert.match(service, /listCampaigns\(dto: ListCrmCampaignsDto\)/);
  assert.match(repository, /listCampaigns\(input:/);

  assert.match(controller, /@Post\('campaigns\/:campaignId\/send'\)/);
  assert.match(controller, /@Permissions\('orders\.update'\)/);
});

test('operational SOFIA backend additions do not weaken runtime safety authority', () => {
  const runtime = read('apps','api','src','modules','sofia','runtime-safety','sofia-runtime-safety.service.ts');
  assert.match(runtime, /policy:\s*'SUPERVISED_PREPRODUCTION'/);
  assert.match(runtime, /WHATSAPP_PAID_FORBIDDEN/);
  assert.match(runtime, /PRODUCTION_DISABLED/);
  assert.match(runtime, /REAL_SEND_DISABLED/);
  assert.match(runtime, /AUTO_REPLY_DISABLED/);
  assert.match(runtime, /AUTO_SAFE_DISABLED/);
});
