export type SofiaWhatsappQrConnectionStatus =
  | 'DISABLED'
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'WAITING_QR'
  | 'QR_READY'
  | 'CONNECTED'
  | 'RECONNECTING'
  | 'FAILED'
  | 'LOGGED_OUT';

export type SofiaWhatsappQrMode = 'disabled' | 'receive_only' | 'supervised' | 'auto_safe';

export type SofiaWhatsappQrStatusResponse = {
  provider: 'qr_gateway';
  mode: SofiaWhatsappQrMode;
  status: SofiaWhatsappQrConnectionStatus;
  ok: boolean;
  connected: boolean;
  adapterReal: boolean;
  phoneNumber: string | null;
  deviceName: string | null;
  qrAvailable: boolean;
  qrImageDataUrl: string | null;
  qrString: string | null;
  qrIssuedAt: string | null;
  qrExpiresAt: string | null;
  lastQrAt: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastError: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastConnectionUpdateAt: string | null;
  sessionName: string;
  sessionPathSanitized: string;
  storageWritable: boolean;
  sessionStorageReady: boolean;
  inboundToday: number;
  outboundToday: number;
  pendingOutbound: number;
  realSendingEnabled: false;
  autoReplyEnabled: false;
  deepSeekEnabled: false;
  productionBlocked: boolean;
  blockers: string[];
  warnings: string[];
  reason: string | null;
  operatorMessage: string;
  updatedAt: string;
};

export type SofiaWhatsappQrInboundEvent = {
  externalMessageId: string;
  phone: string;
  fromMe: boolean;
  timestamp: string | null;
  messageType: 'TEXT' | 'IMAGE' | 'AUDIO' | 'INTERACTIVE' | 'SYSTEM';
  text: string | null;
  mediaInfo: { url?: string; mimeType?: string } | null;
  rawSummaryJson: Record<string, unknown>;
  receivedAt: string;
};
