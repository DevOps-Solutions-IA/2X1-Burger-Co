# Engineering Loops

## Master Loop

Coordina el ciclo completo. Recibe una fase y estado global; entrega un modulo reevaluado, evidencia y siguiente prioridad. Tiene exito cuando todos los loops aplicables estan cerrados. Se repite mientras exista un bloqueo o evidencia insuficiente.

## Discovery Loop

- Proposito: identificar alcance, componentes y dependencias.
- Entradas: repositorio, runtime y documentacion vigente.
- Salidas: inventario verificable.
- Exito: superficie relevante identificada sin suposiciones.
- Repeticion: cuando aparece una dependencia no inventariada.

## Audit Loop

- Proposito: contrastar comportamiento esperado y observado.
- Entradas: inventario y evidencia inicial.
- Salidas: hallazgos clasificados.
- Exito: cada hallazgo tiene reproduccion y severidad.
- Repeticion: cuando la causa no es demostrable.

## Architecture Loop

- Proposito: validar limites, contratos y responsabilidades.
- Entradas: hallazgos y mapa de dependencias.
- Salidas: decision de arquitectura y alcance del cambio.
- Exito: solucion coherente, mantenible y sin duplicacion.
- Repeticion: cuando el cambio desplaza el problema a otro modulo.

## Business Rules Loop

- Proposito: formalizar invariantes y estados de negocio.
- Entradas: contratos y reglas verificadas.
- Salidas: criterios deterministas y pruebas requeridas.
- Exito: reglas sin contradicciones ni datos inventados.
- Repeticion: cuando una regla tiene excepciones no resueltas.

## Implementation Loop

- Proposito: aplicar el cambio minimo completo.
- Entradas: causa raiz, arquitectura y criterios.
- Salidas: cambio trazable.
- Exito: implementacion completa dentro del alcance.
- Repeticion: cuando falla una validacion o aparece regresion.

## Validation Loop

- Proposito: verificar fuente, contratos, build, integracion, runtime y UI segun aplique.
- Entradas: implementacion y criterios de exito.
- Salidas: evidencia de PASS o FAIL.
- Exito: todas las capas aplicables pasan.
- Repeticion: ante cualquier fallo o evidencia parcial.

## Regression Loop

- Proposito: demostrar que otros modulos conservan sus invariantes.
- Entradas: cambio validado y mapa de dependencias.
- Salidas: matriz de regresion.
- Exito: dependencias criticas sin regresiones.
- Repeticion: cuando un contrato compartido cambia.

## Performance Loop

- Proposito: medir comportamiento bajo carga y limites operativos.
- Entradas: runtime estable y escenarios medibles.
- Salidas: metricas, limites y cuellos de botella.
- Exito: objetivos definidos y cumplidos.
- Repeticion: cuando la capacidad queda sin demostrar.

## Security Loop

- Proposito: validar acceso, datos, secretos, auditoria y abuso.
- Entradas: superficie final y amenazas aplicables.
- Salidas: controles y evidencia de seguridad.
- Exito: riesgos criticos cerrados o rechazados por gate.
- Repeticion: cuando cambia exposicion, permisos o datos.

## Production Readiness Loop

- Proposito: validar despliegue, observabilidad, recovery y rollback.
- Entradas: modulos validados y artefacto versionado.
- Salidas: decision GO, GO condicionado o NO-GO.
- Exito: release reproducible y operable con riesgos aceptados.
- Repeticion: mientras exista un bloqueador productivo.

## Secuencia

```text
Master Loop
  -> Discovery Loop
  -> Audit Loop
  -> Architecture Loop
  -> Business Rules Loop
  -> Implementation Loop
  -> Validation Loop
  -> Regression Loop
  -> Performance Loop
  -> Security Loop
  -> Production Readiness Loop
  -> Repeat
```
