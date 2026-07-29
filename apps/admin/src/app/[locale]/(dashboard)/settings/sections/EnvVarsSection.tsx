import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { SETTING_KEYS, SENSITIVE_KEYS } from "@/lib/settings";

interface EnvVarsSectionProps {
  settings: Record<string, string>;
  isPending: boolean;
  messages: Record<string, { type: 'success' | 'error', text: string }>;
  handleInputChange: (key: string, value: string) => void;
  handleSave: (section: string, keys: string[]) => void;
}

export function EnvVarsSection({ settings, isPending, messages, handleInputChange, handleSave }: EnvVarsSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>إعدادات البيئة (ETA & الشحن)</CardTitle>
        <p className="text-sm text-[var(--t2)] mt-1">
          هذه القيم تُحفظ في قاعدة البيانات لكل منظمة. يُنصح بضبطها أيضاً كـ environment variables في منصة الاستضافة (Vercel / Railway).
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ETA Egypt Tax Authority */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--t1)] border-b border-[var(--rim1)] pb-1">ETA — هيئة الضرائب المصرية</h3>
          <div className="space-y-2">
            <Label>ETA_CLIENT_ID</Label>
            <Input
              dir="ltr"
              placeholder="your_eta_client_id"
              value={settings[SETTING_KEYS.eta.client_id] || ""}
              onChange={(e) => handleInputChange(SETTING_KEYS.eta.client_id, e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>ETA_CLIENT_SECRET</Label>
            <Input
              type="password"
              dir="ltr"
              placeholder={SENSITIVE_KEYS.includes(SETTING_KEYS.eta.client_secret) ? "••••••••" : ""}
              value={settings[SETTING_KEYS.eta.client_secret] || ""}
              onChange={(e) => handleInputChange(SETTING_KEYS.eta.client_secret, e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>ETA_ISSUER_EIN — الرقم الضريبي للمنظمة</Label>
            <Input
              dir="ltr"
              placeholder="your_company_tax_id"
              value={settings[SETTING_KEYS.eta.issuer_ein] || ""}
              onChange={(e) => handleInputChange(SETTING_KEYS.eta.issuer_ein, e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>ETA_ENV — البيئة</Label>
            <Select
              value={settings[SETTING_KEYS.eta.env] || "sandbox"}
              onValueChange={(val) => handleInputChange(SETTING_KEYS.eta.env, val)}
            >
              <SelectTrigger dir="ltr">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">sandbox (اختبار)</SelectItem>
                <SelectItem value="production">production (إنتاج)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Courier Webhooks */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--t1)] border-b border-[var(--rim1)] pb-1">الشحن — Webhooks</h3>
          <div className="space-y-2">
            <Label>BOSTA_WEBHOOK_SECRET</Label>
            <Input
              type="password"
              dir="ltr"
              placeholder="your_bosta_webhook_secret"
              value={settings[SETTING_KEYS.courier.bosta_webhook_secret] || ""}
              onChange={(e) => handleInputChange(SETTING_KEYS.courier.bosta_webhook_secret, e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>ARAMEX_WEBHOOK_TOKEN</Label>
            <Input
              type="password"
              dir="ltr"
              placeholder="your_aramex_webhook_token"
              value={settings[SETTING_KEYS.courier.aramex_webhook_token] || ""}
              onChange={(e) => handleInputChange(SETTING_KEYS.courier.aramex_webhook_token, e.target.value)}
            />
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex justify-between items-center">
        <Button
          disabled={isPending}
          onClick={() => handleSave('env_vars', [
            SETTING_KEYS.eta.client_id,
            SETTING_KEYS.eta.client_secret,
            SETTING_KEYS.eta.issuer_ein,
            SETTING_KEYS.eta.env,
            SETTING_KEYS.courier.bosta_webhook_secret,
            SETTING_KEYS.courier.aramex_webhook_token,
          ])}
        >
          حفظ إعدادات البيئة
        </Button>
        {messages['env_vars'] && (
          <span className={`text-sm ${messages['env_vars'].type === 'success' ? 'text-[var(--emerald)]' : 'text-[var(--crimson)]'}`}>
            {messages['env_vars'].text}
          </span>
        )}
      </CardFooter>
    </Card>
  );
}
