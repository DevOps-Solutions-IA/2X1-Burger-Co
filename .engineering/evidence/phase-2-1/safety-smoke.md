# Phase 2.1 - Canary Safety Smoke

El smoke final sobre los artefactos por digest termino `PASS`.

| Control | Valor efectivo |
| --- | --- |
| realSendingEnabled | `false` |
| autoReplyEnabled | `false` |
| autoSafeEnabled | `false` |
| productionEnabled | `false` |
| whatsappCanMarkPaid | `false` |
| QR | `DISABLED`, desconectado, adapter no iniciado |
| IA | provider `deepseek`, mode `dry_run`, proveedor externo deshabilitado |
| Health API/DB | `ok` |
| Login web | PASS |
| Caja read-only | PASS |
| Delivery read-only | PASS |

El canary usa PostgreSQL aislado, puertos `4400`, `3401` y `55433`; no comparte DB ni sesiones WhatsApp con el runtime operativo. Evidencia detallada: `/tmp/phase-2-1-release-foundation/final-canary-smoke.json`.
