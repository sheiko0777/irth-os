/** @jsxImportSource react */
// See Layout.tsx for why this pragma is needed (apps/api's tsconfig sets
// a conflicting global jsxImportSource).
import * as React from 'react';
import { Heading, Text } from '@react-email/components';
import { EmailLayout } from './Layout';

export interface CampaignEmailProps {
  customerName: string;
  /**
   * Admin-authored campaign copy (campaigns.create's `message` field).
   * Rendered as a plain JSX child, never through dangerouslySetInnerHTML —
   * React escapes it into text content automatically. The raw HTML string
   * this replaces interpolated it straight into an `html` string with no
   * escaping at all, so any markup an admin typed into the campaign message
   * would execute as HTML in every recipient's inbox.
   */
  message: string;
}

export function CampaignEmail({ customerName, message }: CampaignEmailProps) {
  return (
    <EmailLayout>
      <Heading style={heading}>مرحباً {customerName}</Heading>
      <Text style={text}>{message}</Text>
    </EmailLayout>
  );
}

const heading: React.CSSProperties = { color: '#111827', fontSize: 20, margin: '0 0 16px' };
const text: React.CSSProperties = { color: '#374151', fontSize: 15, lineHeight: 1.6, margin: 0 };
