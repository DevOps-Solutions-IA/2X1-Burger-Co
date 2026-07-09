import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateDeliveryWorkflowDto {
  @IsIn(['PENDING_ASSIGNMENT', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'ISSUE'])
  workflowStatus!: 'PENDING_ASSIGNMENT' | 'ASSIGNED' | 'IN_TRANSIT' | 'DELIVERED' | 'ISSUE';

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsIn([
    'CUSTOMER_UNREACHABLE',
    'INCOMPLETE_ADDRESS',
    'LOCATION_MISMATCH',
    'PAYMENT_PENDING',
    'DELIVERY_REJECTED',
    'ROUTE_INCIDENT',
    'OTHER',
  ])
  issueType?:
    | 'CUSTOMER_UNREACHABLE'
    | 'INCOMPLETE_ADDRESS'
    | 'LOCATION_MISMATCH'
    | 'PAYMENT_PENDING'
    | 'DELIVERY_REJECTED'
    | 'ROUTE_INCIDENT'
    | 'OTHER';
}
