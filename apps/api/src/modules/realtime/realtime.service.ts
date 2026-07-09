import { Injectable, MessageEvent } from '@nestjs/common';
import { interval, map, merge, Observable, Subject } from 'rxjs';
import { DeliveryWorkflowStatus, OrderTicketStatus, OrderTicketType, OperationalAlertSeverity, OperationalAlertStatus } from '@prisma/client';

export type OperationalRefreshScope = 'orders' | 'tables' | 'all';

export interface OperationalRefreshEvent {
  type: 'operational.refresh';
  scope: OperationalRefreshScope;
  at: string;
}

export interface OrderUpdatedEvent {
  type: 'order.updated';
  entityId: string;
  orderType: OrderTicketType;
  status: OrderTicketStatus;
  actorId?: string | null;
  at: string;
}

export interface DeliveryLocationReceivedEvent {
  type: 'delivery.location.received';
  entityId: string;
  inboxId: string;
  actorId?: string | null;
  at: string;
}

export interface DeliveryLocationPendingEvent {
  type: 'delivery.location.pending';
  inboxId: string;
  reason: string;
  actorId?: string | null;
  at: string;
}

export interface DeliveryWorkflowUpdatedEvent {
  type: 'delivery.workflow.updated';
  entityId: string;
  workflowStatus: DeliveryWorkflowStatus;
  actorId?: string | null;
  at: string;
}

export interface OperationalAlertUpdatedEvent {
  type: 'operational.alert.updated';
  alertId: string;
  module: string;
  severity: OperationalAlertSeverity;
  status: OperationalAlertStatus;
  entityType?: string | null;
  entityId?: string | null;
  at: string;
}

export type OperationalRealtimePayload =
  | OperationalRefreshEvent
  | OrderUpdatedEvent
  | DeliveryLocationReceivedEvent
  | DeliveryLocationPendingEvent
  | DeliveryWorkflowUpdatedEvent
  | OperationalAlertUpdatedEvent;

@Injectable()
export class RealtimeService {
  private readonly operationalEvents$ = new Subject<OperationalRealtimePayload>();

  createOperationalStream(): Observable<MessageEvent> {
    return merge(
      interval(15000).pipe(
        map(
          () =>
            ({
              type: 'heartbeat',
              data: {
                at: new Date().toISOString(),
              },
            }) satisfies MessageEvent,
        ),
      ),
      this.operationalEvents$.pipe(
        map(
          (event) =>
            ({
              type: 'operational',
              data: event,
            }) satisfies MessageEvent,
        ),
      ),
    );
  }

  publishOperationalRefresh(scope: OperationalRefreshScope = 'all') {
    this.publish({
      type: 'operational.refresh',
      scope,
      at: new Date().toISOString(),
    });
  }

  publishOrderUpdated(input: Omit<OrderUpdatedEvent, 'type' | 'at'>) {
    this.publish({
      type: 'order.updated',
      ...input,
      at: new Date().toISOString(),
    });
  }

  publishDeliveryLocationReceived(input: Omit<DeliveryLocationReceivedEvent, 'type' | 'at'>) {
    this.publish({
      type: 'delivery.location.received',
      ...input,
      at: new Date().toISOString(),
    });
  }

  publishDeliveryLocationPending(input: Omit<DeliveryLocationPendingEvent, 'type' | 'at'>) {
    this.publish({
      type: 'delivery.location.pending',
      ...input,
      at: new Date().toISOString(),
    });
  }

  publishDeliveryWorkflowUpdated(input: Omit<DeliveryWorkflowUpdatedEvent, 'type' | 'at'>) {
    this.publish({
      type: 'delivery.workflow.updated',
      ...input,
      at: new Date().toISOString(),
    });
  }

  publishOperationalAlertUpdated(input: Omit<OperationalAlertUpdatedEvent, 'type' | 'at'>) {
    this.publish({
      type: 'operational.alert.updated',
      ...input,
      at: new Date().toISOString(),
    });
  }

  private publish(event: OperationalRealtimePayload) {
    this.operationalEvents$.next(event);
  }
}
