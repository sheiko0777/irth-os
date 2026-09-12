import * as React from 'react';
import { Body, Container, Head, Html, Section, Text } from '@react-email/components';

/**
 * Shared wrapper for every transactional email this platform sends.
 * `dir="rtl"` at the document level — every template here is Arabic, and
 * none of the raw HTML strings this replaces set it, so RTL rendering in
 * mail clients that don't auto-detect direction (several do not) depended
 * on luck. `lang="ar"` for the same reason at the language level.
 */
export function EmailLayout({ children }: { children: React.ReactNode }) {
  return (
    <Html dir="rtl" lang="ar">
      <Head />
      <Body style={body}>
        <Container style={container}>{children}</Container>
        <Section style={footerSection}>
          <Text style={footerText}>هذه رسالة تلقائية، الرجاء عدم الرد عليها.</Text>
        </Section>
      </Body>
    </Html>
  );
}

const body: React.CSSProperties = {
  backgroundColor: '#f3f4f6',
  fontFamily: 'Tahoma, Arial, sans-serif',
  margin: 0,
  padding: '24px 0',
};

const container: React.CSSProperties = {
  backgroundColor: '#ffffff',
  borderRadius: 8,
  margin: '0 auto',
  maxWidth: 480,
  padding: '32px 24px',
  textAlign: 'right',
};

const footerSection: React.CSSProperties = {
  margin: '0 auto',
  maxWidth: 480,
  padding: '16px 24px 0',
  textAlign: 'right',
};

const footerText: React.CSSProperties = {
  color: '#9ca3af',
  fontSize: 12,
  margin: 0,
};
