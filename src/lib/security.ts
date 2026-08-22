import jwt, { SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { config } from '../config';

export class Security {
    static async hashPassword(password: string): Promise<string> {
        return bcrypt.hash(password, 10);
    }

    static async comparePassword(password: string, hash: string): Promise<boolean> {
        return bcrypt.compare(password, hash);
    }

    static generateRefreshToken(): string {
        return crypto.randomBytes(40).toString('hex');
    }

    static hashToken(token: string): string {
        return crypto.createHash('sha256').update(token).digest('hex');
    }

    static compareToken(token: string, hash: string): boolean {
        const candidateHash = this.hashToken(token);
        // Timing safe comparison
        const b1 = Buffer.from(candidateHash);
        const b2 = Buffer.from(hash);
        if (b1.length !== b2.length) return false;
        return crypto.timingSafeEqual(b1, b2);
    }

    static generateAccessToken(payload: unknown): string {
        return jwt.sign(payload as object, config.jwt.secret, { expiresIn: config.jwt.accessExpiration as SignOptions['expiresIn'] });
    }

    static verifyAccessToken(token: string): unknown {
        return jwt.verify(token, config.jwt.secret);
    }
}
