import { describe, expect, it } from 'vitest';
import { renderOrgInviteEmail } from '../index';

describe('renderOrgInviteEmail', () => {
  it('renders the org name, role label, join link, and OTP code', async () => {
    const html = await renderOrgInviteEmail({
      orgName: 'IRTH Group',
      roleLabel: 'عضو',
      joinUrl: 'https://app.irth-house.com/en/join?token=tok',
      otpCode: '482913',
    });

    expect(html).toContain('IRTH Group');
    expect(html).toContain('عضو');
    expect(html).toContain('https://app.irth-house.com/en/join?token=tok');
    expect(html).toContain('482913');
  });
});
