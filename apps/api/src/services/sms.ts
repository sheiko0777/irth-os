/**
 * SMS delivery adapter. Same pattern as sendWhatsAppTemplate /
 * sendTransactionalEmail in this file: env-configured, fetch-based, throws
 * with the provider's status and body on failure so the outbox worker's
 * catch can record lastError and retry.
 *
 * Twilio-compatible REST shape (POST {base}/Messages.json?…): works with
 * Twilio itself and with any gateway speaking the same dialect (most local
 * Egyptian aggregators expose a Twilio-compatible endpoint). The account
 * SID rides in the path, the token as basic auth — exactly Twilio's scheme.
 */

// Metrics + structured logging — same single-choke-point pattern as the
// senders in integrations.ts.
import { fetchWithTimeout } from '@irth/domain';
import { recordSend, recordProviderFailure } from '../lib/metrics';
import { createLogger } from '../lib/logger';

const log = createLogger({ component: 'providers' });

export interface SendSmsOptions {
  to: string;
  body: string;
}

export async function sendSms(opts: SendSmsOptions): Promise<unknown> {
  const baseUrl = process.env.SMS_BASE_URL;
  const accountSid = process.env.SMS_ACCOUNT_SID;
  const authToken = process.env.SMS_AUTH_TOKEN;
  const from = process.env.SMS_FROM;

  if (!baseUrl || !accountSid || !authToken || !from) {
    throw new Error('Missing SMS environment variables (SMS_BASE_URL, SMS_ACCOUNT_SID, SMS_AUTH_TOKEN, SMS_FROM)');
  }

  // Twilio form-encodes, not JSON-encodes.
  const form = new URLSearchParams({
    To: opts.to,
    From: from,
    Body: opts.body,
  });

  const basic = btoa(`${accountSid}:${authToken}`);

  const response = await fetchWithTimeout(`${baseUrl}/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: form.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    recordProviderFailure('sms', `SMS API error: ${response.status} - ${errorText}`);
    log.error('sms send failed', { status: response.status, toMasked: opts.to.slice(0, 6) + '…' });
    throw new Error(`SMS API error: ${response.status} - ${errorText}`);
  }

  recordSend('sms');
  log.debug('sms sent', {});

  return response.json();
}
