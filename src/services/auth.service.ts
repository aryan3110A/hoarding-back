import { Security } from '../lib/security';
import { config } from '../config';
import { UserRepository } from '../repositories/user.repository';
import { RefreshSessionRepository } from '../repositories/refreshSession.repository';
import { UserDeviceRepository } from '../repositories/userDevice.repository';
import { LocationRepository } from '../repositories/location.repository';
import { UnauthorizedError } from '../lib/errors';
import { getRedis } from '../lib/redis';

const userRepository = new UserRepository();
const refreshSessionRepository = new RefreshSessionRepository();
const userDeviceRepository = new UserDeviceRepository();
const locationRepository = new LocationRepository();

interface LoginRequest {
  email?: string;
  phone?: string;
  password: string;
  deviceId: string;
  deviceName?: string;
  platform?: string;
  lat?: number;
  lng?: number;
  ip?: string;
  userAgent?: string;
}

const normalizeLabel = (value?: string | null) => String(value || '').trim();

const detectDevicePlatform = (userAgent?: string, providedPlatform?: string | null) => {
  const explicitPlatform = normalizeLabel(providedPlatform);
  if (explicitPlatform) {
    return explicitPlatform;
  }

  const ua = String(userAgent || '').toLowerCase();
  if (ua.includes('iphone')) return 'iPhone';
  if (ua.includes('ipad')) return 'iPad';
  if (ua.includes('android')) return 'Android';
  if (ua.includes('windows')) return 'Windows';
  if (ua.includes('mac os x') || ua.includes('macintosh')) return 'macOS';
  if (ua.includes('linux')) return 'Linux';
  return 'Other';
};

const detectBrowser = (userAgent?: string) => {
  const ua = String(userAgent || '').toLowerCase();
  if (ua.includes('edg/')) return 'Edge';
  if (ua.includes('opr/') || ua.includes('opera')) return 'Opera';
  if (ua.includes('chrome/') && !ua.includes('edg/')) return 'Chrome';
  if (ua.includes('firefox/')) return 'Firefox';
  if (ua.includes('safari/') && !ua.includes('chrome/')) return 'Safari';
  return '';
};

const buildDeviceName = (
  userAgent?: string,
  providedDeviceName?: string | null,
  providedPlatform?: string | null,
) => {
  const explicitName = normalizeLabel(providedDeviceName);
  if (explicitName) {
    return explicitName;
  }

  const ua = String(userAgent || '').toLowerCase();
  const platform = detectDevicePlatform(userAgent, providedPlatform);
  const browser = detectBrowser(userAgent);
  const isTablet = ua.includes('ipad') || (ua.includes('android') && !ua.includes('mobile'));
  const isPhone = ua.includes('iphone') || (ua.includes('android') && ua.includes('mobile'));

  let baseName = 'Other Device';
  if (isTablet) {
    baseName = `${platform} Tablet`;
  } else if (isPhone) {
    baseName = `${platform} Phone`;
  } else if (platform === 'Windows' || platform === 'macOS' || platform === 'Linux') {
    baseName = `${platform} PC`;
  } else if (platform !== 'Other') {
    baseName = platform;
  }

  return browser ? `${baseName} (${browser})` : baseName;
};

export class AuthService {
  async login(data: LoginRequest) {
    const { email, phone, password, deviceId, deviceName, platform, lat, lng } = data;

    let user;
    if (email) user = await userRepository.findByEmail(email);
    else if (phone) user = await userRepository.findByPhone(phone);

    if (!user || !user.isActive) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const isPasswordValid = await Security.comparePassword(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const roleName = String(user.role.name || '').toLowerCase();
    const detectedPlatform = detectDevicePlatform(data.userAgent, platform);
    const detectedDeviceName = buildDeviceName(data.userAgent, deviceName, platform);
    const redis = getRedis();

    if (roleName === 'sales') {
      const sameDeviceSessions = await refreshSessionRepository.revokeActiveByUserIdAndDeviceId(
        user.id,
        deviceId,
      );

      if (redis) {
        for (const revokedSession of sameDeviceSessions) {
          await redis.del(`session:${revokedSession.id}`);
        }
      }
    }

    await userDeviceRepository.upsert(user.id, deviceId, {
      deviceName: detectedDeviceName,
      platform: detectedPlatform,
      lastIp: data.ip,
      lastLat: lat,
      lastLng: lng,
      isRevoked: false,
    });

    if (lat && lng) {
      await locationRepository.create({
        userId: user.id,
        deviceId,
        type: 'login',
        lat,
        lng,
      });
    }

    // ✅ Create refresh session (DB is source of truth)
    const refreshToken = Security.generateRefreshToken();
    const refreshTokenHash = Security.hashToken(refreshToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + config.jwt.refreshExpirationDays);

    const session = await refreshSessionRepository.create({
      userId: user.id,
      deviceId,
      refreshTokenHash,
      expiresAt,
      ip: data.ip,
      userAgent: data.userAgent,
    });

    // ✅ Redis session cache (OPTIONAL)
    if (redis) {
      const redisKey = `session:${session.id}`;
      const inactivityTimeout =
        config.session.inactivityTimeoutMinutes[
          user.role.name as keyof typeof config.session.inactivityTimeoutMinutes
        ] ?? config.session.inactivityTimeoutMinutes.default;

      await redis.setex(redisKey, inactivityTimeout * 60, user.id);
    }

    if (roleName === 'sales') {
      const activeSessions = await refreshSessionRepository.findActiveByUserId(user.id);
      const overflowSessions = activeSessions.slice(2);

      if (overflowSessions.length > 0) {
        await refreshSessionRepository.revokeMany(
          overflowSessions.map((row: { id: string }) => row.id),
        );

        if (redis) {
          for (const overflowSession of overflowSessions) {
            await redis.del(`session:${overflowSession.id}`);
          }
        }
      }
    }

    const accessToken = Security.generateAccessToken({
      userId: user.id,
      role: user.role.name,
      sessionId: session.id,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role.name,
      },
      session: {
        id: session.id,
        deviceId,
        deviceName: detectedDeviceName,
        platform: detectedPlatform,
        ip: data.ip || null,
        userAgent: data.userAgent || null,
      },
    };
  }

  async refresh(refreshToken: string) {
    const refreshTokenHash = Security.hashToken(refreshToken);
    const session = await refreshSessionRepository.findByTokenHash(refreshTokenHash);

    if (!session || session.revoked) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    if (new Date() > session.expiresAt) {
      throw new UnauthorizedError('Refresh token expired');
    }

    // ✅ Redis inactivity check (OPTIONAL)
    const redis = getRedis();
    if (redis) {
      const redisKey = `session:${session.id}`;
      const exists = await redis.exists(redisKey);
      if (!exists) {
        throw new UnauthorizedError('Session expired due to inactivity');
      }

      const inactivityTimeout =
        config.session.inactivityTimeoutMinutes[
          session.user.role.name as keyof typeof config.session.inactivityTimeoutMinutes
        ] ?? config.session.inactivityTimeoutMinutes.default;

      await redis.expire(redisKey, inactivityTimeout * 60);
    }

    await refreshSessionRepository.update(session.id, { lastUsedAt: new Date() });

    const accessToken = Security.generateAccessToken({
      userId: session.userId,
      role: session.user.role.name,
      sessionId: session.id,
    });

    return { accessToken };
  }

  async logout(refreshToken: string) {
    const refreshTokenHash = Security.hashToken(refreshToken);
    const session = await refreshSessionRepository.findByTokenHash(refreshTokenHash);

    if (session) {
      await refreshSessionRepository.revoke(session.id);

      const redis = getRedis();
      if (redis) {
        await redis.del(`session:${session.id}`);
      }
    }
  }

  async getCurrentSession(userId: string, sessionId: string) {
    const session = await refreshSessionRepository.findById(sessionId);

    if (
      !session ||
      session.userId !== userId ||
      session.revoked ||
      new Date() > session.expiresAt
    ) {
      throw new UnauthorizedError('Session expired or revoked');
    }

    const device = await userDeviceRepository.findByUserAndDeviceId(userId, session.deviceId);

    return {
      id: session.id,
      deviceId: session.deviceId,
      deviceName:
        device?.deviceName || buildDeviceName(session.userAgent, undefined, device?.platform),
      platform: device?.platform || detectDevicePlatform(session.userAgent),
      ip: session.ip || device?.lastIp || null,
      userAgent: session.userAgent || null,
      issuedAt: session.issuedAt,
      lastUsedAt: session.lastUsedAt,
      lastSeen: device?.lastSeen || null,
    };
  }
}
