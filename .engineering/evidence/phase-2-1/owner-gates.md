# Phase 2.1 - Owner Gates

Estos componentes externos no existen o no pudieron verificarse localmente:

- remote Git;
- registry OCI;
- branch protections y required reviewers;
- approvals del environment de staging;
- secret store de staging;
- runner/host con Docker Buildx;
- staging remoto;
- firma de artefactos y attestations remotas.

El workflow de staging valida entradas inmutables y approvals, pero no fue ejecutado contra infraestructura inventada. Estos gates bloquean `Deployment VERDE` y `Production READY`, no la demostracion local/canary.
