# AUDIT-7A - Production V2 Pre-Deploy Hardline Report

Fecha: [PHONE_REDACTED]  
Objetivo: descubrir V1, respaldar, validar rollback, preparar V2 y decidir si se puede pasar a AUDIT-7B sin tocar produccion.

## 1. Resumen ejecutivo

Decision: **PRODUCTION V2 PRE-DEPLOY: GO CONDICIONADO**

No se desplego V2, no se cambio DNS y no se reemplazo V1. V1 fue identificada en `2x1burger.co`, servidor `[PHONE_REDACTED]`, ruta `/opt/2x1burger`, Docker Compose activo y PostgreSQL no expuesto publicamente. Se genero backup logico V1, checksum, copia local y restore test en base temporal con resultado PASS.

Condiciones antes de AUDIT-7B:

- Configurar `BACKUP_GPG_RECIPIENT` real para cifrado de backups productivos.
- Investigar healthcheck `unhealthy` de nginx aunque HTTP/HTTPS responden correctamente.
- Generar secretos reales V2 y no reutilizar credenciales dev.
- Ejecutar AUDIT-7B con estrategia Blue/Green o subdominio V2, no reemplazo directo.

## 2. Archivos modificados

| Archivo | Cambio | Riesgo |
|---|---|---|
| `.env` | Admin local alineado a `admin@2x1burger.co`. | Bajo, local/runtime actual. |
| `.github/workflows/ci.yml` | JWT dummy de CI reemplazan placeholders `change-this-*`. | Bajo, solo CI/test. |
| `apps/api/src/config/env.ts` | Removido default debil de `ADMIN_PASSWORD`; admin default email actualizado. | Medio, exige env explicita. |
| `infra/docker/Dockerfile.api` | Imagen runtime copia solo schema/migrations, no `prisma/seed.ts`. | Bajo, reduce superficie runtime. |
| `infra/scripts/load-env.sh` | JWT dummy local de test ya no usa placeholders bloqueados. | Bajo, solo test/e2e. |
| `infra/scripts/sync-beverage-catalog.mjs` | `ADMIN_PASSWORD` ahora es obligatorio, sin default debil. | Bajo, protege sincronizacion. |
| `apps/api/src/tests/helpers/test-data.ts` | Reset de tests protegido por DB `_test` y `TRUNCATE ... CASCADE`. | Bajo, solo tests. |
| `tests/e2e/app.spec.ts` | Login E2E usa `admin@2x1burger.co`. | Bajo, solo tests. |
| `infra/environments/production/v2/.env.production.v2.example` | Propuesta V2 sanitizada creada. | Bajo, sin secretos reales. |

## 3. Descubrimiento de repositorio

| Archivo | Dato encontrado | Uso probable | Sensible | Riesgo | Accion |
|---|---|---|---|---|---|
| `.env` | Variables locales de API, JWT, DB, admin, WhatsApp. | Runtime local. | SI | No debe copiarse a produccion tal cual. | Mantener fuera de logs y generar env V2 real. |
| `.env.example` | Plantilla con valores vacios/comentados. | Bootstrap dev. | NO | Puede causar env invalida si se usa directo. | Usar `.env.production.v2.example` para V2. |
| `docker-compose.yml` | Postgres, api, web, nginx, volumenes. | Stack local. | NO | Credenciales dev `postgres/postgres`. | No usar en produccion sin env fuerte. |
| `infra/scripts/deploy.sh` | Deploy local/selfhosted con backup previo. | Automatizacion. | NO | Puede ejecutar migraciones y restart si se usa. | AUDIT-7B debe usarlo solo tras backup y ventana. |
| `infra/scripts/backup.sh` | `pg_dump` custom, checksum, GPG opcional. | Backup. | NO | GPG opcional permite backups sin cifrar. | En produccion exigir `BACKUP_GPG_RECIPIENT`. |
| `infra/scripts/restore.sh` | Restore validado y safety backup. | Rollback/restore. | NO | Destructivo si `FORCE_RESTORE=true`. | Usar solo con backup verificado. |
| `infra/scripts/sync-beverage-catalog.mjs` | Sincronizacion catalogo protegida por flag. | Catalogo. | SI parcial | Tenia default admin debil. | Corregido: exige password explicito. |
| `infra/nginx/generated/default.conf` | Reverse proxy local. | HTTP local. | NO | Puede diferir de produccion. | Validar config remota en AUDIT-7B. |
| `backups/*.dump` | Backups locales previos. | Recuperacion. | SI datos | Datos sensibles no cifrados localmente. | Proteger permisos/cifrado. |

## 4. Dominio detectado

| Dominio | HTTP | HTTPS | App detectada | Riesgo V1 | Accion recomendada |
|---|---:|---:|---|---|---|
| `2x1burger.co` | 301 a HTTPS | 307 a `/login`; `/login`, `/pos`, `/cash`, `/api/health`, `/waiter/login` responden 200 | Next.js + NestJS detras de nginx | Alto si se reemplaza directo | Usar Blue/Green o subdominio V2. |
| `www.2x1burger.co` | 301 a HTTPS | 307 a `/login` | Misma app | Alto si se cambia upstream sin smoke | Mantener apuntando a V1 hasta corte. |
| `app.2x1burger.co` | Sin A/CNAME | No validado | No existe | Bajo | Candidato para V2 si se crea DNS luego. |
| `panel.2x1burger.co` | Sin A/CNAME | No validado | No existe | Bajo | No tocar en 7A. |
| `api.2x1burger.co` | Sin A/CNAME | No validado | No existe | Bajo | No tocar en 7A. |
| `staging.2x1burger.co` | Sin A/CNAME | No validado | No existe | Bajo | Buen candidato V2 si se aprueba DNS. |
| `v2.2x1burger.co` | Sin A/CNAME | No validado | No existe | Bajo | Buen candidato V2 si se aprueba DNS. |

DNS activo: `2x1burger.co -> [PHONE_REDACTED]`, `www.2x1burger.co -> [PHONE_REDACTED]`.

## 5. Servidor detectado

| Servidor | Usuario | Ruta | Docker | Espacio disco | Estado | Riesgo |
|---|---|---|---|---|---|---|
| `[PHONE_REDACTED]` | `ubuntu` | `/opt/2x1burger` | Docker `29.4.2`, Compose `v5.1.3` | `/dev/root` 58G, 51G libre, 13% usado | Acceso SSH solo lectura OK | Produccion real, no ejecutar cambios sin ventana. |

## 6. Estado V1 en servidor

| Servicio | Imagen | Estado | Puertos | Observacion |
|---|---|---|---|---|
| `2x1burger-postgres-1` | `postgres:16-alpine` | healthy | `5432/tcp` interno, sin publish publico | PASS: PostgreSQL no publico. |
| `2x1burger-api-1` | `inventario-api:latest` | healthy | `4300:3000` publico | API tambien esta expuesta por puerto directo; revisar firewall en hardening. |
| `2x1burger-web-1` | `inventario-web:latest` | healthy | `3301:3001` publico | Web directa expuesta; revisar firewall en hardening. |
| `2x1burger-nginx-1` | `nginx:1.27-alpine` | unhealthy | `80`, `443` publicos | Rutas publicas funcionan, pero healthcheck debe corregirse. |

Volumenes V1:

- `2x1burger_postgres_data`
- `2x1burger_whatsapp_auth`

## 7. Backup V1

| Backup file | Size | Checksum | GPG | Restore test | Estado |
|---|---:|---|---|---|---|
| `/opt/2x1burger/backups/audit7a/audit7a-v1-inventory_fastfood_system-[PHONE_REDACTED].dump` | 1,983,432 bytes | `71191fa5d582bba535da9540d4dc9c5c851a9b930031fe95a64485973ddf364e` | No configurado | PASS, 248 tablas detectadas | PASS condicionado por cifrado |
| `backups/audit7a-production-v1/audit7a-v1-inventory_fastfood_system-[PHONE_REDACTED].dump` | 1.9M | Coincide con remoto | No cifrado | Copia local checksum PASS | PASS condicionado por cifrado |

Comando de restore documentado:

```bash
cd /opt/2x1burger
FORCE_RESTORE=true ./infra/scripts/restore.sh backups/audit7a/audit7a-v1-inventory_fastfood_system-[PHONE_REDACTED].dump
```

Rollback manual equivalente:

```bash
cd /opt/2x1burger
docker compose stop api web nginx
FORCE_RESTORE=true ./infra/scripts/restore.sh backups/audit7a/audit7a-v1-inventory_fastfood_system-[PHONE_REDACTED].dump
docker compose up -d postgres api web nginx
curl -k -I https://2x1burger.co/api/health
curl -k -I https://2x1burger.co/login
```

## 8. Estrategia V2 recomendada

| Estrategia | Ventajas | Riesgos | Requisitos | Recomendacion |
|---|---|---|---|---|
| Subdominio V2 (`v2` o `staging`) | No toca V1; smoke real antes de corte | Requiere DNS adicional | Crear A record, SSL separado | Recomendado si se permite DNS en 7B. |
| Blue/Green mismo servidor | V1 sigue sirviendo; V2 en puertos alternos | Mayor complejidad nginx | Compose V2 aislado, volumen DB temporal o clon, smoke antes de switch | Recomendado principal. |
| Directo controlado | Menos infraestructura | Alto riesgo de downtime | Backup cifrado, rollback probado, ventana | No recomendado para 7B salvo emergencia. |

Recomendacion AUDIT-7B: **Blue/Green con V2 aislado**, smoke completo, luego switch nginx atomico con rollback inmediato.

## 9. Configuracion V2 propuesta

Archivo creado: `infra/environments/production/v2/.env.production.v2.example`

Validaciones:

- `NODE_ENV=production`: PASS
- `NEXT_PUBLIC_API_URL=/api`: PASS
- `ENABLE_HTTPS=true`: PASS
- `COOKIE_SECURE=true`: PASS
- `APP_URL=https://2x1burger.co`: PASS
- `CORS_ORIGIN=https://2x1burger.co`: PASS
- Sin `DevAdmin12345*`: PASS
- Sin `Admin12345*`: PASS
- Sin `postgres/postgres`: PASS
- Sin `localhost:4300`: PASS
- `BACKUP_GPG_RECIPIENT` requerido por plantilla: PASS

## 10. Build V2 local

| Validacion | Resultado |
|---|---|
| `pnpm --filter @inventory-fastfood/web typecheck` | PASS |
| `pnpm --filter @inventory-fastfood/web build` | PASS con warnings ESLint `no-explicit-any` existentes |
| `pnpm --filter @inventory-fastfood/api typecheck` | PASS |
| `pnpm --filter @inventory-fastfood/api build` | PASS |
| `docker build --no-cache ... inventario-web:v2-predeploy` | PASS |
| `docker build --no-cache ... inventario-api:v2-predeploy` | PASS |
| Web bundle sin `localhost:4300` | PASS |
| Web/API runtime sin `DevAdmin12345*`/`Admin12345*` | PASS tras correccion |
| Imagen API sin `prisma/seed.ts` runtime | PASS |
| Backend tests | PASS: 120/120 |
| Playwright discover | PASS: 35 tests |
| Playwright smoke login admin | PASS: 1/1 |

## 11. Riesgo CI/Playwright Prisma

Hallazgo inicial:

- CI usaba `JWT_ACCESS_SECRET=change-this-*` y `JWT_REFRESH_SECRET=change-this-*`.
- El backend bloquea esos placeholders correctamente.
- Esto podia impedir webServer/E2E en CI y confundirse con falla Prisma.

Correcciones:

- `.github/workflows/ci.yml` usa secretos dummy fuertes de test, no placeholders bloqueados.
- `infra/scripts/load-env.sh` usa secretos dummy fuertes para E2E local.
- `tests/e2e/app.spec.ts` usa admin alineado `admin@2x1burger.co`.
- Playwright Chromium fue instalado localmente.

Estado:

- Prisma generate/migrate/seed de test ejecutan por `prepare-test-db.sh`.
- Backend test DB protegida por guard `_test`.
- E2E smoke login admin PASS.

## 12. Plan de rollback

Antes de AUDIT-7B:

1. Confirmar backup cifrado nuevo con `BACKUP_GPG_RECIPIENT`.
2. Confirmar checksum remoto y copia externa.
3. Levantar V2 sin tocar V1.
4. Ejecutar smoke V2 contra `/login`, `/pos`, `/cash`, `/waiter/login`, `/api/health`.
5. Si smoke falla, destruir solo V2 y mantener V1 intacta.
6. Si se hace switch nginx y falla, revertir nginx al upstream V1 y recargar nginx.
7. Si hubo migracion DB y falla, ejecutar restore desde backup verificado.

Rollback nginx Blue/Green:

```bash
cd /opt/2x1burger
cp nginx.conf.v1 nginx.conf
docker compose exec nginx nginx -s reload
curl -k -I https://2x1burger.co/login
curl -k -I https://2x1burger.co/api/health
```

Rollback DB:

```bash
cd /opt/2x1burger
FORCE_RESTORE=true ./infra/scripts/restore.sh backups/audit7a/audit7a-v1-inventory_fastfood_system-[PHONE_REDACTED].dump
```

## 13. Checklist para AUDIT-7B

- Generar secretos reales V2 con `openssl rand -base64 48`.
- Configurar `BACKUP_GPG_RECIPIENT` real y probar backup cifrado.
- Corregir o justificar healthcheck `nginx unhealthy`.
- Cerrar exposicion directa opcional de `4300` y `3301` por firewall si nginx es entrada unica.
- Crear V2 aislado sin tocar `2x1burger.co`.
- Ejecutar migraciones sobre clon o DB V2 segun estrategia aprobada.
- Ejecutar smoke HTTP/HTTPS V2.
- Ejecutar login admin V2 con credencial temporal fuerte.
- Documentar punto exacto de switch y comando exacto de rollback.

## 14. Decision

**PRODUCTION V2 PRE-DEPLOY: GO CONDICIONADO**

PASS:

- V1 identificada.
- Dominio validado.
- HTTPS activo.
- API publica responde.
- Login existe.
- PostgreSQL no esta publicado.
- Backup V1 generado.
- Checksum remoto/local verificado.
- Restore test PASS.
- Build/typecheck web/API PASS.
- Imagenes V2 predeploy construidas.
- Bundle web limpio de `localhost:4300`.
- Defaults debiles removidos del runtime API.
- Backend tests PASS 120/120.
- E2E smoke PASS.

FAIL/Condiciones:

- `BACKUP_GPG_RECIPIENT` productivo no esta configurado en V1.
- nginx V1 aparece `unhealthy` aunque sirve trafico.
- Puertos directos `4300` y `3301` estan publicados; debe revisarse firewall si se exige entrada unica por nginx.

No se autoriza reemplazo directo de V1. AUDIT-7B puede iniciar solo como programa controlado Blue/Green o subdominio V2, con backup cifrado previo y rollback probado.
