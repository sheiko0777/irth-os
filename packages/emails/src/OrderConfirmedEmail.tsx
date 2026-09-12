import * as React from 'react';
import { Heading, Text } from '@react-email/components';
import { EmailLayout } from './Layout';

export interface OrderConfirmedEmailProps {
  customerName: string;
  orderNumber: string;
}

export function OrderConfirmedEmail({ customerName, orderNumber }: OrderConfirmedEmailProps) {
  return (
    <EmailLayout>
      <Heading style={heading}>مرحباً {customerName}</Heading>
      <Text style={text}>
        تم تأكيد طلبك رقم <strong>{orderNumber}</strong> بنجاح.
      </Text>
    </EmailLayout>
  );
}

const heading: React.CSSProperties = { color: '#111827', fontSize: 20, margin: '0 0 16px' };
const text: React.CSSProperties = { color: '#374151', fontSize: 15, lineHeight: 1.6, margin: 0 };
