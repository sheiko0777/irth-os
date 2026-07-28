'use client';

import CreateCustomerDialog from './CreateCustomerDialog';
import CustomerPointsDialog from './CustomerPointsDialog';

type ActionType = 'create' | 'addPoints' | 'redeemPoints';

interface CustomerActionsProps {
  actionType: ActionType;
  customerId?: string;
  customerName?: string;
  currentPoints?: number;
}

export default function CustomerActions({ actionType, customerId, customerName, currentPoints }: CustomerActionsProps) {
  if (actionType === 'create') {
    return <CreateCustomerDialog />;
  }

  // addPoints / redeemPoints action
  // Provide fallback empty string for customerId as required by the new component prop type,
  // although it should always be provided when actionType is points related based on old implementation
  return (
    <CustomerPointsDialog
      customerId={customerId || ''}
      customerName={customerName}
      currentPoints={currentPoints}
    />
  );
}
