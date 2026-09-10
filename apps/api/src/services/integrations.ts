import { envVar } from '../utils/env';

export interface WhatsAppTemplateComponent {
    type: string;
    parameters: Array<{
        type: string;
        text?: string;
        image?: { link: string };
        document?: { link: string; filename?: string };
        video?: { link: string };
    }>;
}

export async function sendWhatsAppTemplate(to: string, templateName: string, components: WhatsAppTemplateComponent[] = []): Promise<unknown> {
    const apiKey = envVar('WHATSAPP_360DIALOG_API_KEY');

    if (!apiKey) {
        throw new Error('Missing WhatsApp 360dialog API key');
    }

    const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
            name: templateName,
            language: {
                code: 'ar'
            },
            components
        }
    };

    const response = await fetch('https://waba.360dialog.io/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'D360-API-KEY': apiKey
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`WhatsApp API error: ${response.status} - ${errorText}`);
    }

    return response.json();
}

export interface SendEmailOptions {
    to: string;
    subject: string;
    html: string;
}

export async function sendTransactionalEmail(opts: SendEmailOptions): Promise<unknown> {
    const apiKey = envVar('RESEND_API_KEY');
    const fromEmail = envVar('RESEND_FROM');

    if (!apiKey || !fromEmail) {
        throw new Error('Missing Resend environment variables');
    }

    const payload = {
        from: fromEmail,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html
    };

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
         const errorText = await response.text();
         throw new Error(`Resend API error: ${response.status} - ${errorText}`);
    }

    return response.json();
}
