import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const crmKeys = [
  'crmPipelines',
  'crmPipelineStages',
  'crmLeads',
  'crmLeadStageHistory',
  'crmTasks',
  'crmNotes',
];
const maxPayloadBytes = 8 * 1024 * 1024;

export function fingerprintCrmPayload(payload, secret) {
  if (!/^[a-f0-9]{64}$/i.test(secret ?? '')) {
    throw new Error('RECOVERY_CRM_INTEGRITY_SECRET must be a 32-byte hexadecimal value');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('CRM integrity payload must be an object');
  }

  return Object.fromEntries(crmKeys.map((key) => {
    if (!Array.isArray(payload[key])) throw new Error(`CRM integrity payload is missing ${key}`);
    const digest = createHmac('sha256', secret).update(JSON.stringify(payload[key])).digest('hex');
    return [key, `hmac-sha256:${digest}`];
  }));
}

async function readPayload() {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > maxPayloadBytes) throw new Error('CRM integrity payload exceeds the bounded recovery limit');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const payload = await readPayload();
  process.stdout.write(`${JSON.stringify(fingerprintCrmPayload(payload, process.env.RECOVERY_CRM_INTEGRITY_SECRET))}\n`);
}
