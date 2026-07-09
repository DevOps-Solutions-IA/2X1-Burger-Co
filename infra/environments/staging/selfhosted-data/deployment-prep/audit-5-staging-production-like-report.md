# AUDIT-5: STAGING PRODUCTION-LIKE DEPLOYMENT GATE

**Date:** 2026-05-16
**Environment:** WSL2 Local Development (not real staging server)

## DISCLAIMER

Este entorno es WSL2 local. No existe un dominio real, IP pública, ni certificado SSL válido. Las validaciones de staging real (HTTPS, certificados, HSTS, dominio externo) están BLOQUEADAS hasta que exista un servidor staging con dominio configurable.

---

## FASE 1: INVENTARIO DE ENTORNO

| Elemento | Valor | Estado |
|----------|-------|--------|
| Git | Sin repo (WSL2 shared) | ⚠️ |
| Docker API | inventario-api:latest, 0.0.0.0:4300→3000 | ✅ |
| Docker Web | inventario-web:latest (SHA 72bb9c8c), 0.0.0.0:3301→3001 | ✅ |
| Docker Nginx | nginx:1.27-alpine, 0.0.0.0:80, 0.0.0.0:443 | ✅ |
| Docker Postgres | postgres:16-alpine, 127.0.0.1:5432→5432 | ✅ |
| Volumes | postgres_data, whatsapp_auth | ✅ |
| Red | inventario_default (bridge) | ✅ |

---

## FASE 2: VARIABLES DE ENTORNO

| Variable | Valor | Staging requerido | Estado |
|----------|-------|-------------------|--------|
| NODE_ENV | development | production | ❌ BLOQUEA |
| NEXT_PUBLIC_API_URL | /api | /api | ✅ |
| COOKIE_SECURE | NO SET | true | ❌ BLOQUEA |
| ENABLE_HTTPS | false | true | ❌ BLOQUEA |
| DOMAIN | (vacío) | dominio-staging-real | ❌ BLOQUEA |
| JWT_ACCESS_SECRET | 47 chars, no placeholder | ≥32 chars, criptográfico | ⚠️ DEV |
| JWT_REFRESH_SECRET | 48 chars, distinto | ≥32 chars, criptográfico | ⚠️ DEV |
| DATABASE_URL | postgresql://postgres:postgres@... | Credenciales fuertes | ⚠️ DEV |
| BACKUP_GPG_RECIPIENT | NO SET | email/ID GPG | ❌ BLOQUEA |
| CORS_ORIGIN | http://localhost:3001 | https://dominio-staging | ⚠️ DEV |
| ADMIN_PASSWORD | DevAdmin12345* | ≥18 chars, temporal | ❌ BLOQUEA |

---

## FASE 3-11: VERIFICACIONES LOCALES (PASS)

| Verificación | Resultado | Estado |
|-------------|-----------|--------|
| Docker no-root (api, web) | node / node | ✅ PASS |
| PostgreSQL binding | 127.0.0.1:5432 | ✅ PASS |
| CSP headers | Presente | ✅ PASS |
| Bundle localhost:4300 | 0 ocurrencias | ✅ PASS |
| Bundle DevAdmin12345* | 0 ocurrencias | ✅ PASS |
| Build web | PASS | ✅ PASS |
| Build api | PASS | ✅ PASS |
| Typecheck web | PASS | ✅ PASS |
| Typecheck api | PASS | ✅ PASS |
| Backup generado | .dump + .sha256 | ✅ PASS |
| Backup cifrado | NO (sin GPG key) | ⚠️ DEV |
| 9 endpoints críticos (admin) | Todos HTTP 200 | ✅ PASS |
| RBAC (4 roles) | Correcto | ✅ PASS |
| Login rate limit | 429/503 correcto | ✅ PASS |
| Operational rate limit | Sin 503 en carga normal | ✅ PASS |
| /cash sin banner rojo | Playwright confirmado | ✅ PASS |
| Screenshots | 13 generados | ✅ PASS |
| Migraciones | Al día | ✅ PASS |

---

## CHECKLIST DE STAGING REAL (BLOQUEADO)

Para desbloquear staging, se requiere:

```
□ 1. Servidor Ubuntu/Debian con IP pública o VPS
□ 2. Dominio real: ej. staging.2x1burger.co
□ 3. DNS apuntando al servidor
□ 4. Generar JWT_ACCESS_SECRET:  openssl rand -base64 48
□ 5. Generar JWT_REFRESH_SECRET: openssl rand -base64 48
□ 6. Cambiar contraseñas PostgreSQL
□ 7. Crear admin staging con email real y contraseña temporal ≥18 chars
□ 8. Configurar BACKUP_GPG_RECIPIENT
□ 9. Configurar .env staging:
       NODE_ENV=production
       COOKIE_SECURE=true
       ENABLE_HTTPS=true
       DOMAIN=staging.2x1burger.co
       SSL_EMAIL=ops@2x1burger.co
       CORS_ORIGIN=https://staging.2x1burger.co
       APP_URL=https://staging.2x1burger.co
□ 10. Ejecutar provision-https.sh
□ 11. Ejecutar render-nginx-conf.sh
□ 12. docker compose build --no-cache
□ 13. docker compose up -d
□ 14. Validar HTTPS con curl https://staging.2x1burger.co/api/health
□ 15. Login admin staging por HTTPS
□ 16. Playwright smoke test contra HTTPS
□ 17. Backup cifrado + restore de prueba
□ 18. Validar rate limits en staging
```

---

## DECISIÓN

### STAGING PRODUCTION-LIKE: BLOQUEADO

**Razón:** El entorno actual es WSL2 local sin dominio, IP pública, ni certificados SSL. Staging real requiere:
1. Servidor con dominio (VPS o bare metal con IP pública)
2. Certificados SSL (Let's Encrypt)
3. Rotación de secretos (JWT, PostgreSQL, admin)
4. Configuración de producción (NODE_ENV, COOKIE_SECURE, ENABLE_HTTPS)

**Lo que SÍ está listo:**
- Código, build, typecheck, Dockerfiles, nginx templates, rate limiting, RBAC, backups, migraciones
- El sistema compila, despliega y opera correctamente en entorno local
- Todas las validaciones funcionales pasan
- La configuración de staging es declarativa (solo requiere valores de entorno)
