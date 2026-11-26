import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

export interface SendOtpEmailInput {
  to: string;
  code: string;
  purpose: string;
}

/**
 * Thin wrapper around the Resend email API.
 *
 * Requires RESEND_API_KEY to be set. The `from` address must use a domain
 * verified at https://resend.com/domains (RESEND_FROM), otherwise Resend will
 * reject the send. All send failures are logged and swallowed so an email
 * outage never blocks the request that triggered it (the OTP is already stored
 * and the user can hit "Resend").
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly fromAddress: string;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    this.resend = apiKey ? new Resend(apiKey) : null;
    this.fromAddress = process.env.RESEND_FROM || 'OJChat <onboarding@resend.dev>';
    if (!this.resend) {
      this.logger.warn('RESEND_API_KEY not set — OTP emails will not be sent');
    }
  }

  async sendOtpEmail(input: SendOtpEmailInput): Promise<boolean> {
    if (!this.resend) return false;
    try {
      const { data, error } = await this.resend.emails.send({
        from: this.fromAddress,
        to: [input.to],
        subject: this.subjectFor(input.purpose),
        html: this.htmlFor(input.code, input.purpose),
      });
      if (error) {
        this.logger.error(`Resend error sending OTP to ${input.to}: ${error.message}`);
        return false;
      }
      this.logger.log(`OTP email sent to ${input.to} (id ${data?.id})`);
      return true;
    } catch (err) {
      this.logger.error(
        `Failed to send OTP email to ${input.to}: ${err instanceof Error ? err.message : err}`,
      );
      return false;
    }
  }

  private subjectFor(purpose: string): string {
    switch (purpose) {
      case 'registration':
        return 'Verify your OJChat account';
      case 'phone_verify':
        return 'Your OJChat verification code';
      case 'password_reset':
        return 'Your OJChat password reset code';
      default:
        return 'Your OJChat verification code';
    }
  }

  private htmlFor(code: string, purpose: string): string {
    const heading =
      purpose === 'registration'
        ? 'Confirm your email address'
        : purpose === 'password_reset'
          ? 'Reset your password'
          : 'Your verification code';
    const hint =
      purpose === 'registration'
        ? 'Enter this code in the app to verify your account. It expires in 5 minutes.'
        : 'Enter this code in the app. It expires in 5 minutes.';
    return `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f6f7f9;padding:32px 16px;">
        <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;border:1px solid #e5e7eb;">
          <h1 style="margin:0 0 8px;font-size:20px;color:#111827;">${heading}</h1>
          <p style="margin:0 0 24px;font-size:14px;color:#6b7280;">${hint}</p>
          <div style="font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;color:#111827;background:#f3f4f6;border-radius:12px;padding:16px 0;">
            ${code}
          </div>
          <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">
            If you didn't request this email, you can safely ignore it.
          </p>
        </div>
      </div>`;
  }
}
