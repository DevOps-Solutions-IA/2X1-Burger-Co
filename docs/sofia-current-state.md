# Sofia - Estado actual

Ultima actualizacion: 2026-07-05.

Este archivo es la fuente de verdad actual para agentes sobre el estado operativo de Sofia en `inventario-fastfood-system`.

## Estado resumido

- Sofia opera en modo supervisado.
- WhatsApp QR: receive-only.
- QR real Baileys: validado.
- CONNECTED fisico: validado condicionado.
- DeepSeek real: dry-run GO.
- SafetyGuard: GO.
- Envio real: bloqueado.
- Auto reply: OFF.
- Produccion: bloqueada.
- Allowlist comercial final: pendiente.
- Envio real interno: diferido al final.
- UI/UX: GO tecnico, pero content cleanup pendiente.
- Security cleanup 4B: GO condicionado por rotacion/aceptacion owner.

## Significado operacional

Sofia puede:

- Recibir y analizar conversaciones en modo supervisado.
- Mostrar sugerencias y decisiones SafetyGuard.
- Ejecutar DeepSeek real solo como generador de candidatos en dry-run backend.
- Separar sandbox de vistas reales.
- Mostrar metricas, estados y bloqueos operativos.

Sofia no puede:

- Enviar WhatsApp real.
- Responder automaticamente.
- Activar Auto Safe productivo.
- Marcar pagos como PAID.
- Crear pagos reales.
- Crear pedidos reales.
- Mover caja, stock, checkout, POS o domicilios.
- Activar produccion.

## Flags esperados

| Flag | Estado esperado |
| --- | --- |
| `WHATSAPP_PROVIDER` | `qr_gateway` |
| `WHATSAPP_MODE` | `receive_only` |
| `WHATSAPP_QR_ALLOW_REAL_SEND` | `false` |
| `SOFIA_AUTO_REPLY_ENABLED` | `false` |
| `SOFIA_AUTO_SAFE_ENABLED` | `false` |
| `SOFIA_PRODUCTION_ENABLED` | `false` |
| `DEEPSEEK_ENABLED` | `true` solo para dry-run backend |
| `SOFIA_AI_PROVIDER` | `deepseek` cuando se valida dry-run |
| `SOFIA_AI_MODE` | `dry_run` |

## Evidencia de fases posteriores a 8A

| Fase | Estado | Nota |
| --- | --- | --- |
| QR truthful state fix 1B | GO | UI/backend ya no muestran exito falso. |
| QR storage/session fix 1C | GO CONDICIONADO | Storage Baileys corregido. |
| QR physical scan 1E | GO CONDICIONADO | QR fisico y CONNECTED validados; allowlist comercial final pendiente. |
| DeepSeek real dry-run 2 | GO | HTTP 200, `mockUsed=false`, dry-run, SENT=0. |
| Global audit cleanup 4 | NO-GO historico | Bloqueado por artefactos sensibles historicos. |
| Security artifacts cleanup 4B | GO CONDICIONADO | Limpieza local; queda condicion de rotacion/aceptacion owner. |
| UI/UX operator console 5 | GO tecnico | Consola operativa premium; content cleanup pendiente. |

## Pendientes antes de preproduccion

| Pendiente | Bloquea preproduccion | Accion requerida |
| --- | --- | --- |
| Allowlist comercial final | Si | Validar numero final sin exponerlo completo. |
| Inbound allowlist comercial | Si | Probar inbound real desde allowlist definitiva. |
| Envio real interno | Si | Ejecutar solo en fase explicita posterior. |
| Kill-switch real | Si | Probar antes de cualquier piloto con envio. |
| Security cleanup 4B condicionado | Si | Cerrar rotacion/aceptacion owner. |
| Content cleanup | No para tecnica, si para operacion final | Revisar copy y contenido visible antes de piloto. |

## Regla Maxy Family

Composicion autorizada:

```text
6 burgers + 1 porcion personal de papitas + 1 Pepsi 1.5 L
```

Upsell permitido:

```text
Si quieres que todos acompanen con papitas, puedes agregar porciones adicionales.
```

Frases prohibidas como copy comercial:

- papas grandes.
- papas familiares.
- papas para todos.
- porcion familiar de papas.
- papitas para todos.
- combo familiar con papas familiares.

## Reportes historicos

Los reportes historicos son evidencia, no fuente de verdad vigente. Si un reporte contradice este archivo, usar este archivo y revisar fases posteriores.
