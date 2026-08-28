'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signUp, signIn } from '@/lib/auth-client';

interface Props {
  token: string;
  email: string;
  orgName: string;
  locale: string;
}

export default function JoinClient({ token, email, orgName, locale }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<'signup' | 'signin' | 'otp'>('signup');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  async function acceptInvite(code?: string) {
    const res = await fetch('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, otpCode: code }),
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error ?? 'فشل قبول الدعوة') as Error & { reason?: string };
      err.reason = data.reason;
      throw err;
    }
    return data;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (mode === 'signup') {
      if (!name.trim()) return setError('الاسم مطلوب');
      if (password.length < 8) return setError('كلمة المرور ٨ أحرف على الأقل');
      if (password !== confirm) return setError('كلمتا المرور غير متطابقتين');
    } else {
      if (!password) return setError('كلمة المرور مطلوبة');
    }

    setLoading(true);
    try {
      if (mode === 'signup') {
        const result = await signUp.email({ email, password, name: name.trim() });
        if (result.error) {
          if (result.error.message?.toLowerCase().includes('exist') || result.error.status === 422) {
            setMode('signin');
            setError('هذا البريد الإلكتروني مسجّل بالفعل — سجّل دخولك أدناه');
            setLoading(false);
            return;
          }
          throw new Error(result.error.message ?? 'فشل إنشاء الحساب');
        }
      } else {
        const result = await signIn.email({ email, password });
        if (result.error) throw new Error(result.error.message ?? 'بيانات الدخول غير صحيحة');
      }

      // Try accepting without an OTP first — a pre-migration invite has none
      // and completes immediately; a real invite comes back otp_required,
      // which is when the code-entry step actually appears.
      try {
        await acceptInvite();
        router.push(`/${locale}`);
      } catch (err) {
        const reason = (err as { reason?: string }).reason;
        if (reason === 'otp_required') {
          setMode('otp');
          setLoading(false);
          return;
        }
        throw err;
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
      setLoading(false);
    }
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!/^\d{6}$/.test(otpCode)) return setError('أدخل الرمز المكوّن من ٦ أرقام');

    setLoading(true);
    try {
      await acceptInvite(otpCode);
      router.push(`/${locale}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
      setLoading(false);
    }
  }

  async function handleResend() {
    setResending(true);
    setError('');
    try {
      const res = await fetch('/api/join/resend-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'تعذّر إعادة إرسال الرمز');
      setOtpCode('');
      setResent(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'حدث خطأ غير متوقع');
    } finally {
      setResending(false);
    }
  }

  return (
    <div
      className="w-full max-w-sm"
    >
      <div className="rounded-xl border p-8 space-y-6" style={{ borderColor: 'var(--rim1)', background: 'var(--surface)' }}>
        {/* Header */}
        <div className="text-center space-y-1">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl mx-auto mb-4" style={{ background: 'var(--gold-bg)', border: '1px solid var(--gold-br)' }}>
            <span className="text-2xl font-bold leading-none" style={{ color: 'var(--gold)' }}>إ</span>
          </div>
          <h1 className="text-lg font-bold" style={{ color: 'var(--t1)' }}>
            مرحباً بك في {orgName}
          </h1>
          <p className="text-sm" style={{ color: 'var(--t3)' }}>
            {mode === 'signup' ? 'أنشئ حسابك للبدء' : mode === 'signin' ? 'سجّل دخولك لقبول الدعوة' : 'أدخل رمز التأكيد المرسل إلى بريدك'}
          </p>
        </div>

        {/* Invited email badge */}
        <div className="rounded-lg px-3 py-2 text-sm text-center" style={{ background: 'var(--gold-bg)', color: 'var(--gold)' }}>
          {email}
        </div>

        {error && (
          <p className="text-sm px-3 py-2 rounded-md" style={{ background: 'var(--rim1)', color: 'var(--crimson)' }}>
            {error}
          </p>
        )}

        {mode === 'otp' ? (
          <form onSubmit={handleOtpSubmit} className="space-y-4">
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--t3)' }}>رمز التأكيد</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otpCode}
                onChange={(e: { target: { value: string } }) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                placeholder="——————"
                required
                dir="ltr"
                className="w-full text-center text-lg tracking-[0.5em] rounded-lg border px-4 py-2.5 outline-none"
                style={{ borderColor: 'var(--rim2)', background: 'transparent', color: 'var(--t1)' }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg text-sm font-bold transition-opacity"
              style={{ background: 'var(--gold)', color: 'var(--void)', opacity: loading ? 0.6 : 1 }}
            >
              {loading ? 'جارٍ التحقق...' : 'تأكيد'}
            </button>

            <p className="text-center text-xs" style={{ color: 'var(--t3)' }}>
              {resent ? (
                <span style={{ color: 'var(--emerald)' }}>تم إرسال رمز جديد إلى بريدك</span>
              ) : (
                <>
                  لم يصلك الرمز؟{' '}
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resending}
                    className="underline"
                    style={{ color: 'var(--gold)' }}
                  >
                    {resending ? 'جارٍ الإرسال...' : 'إعادة الإرسال'}
                  </button>
                </>
              )}
            </p>
          </form>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--t3)' }}>الاسم الكامل</label>
              <input
                type="text"
                value={name}
                onChange={(e: { target: { value: string } }) => setName(e.target.value)}
                placeholder="محمد أحمد"
                required
                className="w-full text-sm rounded-lg border px-4 py-2.5 outline-none"
                style={{ borderColor: 'var(--rim2)', background: 'transparent', color: 'var(--t1)' }}
              />
            </div>
          )}

          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--t3)' }}>كلمة المرور</label>
            <input
              type="password"
              value={password}
              onChange={(e: { target: { value: string } }) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full text-sm rounded-lg border px-4 py-2.5 outline-none"
              style={{ borderColor: 'var(--rim2)', background: 'transparent', color: 'var(--t1)' }}
            />
          </div>

          {mode === 'signup' && (
            <div>
              <label className="block text-xs mb-1" style={{ color: 'var(--t3)' }}>تأكيد كلمة المرور</label>
              <input
                type="password"
                value={confirm}
                onChange={(e: { target: { value: string } }) => setConfirm(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full text-sm rounded-lg border px-4 py-2.5 outline-none"
                style={{ borderColor: 'var(--rim2)', background: 'transparent', color: 'var(--t1)' }}
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg text-sm font-bold transition-opacity"
            style={{ background: 'var(--gold)', color: 'var(--void)', opacity: loading ? 0.6 : 1 }}
          >
            {loading ? 'جارٍ المعالجة...' : mode === 'signup' ? 'إنشاء الحساب والانضمام' : 'تسجيل الدخول والانضمام'}
          </button>
        </form>
        )}

        {mode !== 'otp' && (
        <p className="text-center text-xs" style={{ color: 'var(--t3)' }}>
          {mode === 'signup' ? (
            <>
              لديك حساب بالفعل؟{' '}
              <button
                onClick={() => { setMode('signin'); setError(''); }}
                className="underline"
                style={{ color: 'var(--gold)' }}
              >
                سجّل دخولك
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => { setMode('signup'); setError(''); }}
                className="underline"
                style={{ color: 'var(--gold)' }}
              >
                إنشاء حساب جديد
              </button>
            </>
          )}
        </p>
        )}
      </div>
    </div>
  );
}
