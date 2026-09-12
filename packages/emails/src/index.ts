import * as React from 'react';
import { render } from '@react-email/render';
import { OrderConfirmedEmail, type OrderConfirmedEmailProps } from './OrderConfirmedEmail';
import { CampaignEmail, type CampaignEmailProps } from './CampaignEmail';
import { OrgInviteEmail, type OrgInviteEmailProps } from './OrgInviteEmail';

// Wrapped in `async` regardless of whether the installed @react-email/render
// resolves synchronously or returns a Promise (its API has varied across
// 0.0.x releases) -- `return render(...)` inside an async function correctly
// unwraps either shape, so callers never need to know which.

/** Sent for outbox event `order.confirmed`. */
export async function renderOrderConfirmedEmail(props: OrderConfirmedEmailProps): Promise<string> {
  return render(React.createElement(OrderConfirmedEmail, props));
}

/** Sent for outbox event `campaign.recipient.send` (email channel). */
export async function renderCampaignEmail(props: CampaignEmailProps): Promise<string> {
  return render(React.createElement(CampaignEmail, props));
}

/** Sent for outbox event `org.invite.sent`. */
export async function renderOrgInviteEmail(props: OrgInviteEmailProps): Promise<string> {
  return render(React.createElement(OrgInviteEmail, props));
}

export type { OrderConfirmedEmailProps, CampaignEmailProps, OrgInviteEmailProps };
