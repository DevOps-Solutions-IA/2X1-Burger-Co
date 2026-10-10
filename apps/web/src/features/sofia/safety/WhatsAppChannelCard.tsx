'use client';

import Image from 'next/image';
import { LogOut, Plug, Smartphone, Unplug } from 'lucide-react';
import { StatusBadge } from '@/components/sofia';
import { Button } from '@/components/ui/button';
import { useSofiaQrConnect, useSofiaQrDisconnect, useSofiaQrLogout, useSofiaQrStatus } from '@/features/sofia/queries';
import { translateQrBlockerOrWarning } from './labels';

/**
 * Tarjeta "Canal WhatsApp" dentro del centro de control de Seguridad.
 * Reutiliza `useSofiaQrStatus` (el mismo hook ya usado en
 * `/sofia/whatsapp-qr`) y expone las 3 mutaciones reales del QR Gateway
 * (`connect`/`disconnect`/`logout`, protegidas en backend con
 * `settings.update`). Conectar no requiere confirmación (es seguro y
 * reversible); desconectar y cerrar sesión sí, porque cortan la recepción
 * real de mensajes o invalidan la sesión guardada.
 */
export function WhatsAppChannelCard() {
  const statusQuery = useSofiaQrStatus();
  const connect = useSofiaQrConnect();
  const disconnect = useSofiaQrDisconnect();
  const logout = useSofiaQrLogout();

  const status = statusQuery.data;

  function handleConnect() {
    connect.mutate();
  }

  function handleDisconnect() {
    if (
      window.confirm(
        '¿Desconectar el canal de WhatsApp? SOFIA dejará de recibir mensajes por este canal hasta que se vuelva a conectar. La sesión guardada no se invalida.',
      )
    ) {
      disconnect.mutate();
    }
  }

  function handleLogout() {
    if (
      window.confirm(
        '¿Cerrar sesión de WhatsApp? Esto invalida las credenciales guardadas: será necesario escanear un nuevo código QR para volver a conectar.',
      )
    ) {
      logout.mutate();
    }
  }

  const anyError = connect.error ?? disconnect.error ?? logout.error;
  const anyPending = connect.isPending || disconnect.isPending || logout.isPending;
  const adapterLive = status?.adapterReal ?? false;

  return (
    <div className="rounded-[1.1rem] border border-stone-200 bg-stone-50 p-3.5" data-testid="sofia-safety-governance-whatsapp-group">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-bold text-ink">Canal WhatsApp</p>
        {status ? (
          <StatusBadge tone={status.connected ? 'success' : 'blocked'} label={status.connected ? 'Conectado' : 'No conectado'} />
        ) : null}
      </div>

      {status ? (
        <>
          <p className="mt-1.5 text-[11.5px] leading-5 text-stone-600" data-testid="sofia-safety-governance-whatsapp-operator-message">
            {status.operatorMessage}
          </p>
          {status.deviceName ? (
            <p className="mt-1 flex items-center gap-1 text-[11px] text-stone-500">
              <Smartphone className="h-3.5 w-3.5" aria-hidden="true" /> {status.deviceName}
            </p>
          ) : null}

          {status.qrAvailable && status.qrImageDataUrl ? (
            <div className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-dashed border-brand-200 bg-brand-50/60 p-3">
              <Image
                src={status.qrImageDataUrl}
                alt="Código QR de vinculación de WhatsApp"
                width={140}
                height={140}
                unoptimized
                className="rounded-lg"
              />
              <p className="text-center text-[11px] font-medium text-stone-600">Escanea con WhatsApp para vincular.</p>
            </div>
          ) : null}

          {status.blockers.length > 0 || status.warnings.length > 0 ? (
            <ul className="mt-2.5 space-y-1" data-testid="sofia-safety-governance-whatsapp-notices">
              {[...status.blockers, ...status.warnings].map((code) => (
                <li key={code} className="text-[11px] leading-4 text-stone-500">
                  • {translateQrBlockerOrWarning(code)}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={!status || adapterLive || anyPending}
          onClick={handleConnect}
          data-testid="sofia-safety-action-qr-connect"
        >
          <Plug className="h-4 w-4" />
          {connect.isPending ? 'Conectando…' : 'Conectar'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!status || !adapterLive || anyPending}
          onClick={handleDisconnect}
          data-testid="sofia-safety-action-qr-disconnect"
        >
          <Unplug className="h-4 w-4" />
          {disconnect.isPending ? 'Desconectando…' : 'Desconectar'}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!status || status.status === 'LOGGED_OUT' || anyPending}
          onClick={handleLogout}
          data-testid="sofia-safety-action-qr-logout"
        >
          <LogOut className="h-4 w-4" />
          {logout.isPending ? 'Cerrando sesión…' : 'Cerrar sesión'}
        </Button>
      </div>

      {anyError ? (
        <p className="mt-2.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[11.5px] font-semibold text-red-900" role="alert">
          No se pudo completar la acción sobre el canal de WhatsApp. Intenta de nuevo.
        </p>
      ) : null}
    </div>
  );
}
