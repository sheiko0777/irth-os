import { NextRequest, NextResponse } from 'next/server';
import { db, acceptOrgInvite, type AcceptInviteResult } from '@irth/db';
import { verifySession } from '@/lib/auth';

const STATUS_BY_REASON: Record<Extract<AcceptInviteResult, { ok: false }>['reason'], number> = {
  invalid_token: 404,
  expired: 410,
  email_mismatch: 403,
  otp_required: 400,
  otp_invalid: 400,
  otp_expired: 410,
  otp_locked: 429,
};

const MESSAGE_BY_REASON: Record<Extract<AcceptInviteResult, { ok: false }>['reason'], string> = {
  invalid_token: 'دعوة غير صالحة',
  expired: 'انتهت صلاحية الدعوة',
  email_mismatch: 'هذا البريد الإلكتروني لدعوة مختلفة',
  otp_required: 'رمز التأكيد مطلوب',
  otp_invalid: 'رمز التأكيد غير صحيح',
  otp_expired: 'انتهت صلاحية رمز التأكيد — اطلب رمزاً جديداً',
  otp_locked: 'محاولات كثيرة — اطلب رمزاً جديداً',
};

export async function POST(req: NextRequest) {
  const session = await verifySession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const token = typeof body?.token === 'string' ? body.token : null;
  const otpCode = typeof body?.otpCode === 'string' ? body.otpCode : undefined;
  if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 });

  const result = await acceptOrgInvite(db, { token, otpCode, userId: session.user.id, userEmail: session.user.email });

  if (!result.ok) {
    return NextResponse.json(
      { error: MESSAGE_BY_REASON[result.reason], reason: result.reason },
      { status: STATUS_BY_REASON[result.reason] },
    );
  }

  return NextResponse.json({ data: { orgId: result.orgId, role: result.role } });
}
