/** @jsxImportSource react */
// See Layout.tsx for why this pragma is needed (apps/api's tsconfig sets
// a conflicting global jsxImportSource).
import * as React from 'react';
import { Button, Heading, Section, Text } from '@react-email/components';
import { EmailLayout } from './Layout';

export interface OrgInviteEmailProps {
  orgName: string;
  roleLabel: string;
  joinUrl: string;
  otpCode: string;
}

export function OrgInviteEmail({ orgName, roleLabel, joinUrl, otpCode }: OrgInviteEmailProps) {
  return (
    <EmailLayout>
      <Heading style={heading}>مرحباً</Heading>
      <Text style={text}>
        تمت دعوتك للانضمام إلى <strong>{orgName}</strong> بصفة {roleLabel}.
      </Text>
      <Section style={buttonSection}>
        <Button href={joinUrl} style={button}>
          اضغط هنا لقبول الدعوة
        </Button>
      </Section>
      <Text style={text}>
        رمز التأكيد: <strong style={otpStyle}>{otpCode}</strong>
      </Text>
      <Text style={mutedText}>سيُطلب منك إدخال هذا الرمز عند قبول الدعوة. صالح لمدة ١٥ دقيقة.</Text>
    </EmailLayout>
  );
}

const heading: React.CSSProperties = { color: '#111827', fontSize: 20, margin: '0 0 16px' };
const text: React.CSSProperties = { color: '#374151', fontSize: 15, lineHeight: 1.6, margin: '0 0 16px' };
const mutedText: React.CSSProperties = { color: '#6b7280', fontSize: 13, lineHeight: 1.6, margin: 0 };
const buttonSection: React.CSSProperties = { margin: '0 0 24px', textAlign: 'right' };
const button: React.CSSProperties = {
  backgroundColor: '#111827',
  borderRadius: 6,
  color: '#ffffff',
  fontSize: 15,
  padding: '12px 24px',
  textDecoration: 'none',
};
const otpStyle: React.CSSProperties = { fontSize: 20, letterSpacing: 2 };
