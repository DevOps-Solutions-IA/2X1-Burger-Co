# Contribución

Este repositorio es privado. Solo el personal autorizado puede proponer, revisar o desplegar cambios.

## Flujo obligatorio

1. Actualizar `main` local mediante fast-forward.
2. Crear una rama con alcance único.
3. Implementar cambios pequeños y auditables.
4. Ejecutar validaciones locales.
5. Subir la rama y abrir Pull Request.
6. Esperar todos los checks requeridos.
7. Fusionar únicamente con CI en verde.
8. Construir y desplegar desde el SHA exacto de `main`.
9. Verificar alineación local, remota y productiva.

## Convención de ramas

```text
feature/<capacidad>
fix/<incidente>
security/<control>
docs/<alcance>
chore/<mantenimiento>
```

## Convención de commits

```text
feat(scope): descripción
fix(scope): descripción
security(scope): descripción
test(scope): descripción
docs(scope): descripción
chore(scope): descripción
```

## Validaciones mínimas

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm test
bash infra/release/secret-scan.sh
```

Según el alcance también deben ejecutarse E2E efímeros, pruebas de recuperación, validación de migraciones y smoke tests.

## Reglas críticas

- No trabajar directamente en `main`.
- No usar force-push sobre ramas protegidas.
- No subir `.env`, credenciales, claves GPG, dumps o backups.
- No ejecutar `prisma migrate reset`, `prisma db push` ni seeds sobre producción.
- No omitir ni desactivar checks para obtener un merge.
- No crear mutaciones productivas sin auditoría e idempotencia.
- No habilitar capacidades de SOFIA sin autorización de fase.

## Cierre de una fase

Una fase solo se considera terminada cuando:

```text
CI = PASS
PRODUCTION = PASS
ROLLBACK = PASS
LOCAL_MAIN_SHA = ORIGIN_MAIN_SHA = PRODUCTION_SOURCE_SHA
```
