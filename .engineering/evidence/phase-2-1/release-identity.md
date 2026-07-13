# Phase 2.1 - Release Identity

- Commit candidato: `e2bffe97d76ab1a2fe83f2e20b19baa90f0e82a4`.
- Build ID: `0.1.0-e2bffe97d76a-1783925108`.
- Dirty build: `false`.
- API digest: `sha256:049521e5468e1675ba4778b7edb2471b6598a8b6afb732373683e5350157e1cc`.
- Web digest: `sha256:61f4862778f00f864eab10ceda1716ba0c994391da1c9db92b739686e2852fe6`.
- API y web exponen el mismo commit y build ID mediante `/version`.
- Ambas imagenes incluyen labels OCI de revision, fecha, version, titulo, source y descripcion.
- Ambas imagenes ejecutan como usuario `node`.
- El manifest y el SBOM fueron generados desde `git archive` del commit, no desde el working tree.
- Evidencia local detallada: `/tmp/phase-2-1-release-foundation/final-artifact-record.json`, `final-api-version.json`, `final-web-version.json` y `final-version-headers.txt`.

Resultado: `SOURCE = COMMIT = ARTIFACT = RUNTIME` demostrado en canary local aislado.
