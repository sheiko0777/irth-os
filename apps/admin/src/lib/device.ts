/**
 * Lightweight, zero-dependency parser for User-Agent strings.
 * Extracts device type, browser name, operating system, and a human-friendly Arabic summary.
 */

export interface ParsedClientDevice {
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown';
  browser: string;
  os: string;
  labelAr: string;
}

export function parseUserAgent(uaString: string | null | undefined): ParsedClientDevice {
  if (!uaString || typeof uaString !== 'string') {
    return {
      deviceType: 'unknown',
      browser: 'غير معروف',
      os: 'غير معروف',
      labelAr: 'جهاز غير معروف',
    };
  }

  const ua = uaString.toLowerCase();

  // 1. Detect Device Type
  let deviceType: ParsedClientDevice['deviceType'] = 'desktop';
  if (/(ipad|tablet|(android(?!.*mobile))|(windows(?!.*phone)(.*touch))|kindle|playbook|silk)/i.test(ua)) {
    deviceType = 'tablet';
  } else if (/(mobi|ipod|phone|iphone|blackberry|opera mini|opera mobi|iemobile)/i.test(ua)) {
    deviceType = 'mobile';
  } else if (/bot|crawler|spider|curl|wget/i.test(ua)) {
    deviceType = 'bot';
  }

  // 2. Detect Operating System
  let os = 'نظام آخر';
  if (/windows nt 10\.0/i.test(ua)) os = 'Windows 10/11';
  else if (/windows nt 6\.3/i.test(ua)) os = 'Windows 8.1';
  else if (/windows nt 6\.1/i.test(ua)) os = 'Windows 7';
  else if (/windows/i.test(ua)) os = 'Windows';
  else if (/iphone|ipad|ipod/i.test(ua)) {
    const match = ua.match(/os (\d+)_?(\d+)?/);
    os = match ? `iOS ${match[1]}` : 'iOS';
  } else if (/android/i.test(ua)) {
    const match = ua.match(/android (\d+(\.\d+)?)/);
    os = match ? `Android ${match[1]}` : 'Android';
  } else if (/macintosh|mac os x/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  // 3. Detect Browser
  let browser = 'متصفح ويب';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/opr\/|opera/i.test(ua)) browser = 'Opera';
  else if (/chrome|crios/i.test(ua) && !/edg\//i.test(ua)) browser = 'Chrome';
  else if (/safari/i.test(ua) && !/chrome|crios/i.test(ua)) browser = 'Safari';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/msie|trident/i.test(ua)) browser = 'Internet Explorer';

  // 4. Human-friendly label
  let deviceNameAr = 'كمبيوتر';
  if (deviceType === 'mobile') deviceNameAr = 'هاتف';
  else if (deviceType === 'tablet') deviceNameAr = 'تابلت';
  else if (deviceType === 'bot') deviceNameAr = 'نظام آلي';

  const labelAr = `${browser} على ${os} (${deviceNameAr})`;

  return {
    deviceType,
    browser,
    os,
    labelAr,
  };
}
