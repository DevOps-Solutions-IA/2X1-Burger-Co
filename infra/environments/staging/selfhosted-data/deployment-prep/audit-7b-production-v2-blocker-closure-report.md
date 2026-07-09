# AUDIT-7B - Production V2 Blocker Closure + Blue/Green Readiness Hardline

Fecha: [PHONE_REDACTED] / [PHONE_REDACTED]  
Dominio productivo V1: `2x1burger.co`  
IP productiva V1: `[PHONE_REDACTED]`  
Servidor V1: `/opt/2x1burger`  
Decision: **PRODUCTION V2 BLOCKER CLOSURE: GO**

## 1. Resumen ejecutivo

AUDIT-7B cerro los bloqueadores principales detectados en AUDIT-7A sin ejecutar cutover, sin cambiar DNS, sin reemplazar V1 y sin borrar volumenes.

Estado final:

| Area | Resultado | Evidencia | Riesgo residual |
| --- | --- | --- | --- |
| V1 produccion | PASS | `https://2x1burger.co/login` 200, `/api/health` 200 | Puertos directos `3301` y `4300` siguen publicados |
| Backup cifrado | PASS | `.dump.gpg` generado, checksum PASS, restore test PASS | Resguardar llave privada GPG fuera de la maquina local |
| Nginx remoto | PASS | Docker `healthy`, HTTPS y API siguen respondiendo | Ninguno critico |
| Estrategia V2 | PASS | Blue/Green documentado, sin cutover | AUDIT-7C debe desplegar green remoto sin cambiar upstream productivo |
| Secretos V2 | PASS | Secretos reales generados localmente, archivo `chmod 600`, no impresos | Custodia operacional de secretos |
| Build V2 | PASS | Web/API typecheck y build PASS, imagenes `v2-ready` creadas | Warnings no bloqueantes existentes en build web |
| Smoke V2 aislado | PASS | V2 local healthy en `127.0.0.1:3302`, `4301`, `5433` | No desplegado aun en servidor productivo |
| Rollback | PASS | Plan ejecutable creado | Requiere ventana si se toca produccion en AUDIT-7C |

## 2. Estado inicial desde AUDIT-7A

| Elemento | Estado AUDIT-7A | Estado actual | Riesgo | Accion |
| --- | --- | --- | --- | --- |
| Dominio V1 | Detectado en `[PHONE_REDACTED]` | Sigue activo | Bajo | Mantener sin cambios |
| HTTPS V1 | Activo | Activo | Bajo | Mantener |
| Backup V1 | Creado y restore test PASS | Sigue disponible | Bajo | Usar como punto de rollback |
| Nginx V1 | Servia trafico, Docker unhealthy | Corregido a healthy | Cerrado | Healthcheck apuntado al upstream interno |
| GPG backups | Sin recipient real | Recipient configurado y probado | Cerrado | Custodiar llave privada |
| Estrategia deploy | Pendiente | Blue/Green seleccionada | Cerrado | Ejecutar en AUDIT-7C |
| Secretos productivos | Pendientes | Generados y no expuestos | Cerrado | No commitear `.env.production.v2` |

## 3. Estado de BACKUP_GPG_RECIPIENT

Resultado: **PASS**

Se genero una llave GPG dedicada para cifrado de backups. Solo la llave publica fue copiada al servidor y versionada como referencia operativa. La llave privada permanece local y no fue impresa.

Fingerprint usado:

`AC279CC063D34EA46E59D96CC3B71C3A1908DC85`

Archivos relacionados:

| Archivo | Uso | Sensible |
| --- | --- | --- |
| `infra/environments/production/v2/backup-public-key.asc` | Llave publica para importar en servidor | NO |
| `/opt/2x1burger/.env` | Contiene `BACKUP_GPG_RECIPIENT` remoto | SI |
| `/opt/2x1burger/backup-to-s3.sh` | Script remoto endurecido para cifrar antes de subir | NO |

## 4. Resultado de backup cifrado

| Backup | Cifrado | Checksum | Restore test | Estado |
| --- | --- | --- | --- | --- |
| `/opt/2x1burger/backups/backup-inventory_fastfood_system-[PHONE_REDACTED].dump.gpg` | PASS | PASS | PASS | PASS |
| `backups/audit7b-production-v1/backup-inventory_fastfood_system-[PHONE_REDACTED].dump.gpg` | PASS | PASS | PASS | PASS |

Evidencia:

- Tamano cifrado: `1851890` bytes.
- Checksum remoto validado.
- Checksum local validado.
- Dump sin cifrar eliminado del servidor despues de cifrar.
- Desencriptado local temporal validado con `pg_restore --list`.
- Restore test local validado en base temporal con `248` tablas.
- Base temporal y dump desencriptado temporal eliminados despues de la prueba.

## 5. Diagnostico nginx unhealthy

Resultado: **PASS**

Causa exacta:

El healthcheck anterior de nginx ejecutaba:

```sh
wget -qO- http://127.0.0.1/api/health >/dev/null || exit 1
```

Dentro del contenedor nginx, esa ruta devolvia redireccion HTTP a HTTPS y luego fallaba por verificacion TLS contra `localhost`. El trafico externo funcionaba, pero Docker marcaba el contenedor como unhealthy.

Correccion aplicada:

```sh
wget -qO- http://api:3000/health >/dev/null || exit 1
```

Impacto:

- Se recreo solo el contenedor nginx con `docker compose up -d --no-deps nginx`.
- No se cambio DNS.
- No se cambio upstream productivo.
- No se tocaron volumenes.
- No se reiniciaron API, web ni PostgreSQL.

Estado posterior:

| Servicio | Estado |
| --- | --- |
| `2x1burger-nginx-1` | healthy |
| `2x1burger-api-1` | healthy |
| `2x1burger-web-1` | healthy |
| `2x1burger-postgres-1` | healthy |

Smoke posterior:

| Ruta | Estado |
| --- | --- |
| `https://2x1burger.co/login` | 200 |
| `https://2x1burger.co/api/health` | 200 |
| `https://2x1burger.co/pos` | 200 |
| `https://2x1burger.co/cash` | 200 |
| `https://2x1burger.co/waiter/login` | 200 |

## 6. Estrategia V2 seleccionada

Estrategia recomendada: **Blue/Green en el mismo servidor**

Deploy directo queda descartado para V2 porque no ofrece suficiente margen de rollback.

| Opcion | Decision | Motivo |
| --- | --- | --- |
| Subdominio V2 | PASS tecnico, no seleccionado como principal | Requiere DNS/cert adicional |
| Blue/Green | PASS seleccionado | Permite smoke test antes de cambiar trafico |
| Deploy directo | FAIL | Riesgo innecesario sobre V1 |

Diseno propuesto:

| Componente | V1 actual | V2 green propuesta |
| --- | --- | --- |
| Web | `3301 -> 3001` | `127.0.0.1:3302 -> 3001` |
| API | `4300 -> 3000` | `127.0.0.1:4301 -> 3000` |
| PostgreSQL | Interno `5432` | `127.0.0.1:5433 -> 5432` |
| Compose project | `2x1burger` | `2x1burger-v2` |
| DB volume | V1 actual | `postgres_v2_data` |
| WhatsApp/auth volume | V1 actual | `whatsapp_v2_auth` |

Archivos preparados:

- `infra/environments/production/v2/docker-compose.v2.yml`
- `infra/environments/production/v2/nginx-blue-green-upstream-notes.conf`

## 7. Secretos productivos V2

Resultado: **PASS**

Se generaron secretos productivos reales para V2 y no se imprimieron completos en el reporte.

Archivos:

| Archivo | Uso | Estado |
| --- | --- | --- |
| `infra/environments/production/v2/.env.production.v2` | Env real local, no versionable | `chmod 600` |
| `infra/environments/production/v2/.env.production.v2.template` | Plantilla redacted | Creada |
| `infra/environments/production/v2/.env.production.v2.example` | Ejemplo seguro | Actualizado |
| `infra/environments/production/v2/README-secrets.md` | Instrucciones de custodia | Creado |

Validaciones:

- `NODE_ENV=production`: PASS
- `COOKIE_SECURE=true`: PASS
- `ENABLE_HTTPS=true`: PASS
- JWT access y refresh distintos: PASS
- Password admin temporal fuerte: PASS
- Sin `DevAdmin12345*`: PASS
- Sin `Admin12345*`: PASS
- Sin `postgres/postgres`: PASS

Incidente corregido:

Durante una ejecucion inicial de seed, el script imprimia credenciales generadas. Se corrigio `prisma/seed.ts` para redactar passwords y codigos de acceso, luego se rotaron los secretos V2 y se repitio seed con salida redacted.

## 8. Build V2

Resultado: **PASS**

| Comando | Resultado |
| --- | --- |
| `pnpm --filter @inventory-fastfood/web typecheck` | PASS |
| `pnpm --filter @inventory-fastfood/web build` | PASS |
| `pnpm --filter @inventory-fastfood/api typecheck` | PASS |
| `pnpm --filter @inventory-fastfood/api build` | PASS |
| Docker web `inventario-web:v2-ready` | PASS |
| Docker API `inventario-api:v2-ready` | PASS |

Validacion de bundle/imagenes:

| Busqueda | Resultado |
| --- | --- |
| `localhost:4300` en `.next` | 0 ocurrencias |
| `DevAdmin12345` en `.next` / `dist` | 0 ocurrencias |
| `Admin12345` en `.next` / `dist` | 0 ocurrencias |
| Secretos dev en imagen web/API | 0 ocurrencias |

## 9. Smoke test sin cutover

Resultado: **PASS**

V2 fue levantada localmente aislada, sin tocar V1 productiva.

| Servicio V2 local | Estado |
| --- | --- |
| `2x1burger-v2-postgres-v2-1` | healthy |
| `2x1burger-v2-api-v2-1` | healthy |
| `2x1burger-v2-web-v2-1` | healthy |

Puertos V2 locales:

- Web: `127.0.0.1:3302`
- API: `127.0.0.1:4301`
- PostgreSQL: `127.0.0.1:5433`

Endpoints API validados:

| Endpoint | Estado |
| --- | --- |
| `/auth/login` | PASS |
| `/health` | PASS |
| `/cash-register/current` | PASS |
| `/reports/operational` | PASS |
| `/sales` | PASS |
| `/products` | PASS |
| `/inventory/stock` | PASS |
| `/users` | PASS |

Rutas web validadas:

| Ruta | Estado |
| --- | --- |
| `/login` | PASS |
| `/pos` | PASS |
| `/cash` | PASS |
| `/waiter/login` | PASS |

## 10. Rollback plan

Resultado: **PASS**

Plan ejecutable creado:

`infra/environments/staging/selfhosted-data/deployment-prep/audit-7b-rollback-plan.md`

Incluye:

- Restaurar nginx V1.
- Volver al upstream V1.
- Detener V2.
- Restaurar DB desde backup V1.
- Rutas exactas del backup V1 AUDIT-7A.
- Rutas exactas del backup cifrado AUDIT-7B.
- Comandos de restore.
- Riesgos.
- Senales que activan rollback.

## 11. Riesgos residuales

| Riesgo | Severidad | Accion recomendada |
| --- | --- | --- |
| V1 expone puertos directos `3301` y `4300` publicamente | Media | En AUDIT-7C/7D cerrar puertos directos y dejar solo nginx 80/443 |
| V2 aun no esta desplegada en servidor remoto | Media | AUDIT-7C debe desplegar green remoto sin cambiar trafico |
| Llave privada GPG esta solo local | Media | Guardar copia offline/segura antes de depender operativamente |
| Backups historicos sin cifrar siguen existiendo | Media | Definir politica de retencion/migracion antes de borrar |
| Build web mantiene warnings existentes no bloqueantes | Baja | Corregir en hardening frontend posterior |

## 12. Decision

**PRODUCTION V2 BLOCKER CLOSURE: GO**

Justificacion:

- Backup V1 valido y backup cifrado AUDIT-7B probado.
- Restore test PASS.
- GPG real configurado.
- Nginx remoto ya esta healthy con causa identificada y corregida.
- V1 continua intacta.
- Estrategia Blue/Green definida.
- Secretos productivos V2 generados y protegidos.
- V2 build lista.
- V2 smoke aislado PASS.
- Rollback ejecutable documentado.

Este GO no autoriza cutover. Autoriza avanzar a AUDIT-7C para desplegar green remoto sin cambiar DNS ni upstream productivo.

## 13. Checklist para AUDIT-7C

1. Copiar artefactos V2 al servidor bajo ruta separada, por ejemplo `/opt/2x1burger-v2`.
2. Copiar `.env.production.v2` por canal seguro y permisos `600`.
3. Levantar V2 green remoto con `docker compose -p 2x1burger-v2` usando puertos alternos.
4. Ejecutar migraciones sobre DB V2 separada.
5. Ejecutar seed productivo controlado si corresponde.
6. Ejecutar smoke remoto contra `127.0.0.1:3302` y `127.0.0.1:4301`.
7. Confirmar V1 sigue intacta en `https://2x1burger.co`.
8. Preparar nginx upstream green, sin activarlo.
9. Validar rollback antes de cutover.
10. Solicitar fase de cutover controlado solo despues de smoke green remoto PASS.
