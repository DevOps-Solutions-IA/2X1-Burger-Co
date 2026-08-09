# Release Foundation

La cadena local construye API y web desde un commit mediante `git archive`; nunca usa silenciosamente el working tree. Ambos artifacts reciben el mismo `release-manifest.json`, labels OCI, un SBOM de fuente y un SBOM CycloneDX de cada runtime instalado.

## Build

```bash
export RELEASE_REPRODUCIBILITY_SECRET="$(openssl rand -hex 32)"
RELEASE_OUTPUT_DIR=/tmp/release-artifacts ./infra/release/build-artifacts.sh HEAD
```

El secreto es entropia efimera por release, debe venir del secret store aprobado y compartirse solo entre builds de verificacion del mismo release. No se persiste en artifacts, logs ni metadata. Cada build usa `--no-cache`; el gate compara configuracion y filesystem ejecutable completo, no exige que BuildKit serialice las capas en el mismo orden. Las primeras imagenes exportadas se conservan y verifican por checksum antes de cada carga. El digest publicable de registry se obtiene solo en el futuro push autorizado y no se infiere del image ID local.

## Canary local

```bash
./infra/release/load-artifacts.sh /tmp/release-artifacts/<build-id>/artifact-record.json
./infra/release/canary-deploy.sh /tmp/release-artifacts/<build-id>/artifact-record.json
./infra/release/canary-smoke.sh /tmp/release-artifacts/<build-id>/artifact-record.json
```

El canary usa puertos `4400`/`3401`/`55433`, base `_test`, secretos efímeros y WhatsApp/QR deshabilitados. No comparte DB ni sesión con el runtime operativo.

## Rollback

`rollback-drill.sh` cambia imágenes por content digest, ejecuta smoke después de cada transición y no revierte la base. El staging remoto requiere registry, host, approvals y secret store configurados por el owner; el workflow falla cerrado si falta cualquiera.
