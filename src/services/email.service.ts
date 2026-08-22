import nodemailer from 'nodemailer';
import { config } from '../config';

export interface EmailOptions {
    to: string;
    subject: string;
    text: string;
    html?: string;
}

export class EmailService {
    private transporter: nodemailer.Transporter;

    constructor() {
        // For demo, we can use a simple SMTP transporter or a stub
        // If no SMTP config is present, we'll use a stub that logs to console
        if (process.env.SMTP_HOST) {
            this.transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: Number(process.env.SMTP_PORT) || 587,
                secure: false, // true for 465, false for other ports
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS,
                },
            });
        } else {
            // Stub transporter
            this.transporter = nodemailer.createTransport({
                jsonTransport: true,
            });
        }
    }

    async sendEmail(options: EmailOptions): Promise<void> {
        try {
            if (process.env.SMTP_HOST) {
                await this.transporter.sendMail({
                    from: process.env.SMTP_FROM || '"Hoarding App" <noreply@hoarding.local>',
                    to: options.to,
                    subject: options.subject,
                    text: options.text,
                    html: options.html,
                });
                console.log(`Email sent to ${options.to}`);
            } else {
                console.log('--- EMAIL STUB ---');
                console.log(`To: ${options.to}`);
                console.log(`Subject: ${options.subject}`);
                console.log(`Body: ${options.text}`);
                console.log('------------------');
            }
        } catch (error) {
            console.error('Error sending email:', error);
            // Don't throw, just log error to avoid breaking the flow
        }
    }
}
