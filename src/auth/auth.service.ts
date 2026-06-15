import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Resend } from 'resend';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { createHash, createHmac, randomBytes, randomInt } from 'crypto';
import { AuditService } from '../audit/audit.service';

type PendingRegistrationPayload = {
  name: string;
  passwordHash: string;
  userId?: string;
};

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService, private jwt: JwtService, private audit: AuditService) {}

  private hashToken(t: string) {
    return createHash('sha256').update(t).digest('hex');
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private createEmailCode() {
    return randomInt(100000, 1000000).toString();
  }

  private base32(buffer: Buffer) {
    let bits = '';
    let output = '';

    for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
    for (let i = 0; i < bits.length; i += 5) {
      const chunk = bits.slice(i, i + 5).padEnd(5, '0');
      output += BASE32_ALPHABET[parseInt(chunk, 2)];
    }

    return output;
  }

  private base32ToBuffer(secret: string) {
    const clean = secret.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
    let bits = '';

    for (const char of clean) {
      const value = BASE32_ALPHABET.indexOf(char);
      if (value < 0) throw new BadRequestException('Invalid 2FA secret');
      bits += value.toString(2).padStart(5, '0');
    }

    const bytes: number[] = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
    return Buffer.from(bytes);
  }

  private totp(secret: string, step = Math.floor(Date.now() / 30000)) {
    const counter = Buffer.alloc(8);
    counter.writeUInt32BE(Math.floor(step / 0x100000000), 0);
    counter.writeUInt32BE(step & 0xffffffff, 4);

    const hmac = createHmac('sha1', this.base32ToBuffer(secret)).update(counter).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);

    return String(binary % 1000000).padStart(6, '0');
  }

  private verifyTotp(secret: string, code: string) {
    const normalized = code.trim();
    if (!/^\d{6}$/.test(normalized)) return false;

    const step = Math.floor(Date.now() / 30000);
    return [-1, 0, 1].some((offset) => this.totp(secret, step + offset) === normalized);
  }

  private frontendUrl() {
    return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  }

  private async sendRegistrationCode(email: string, code: string) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM || 'Incidents64 <noreply@incidents64.fun>';

    if (!apiKey) {
      throw new BadRequestException('Email service is not configured');
    }

    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from,
      to: email,
      subject: 'Your Incidents64 verification code',
      text: `Your Incidents64 verification code is ${code}. It expires in 15 minutes.`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
          <h2 style="margin:0 0 12px">Incidents64 email verification</h2>
          <p>Enter this code to finish creating your account:</p>
          <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:20px 0">${code}</p>
          <p>This code expires in 15 minutes. If you did not request it, you can ignore this email.</p>
        </div>
      `,
    });

    if (result.error) {
      throw new BadRequestException(`Could not send verification email: ${result.error.message}`);
    }
  }

  private async sendPasswordResetEmail(email: string, resetUrl: string) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM || 'Incidents64 <noreply@incidents64.fun>';

    if (!apiKey) {
      throw new BadRequestException('Email service is not configured');
    }

    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from,
      to: email,
      subject: 'Reset your Incidents64 password',
      text: `Use this link to reset your Incidents64 password: ${resetUrl}. It expires in 1 hour.`,
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827">
          <h2 style="margin:0 0 12px">Reset your Incidents64 password</h2>
          <p>Use the button below to create a new password. The link expires in 1 hour.</p>
          <p style="margin:24px 0">
            <a href="${resetUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700">Reset password</a>
          </p>
          <p>If the button does not work, open this link:</p>
          <p style="word-break:break-all"><a href="${resetUrl}">${resetUrl}</a></p>
          <p>If you did not request it, you can ignore this email.</p>
        </div>
      `,
    });

    if (result.error) {
      throw new BadRequestException(`Could not send password reset email: ${result.error.message}`);
    }
  }

  async register(dto: any) {
    const email = this.normalizeEmail(dto.email);
    const exists = await this.prisma.user.findUnique({ where: { email } });

    if (exists?.emailConfirmed) {
      throw new BadRequestException('Email already registered');
    }

    const code = this.createEmailCode();
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const payload: PendingRegistrationPayload = { name: dto.name, passwordHash };

    if (exists?.id) {
      payload.userId = exists.id;
    }

    await this.prisma.emailToken.updateMany({
      where: { email, type: 'EMAIL_CONFIRM', usedAt: null },
      data: { usedAt: new Date() },
    });

    await this.prisma.emailToken.create({
      data: {
        email,
        tokenHash: this.hashToken(code),
        type: 'EMAIL_CONFIRM',
        expiresAt,
        payload,
      },
    });

    await this.sendRegistrationCode(email, code);

    return { ok: true, message: 'Verification code sent' };
  }

  async login(dto: any, meta: any) {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    const ok = user && (await bcrypt.compare(dto.password, user.passwordHash));

    await this.prisma.loginLog
      .create({
        data: {
          userId: user?.id || 'unknown',
          ip: meta.ip,
          userAgent: meta.ua,
          success: !!ok,
          reason: ok ? null : 'BAD_CREDENTIALS',
        },
      })
      .catch(() => {});
    await this.audit.record({
      userId: user?.id,
      action: ok ? 'auth.login.success' : 'auth.login.failed',
      entityType: 'User',
      entityId: user?.id,
      ip: meta.ip,
      userAgent: meta.ua,
      metadata: { email, reason: ok ? null : 'BAD_CREDENTIALS' },
    });

    if (!ok || !user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.emailConfirmed) {
      await this.audit.record({
        userId: user.id,
        action: 'auth.login.blocked_unconfirmed_email',
        entityType: 'User',
        entityId: user.id,
        ip: meta.ip,
        userAgent: meta.ua,
        metadata: { email },
      });
      throw new UnauthorizedException('Email is not confirmed');
    }

    if (user.twoFactorEnabled) {
      if (!dto.twoFactorCode || !user.twoFactorSecret || !this.verifyTotp(user.twoFactorSecret, dto.twoFactorCode)) {
        throw new UnauthorizedException('Invalid two-factor code');
      }
    }

    return this.issueTokens(user);
  }

  async issueTokens(user: any) {
    const payload = { sub: user.id, email: user.email, role: user.role, name: user.name };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_ACCESS_SECRET || 'dev_access',
      expiresIn: process.env.JWT_ACCESS_TTL || '15m',
    });
    const refreshToken = await this.jwt.signAsync(payload, {
      secret: process.env.JWT_REFRESH_SECRET || 'dev_refresh',
      expiresIn: process.env.JWT_REFRESH_TTL || '30d',
    });

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + 30 * 86400000),
      },
    });

    return { accessToken, refreshToken, user: this.publicUser(user) };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = await this.jwt.verifyAsync(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET || 'dev_refresh',
      });
      const found = await this.prisma.refreshToken.findFirst({
        where: { tokenHash: this.hashToken(refreshToken), revokedAt: null },
      });
      if (!found) throw new Error();
      const user = await this.prisma.user.findUniqueOrThrow({ where: { id: payload.sub } });
      return this.issueTokens(user);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(refreshToken) },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  async me(id: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    return this.publicUser(user);
  }

  async confirmEmail(emailInput: string, codeInput: string) {
    const email = this.normalizeEmail(emailInput);
    const code = codeInput.trim();

    if (!/^\d{6}$/.test(code)) {
      throw new BadRequestException('Invalid code');
    }

    const exists = await this.prisma.user.findUnique({ where: { email } });
    if (exists?.emailConfirmed) {
      throw new BadRequestException('Email already registered');
    }

    const row = await this.prisma.emailToken.findFirst({
      where: {
        email,
        tokenHash: this.hashToken(code),
        type: 'EMAIL_CONFIRM',
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!row?.payload) {
      throw new BadRequestException('Invalid code');
    }

    const pending = row.payload as PendingRegistrationPayload;
    const user = await this.prisma.$transaction(async (tx) => {
      const created = exists
        ? await tx.user.update({
            where: { id: exists.id },
            data: {
              name: pending.name,
              passwordHash: pending.passwordHash,
              emailConfirmed: true,
            },
          })
        : await tx.user.create({
            data: {
              email,
              name: pending.name,
              passwordHash: pending.passwordHash,
              role: 'OBSERVER',
              emailConfirmed: true,
            },
          });

      await tx.emailToken.update({
        where: { id: row.id },
        data: { usedAt: new Date() },
      });

      return created;
    });

    await this.audit.record({
      userId: user.id,
      action: 'auth.email.confirmed',
      entityType: 'User',
      entityId: user.id,
      metadata: { email },
    });

    return this.issueTokens(user);
  }

  async forgotPassword(emailInput: string) {
    const email = this.normalizeEmail(emailInput);
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });

    if (!user) {
      return { ok: true, message: 'If this email is registered, a password reset link has been sent' };
    }

    const token = randomBytes(32).toString('hex');

    await this.prisma.emailToken.updateMany({
      where: { email, type: 'PASSWORD_RESET', usedAt: null },
      data: { usedAt: new Date() },
    });

    await this.prisma.emailToken.create({
      data: {
        email,
        tokenHash: this.hashToken(token),
        type: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + 3600000),
      },
    });

    const resetUrl = `${this.frontendUrl()}/reset-password?token=${token}`;
    await this.sendPasswordResetEmail(email, resetUrl);

    return { ok: true, message: 'If this email is registered, a password reset link has been sent' };
  }

  async resetPassword(token: string, password: string) {
    const row = await this.prisma.emailToken.findFirst({
      where: {
        tokenHash: this.hashToken(token),
        type: 'PASSWORD_RESET',
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!row) throw new BadRequestException('Invalid token');
    await this.prisma.user.update({
      where: { email: row.email },
      data: { passwordHash: await bcrypt.hash(password, 12) },
    });
    await this.prisma.emailToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    return { ok: true };
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const ok = await bcrypt.compare(oldPassword, user.passwordHash);

    if (!ok) {
      throw new BadRequestException('Current password is incorrect');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await bcrypt.hash(newPassword, 12) },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      userId,
      action: 'auth.password.changed',
      entityType: 'User',
      entityId: userId,
    });

    return { ok: true };
  }

  async setupTwoFactor(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const secret = user.twoFactorSecret || this.base32(randomBytes(20));

    if (!user.twoFactorSecret) {
      await this.prisma.user.update({ where: { id: userId }, data: { twoFactorSecret: secret } });
    }

    const issuer = 'Incidents64';
    const label = encodeURIComponent(`${issuer}:${user.email}`);
    const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

    return { secret, otpauthUrl, enabled: user.twoFactorEnabled };
  }

  async enableTwoFactor(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const secret = user.twoFactorSecret || this.base32(randomBytes(20));

    if (!this.verifyTotp(secret, code)) {
      throw new BadRequestException('Invalid two-factor code');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: secret, twoFactorEnabled: true },
    });

    await this.audit.record({
      userId,
      action: 'auth.2fa.enabled',
      entityType: 'User',
      entityId: userId,
    });

    return { ok: true };
  }

  async disableTwoFactor(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (!user.twoFactorSecret || !this.verifyTotp(user.twoFactorSecret, code)) {
      throw new BadRequestException('Invalid two-factor code');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });

    await this.audit.record({
      userId,
      action: 'auth.2fa.disabled',
      entityType: 'User',
      entityId: userId,
    });

    return { ok: true };
  }

  publicUser(u: any) {
    const { passwordHash, twoFactorSecret, ...safe } = u;
    return safe;
  }
}
