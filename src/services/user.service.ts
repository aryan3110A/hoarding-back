import { UserRepository } from '../repositories/user.repository';
import { RoleRepository } from '../repositories/role.repository';
import { Security } from '../lib/security';
import { BadRequestError, NotFoundError } from '../lib/errors';
import { prisma } from '../lib/prisma';

type SalesUserDeviceStatusRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  devices: Array<{
    deviceId: string;
    deviceName: string | null;
    platform: string | null;
    lastIp: string | null;
    lastLat: number | null;
    lastLng: number | null;
    lastSeen: Date;
    isRevoked: boolean;
  }>;
  sessions: Array<{
    id: string;
    deviceId: string;
    ip: string | null;
    issuedAt: Date;
    lastUsedAt: Date;
    revoked?: boolean;
    expiresAt?: Date;
  }>;
  locations?: Array<{
    id: string;
    type: string;
    lat: number | null;
    lng: number | null;
    accuracy: number | null;
    ip: string | null;
    note: string | null;
    createdAt: Date;
  }>;
};

const userRepository = new UserRepository();
const roleRepository = new RoleRepository();

export class UserService {
  private buildSalesDeviceStatusPayload(salesUser: SalesUserDeviceStatusRow) {
    const activeSession = salesUser.sessions[0] || null;
    const activeDevices = salesUser.sessions
      .map((session) => {
        const matchedDevice =
          salesUser.devices.find(
            (device: SalesUserDeviceStatusRow['devices'][number]) =>
              device.deviceId === session.deviceId && !device.isRevoked,
          ) || null;

        return {
          deviceId: session.deviceId,
          deviceName: matchedDevice?.deviceName || `Device ${session.deviceId.slice(0, 6)}`,
          platform: matchedDevice?.platform || null,
          ip: session.ip || matchedDevice?.lastIp || null,
          latitude: matchedDevice?.lastLat ?? null,
          longitude: matchedDevice?.lastLng ?? null,
          lastSeen: matchedDevice?.lastSeen || session.lastUsedAt,
          sessionIssuedAt: session.issuedAt,
          lastUsedAt: session.lastUsedAt,
        };
      })
      .filter(
        (device, index, list) =>
          list.findIndex((item) => item.deviceId === device.deviceId) === index,
      );
    const activeDevice = activeSession
      ? salesUser.devices.find(
          (device: SalesUserDeviceStatusRow['devices'][number]) =>
            device.deviceId === activeSession.deviceId && !device.isRevoked,
        ) || null
      : null;
    const latestKnownDevice =
      activeDevice ||
      salesUser.devices.find(
        (device: SalesUserDeviceStatusRow['devices'][number]) => !device.isRevoked,
      ) ||
      salesUser.devices[0] ||
      null;

    return {
      activeSession,
      activeDevice,
      latestKnownDevice,
      summary: {
        userId: salesUser.id,
        name: salesUser.name,
        email: salesUser.email,
        phone: salesUser.phone,
        isActive: salesUser.isActive,
        isLoggedIn: Boolean(activeSession),
        activeDeviceCount: activeDevices.length,
        activeDevices,
        currentDevice:
          activeDevices.length > 0
            ? activeDevices.map((device) => device.deviceName).join(', ')
            : latestKnownDevice?.deviceName || null,
        platform:
          activeDevices.length > 0
            ? activeDevices
                .map((device) => device.platform)
                .filter(Boolean)
                .join(', ')
            : latestKnownDevice?.platform || null,
        ip:
          activeDevices.length > 0
            ? activeDevices
                .map((device) => device.ip)
                .filter(Boolean)
                .join(', ')
            : activeSession?.ip || latestKnownDevice?.lastIp || null,
        latitude: latestKnownDevice?.lastLat ?? null,
        longitude: latestKnownDevice?.lastLng ?? null,
        lastSeen: latestKnownDevice?.lastSeen || activeSession?.lastUsedAt || null,
        sessionIssuedAt: activeSession?.issuedAt || null,
      },
    };
  }

  async getAllUsers() {
    return userRepository.findAll();
  }

  async getSalesUserDeviceStatus() {
    const salesUsers = await prisma.user.findMany({
      where: {
        role: {
          name: 'sales',
        },
      },
      orderBy: {
        name: 'asc',
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isActive: true,
        devices: {
          select: {
            deviceId: true,
            deviceName: true,
            platform: true,
            lastIp: true,
            lastLat: true,
            lastLng: true,
            lastSeen: true,
            isRevoked: true,
          },
          orderBy: {
            lastSeen: 'desc',
          },
        },
        sessions: {
          where: {
            revoked: false,
            expiresAt: {
              gt: new Date(),
            },
          },
          orderBy: {
            lastUsedAt: 'desc',
          },
          select: {
            id: true,
            deviceId: true,
            ip: true,
            issuedAt: true,
            lastUsedAt: true,
          },
        },
      },
    });

    return (salesUsers as SalesUserDeviceStatusRow[]).map(
      (salesUser) => this.buildSalesDeviceStatusPayload(salesUser).summary,
    );
  }

  async getSalesUserDeviceStatusDebug() {
    const salesUsers = await prisma.user.findMany({
      where: {
        role: {
          name: 'sales',
        },
      },
      orderBy: {
        name: 'asc',
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isActive: true,
        devices: {
          select: {
            deviceId: true,
            deviceName: true,
            platform: true,
            lastIp: true,
            lastLat: true,
            lastLng: true,
            lastSeen: true,
            isRevoked: true,
          },
          orderBy: {
            lastSeen: 'desc',
          },
        },
        sessions: {
          orderBy: {
            issuedAt: 'desc',
          },
          select: {
            id: true,
            deviceId: true,
            ip: true,
            issuedAt: true,
            lastUsedAt: true,
            revoked: true,
            expiresAt: true,
          },
        },
        locations: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
          select: {
            id: true,
            type: true,
            lat: true,
            lng: true,
            accuracy: true,
            ip: true,
            note: true,
            createdAt: true,
          },
        },
      },
    });

    return (salesUsers as SalesUserDeviceStatusRow[]).map((salesUser) => {
      const payload = this.buildSalesDeviceStatusPayload(salesUser);

      return {
        ...payload.summary,
        rawUserDevice: payload.latestKnownDevice
          ? {
              deviceId: payload.latestKnownDevice.deviceId,
              deviceName: payload.latestKnownDevice.deviceName,
              platform: payload.latestKnownDevice.platform,
              lastIp: payload.latestKnownDevice.lastIp,
              lastLat: payload.latestKnownDevice.lastLat,
              lastLng: payload.latestKnownDevice.lastLng,
              lastSeen: payload.latestKnownDevice.lastSeen,
              isRevoked: payload.latestKnownDevice.isRevoked,
            }
          : null,
        latestLocationLog: salesUser.locations?.[0] || null,
        latestSession: salesUser.sessions[0] || null,
      };
    });
  }

  async getUserById(id: string) {
    const user = await userRepository.findById(id);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    return user;
  }

  async createUser(data: {
    name: string;
    email?: string;
    phone?: string;
    password: string;
    roleId: number;
    isActive?: boolean;
  }) {
    // Validate that at least email or phone is provided
    if (!data.email && !data.phone) {
      throw new BadRequestError('Email or phone must be provided');
    }

    // Check if email already exists
    if (data.email) {
      const existingEmail = await userRepository.findByEmail(data.email);
      if (existingEmail) {
        throw new BadRequestError('Email already exists');
      }
    }

    // Check if phone already exists
    if (data.phone) {
      const existingPhone = await userRepository.findByPhone(data.phone);
      if (existingPhone) {
        throw new BadRequestError('Phone already exists');
      }
    }

    // Verify role exists
    const role = await roleRepository.findById(data.roleId);
    if (!role) {
      throw new BadRequestError('Invalid role');
    }

    // Prevent duplicate users: if a user with same name exists, require
    // either a different role or a different phone number. In other words,
    // reject if a user exists with the same name AND same role AND same/empty phone.
    const existingWithName = await userRepository.findByName(data.name);
    if (existingWithName && existingWithName.length > 0) {
      for (const ex of existingWithName) {
        const existingRoleName = (ex as any).role?.name;
        const incomingRoleName = role.name;
        const existingPhone = (ex as any).phone;
        const incomingPhone = data.phone;

        if (existingRoleName === incomingRoleName) {
          // If both phones exist and are identical -> duplicate
          if (incomingPhone && existingPhone && incomingPhone === existingPhone) {
            throw new BadRequestError('A user with the same name, role and phone already exists');
          }

          // If either existing or incoming phone is missing, we consider this a potential duplicate
          if (!incomingPhone || !existingPhone) {
            throw new BadRequestError(
              'A user with the same name and role already exists. Use a different phone number or role.',
            );
          }

          // If phones are both present and different, allow creation
        }
      }
    }

    // Hash password
    const hashedPassword = await Security.hashPassword(data.password);

    return userRepository.create({
      name: data.name,
      email: data.email,
      phone: data.phone,
      password: hashedPassword,
      role: { connect: { id: data.roleId } },
      isActive: data.isActive !== undefined ? data.isActive : true,
    });
  }

  async updateUser(
    id: string,
    data: {
      name?: string;
      email?: string;
      phone?: string;
      password?: string;
      roleId?: number;
      isActive?: boolean;
    },
  ) {
    const user = await userRepository.findById(id);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    const updateData: any = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    // Handle email update
    if (data.email !== undefined && data.email !== user.email) {
      const existingEmail = await userRepository.findByEmail(data.email);
      if (existingEmail) {
        throw new BadRequestError('Email already exists');
      }
      updateData.email = data.email;
    }

    // Handle phone update
    if (data.phone !== undefined && data.phone !== user.phone) {
      const existingPhone = await userRepository.findByPhone(data.phone);
      if (existingPhone) {
        throw new BadRequestError('Phone already exists');
      }
      updateData.phone = data.phone;
    }

    // Handle password update
    if (data.password) {
      updateData.password = await Security.hashPassword(data.password);
    }

    // Handle role update
    if (data.roleId !== undefined) {
      const role = await roleRepository.findById(data.roleId);
      if (!role) {
        throw new BadRequestError('Invalid role');
      }
      updateData.role = { connect: { id: data.roleId } };
    }

    return userRepository.update(id, updateData);
  }

  async deleteUser(id: string) {
    const user = await userRepository.findById(id);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    return userRepository.delete(id);
  }
}
