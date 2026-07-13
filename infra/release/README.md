# Release Foundation

La cadena local construye API y web desde un commit mediante `git archive`; nunca usa silenciosamente el working tree. Ambos artifacts reciben el mismo `release-manifest.json`, labels OCI y un SBOM CycloneDX generado desde `pnpm-lock.yaml`.

## Build

```bash
RELEASE_OUTPUT_DIR=/tmp/release-artifacts ./infra/release/build-artifacts.sh HEAD
```

## Canary local

```bash
./infra/release/canary-deploy.sh /tmp/release-artifacts/<build-id>/artifact-record.json
./infra/release/canary-smoke.sh /tmp/release-artifacts/<build-id>/artifact-record.json
```

El canary usa puertos `4400`/`3401`/`55433`, base `_test`, secretos efímeros y WhatsApp/QR deshabilitados. No comparte DB ni sesión con el runtime operativo.

## Rollback

`rollback-drill.sh` cambia imágenes por content digest, ejecuta smoke después de cada transición y no revierte la base. El staging remoto requiere registry, host, approvals y secret store configurados por el owner; el workflow falla cerrado si falta cualquiera.
