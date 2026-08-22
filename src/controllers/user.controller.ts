import { Response, NextFunction } from 'express';
import { ApiResponse } from '../lib/apiResponse';
import { UserDeviceRepository } from '../repositories/userDevice.repository';
import { UserService } from '../services/user.service';
import { NotificationService } from '../services/notification.service';
import { EmailService } from '../services/email.service';
import { UserRepository } from '../repositories/user.repository';
import { AuthenticatedRequest } from '../types/authenticated-request';
const userDeviceRepository = new UserDeviceRepository();
const userService = new UserService();
const notificationService = new NotificationService();
const emailService = new EmailService();
const userRepository = new UserRepository();

export class UserController {
  async getAllUsers(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const users = await userService.getAllUsers();
      // Remove password from response and format role
      const safeUsers = users.map((user: any) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { password, ...userWithoutPassword } = user;
        return {
          ...userWithoutPassword,
          role: (user as { role?: { name: string } }).role?.name || null,
        };
      });
      // Ensure we return an array, even if empty
      res.status(200).json(ApiResponse.success(safeUsers || []));
    } catch (error) {
      next(error);
    }
  }

  async getSalesUserDeviceStatus(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const deviceStatus = await userService.getSalesUserDeviceStatus();
      res.status(200).json(ApiResponse.success(deviceStatus));
    } catch (error) {
      next(error);
    }
  }

  async getSalesUserDeviceStatusDebug(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const deviceStatus = await userService.getSalesUserDeviceStatusDebug();
      res.status(200).json(ApiResponse.success(deviceStatus));
    } catch (error) {
      next(error);
    }
  }

  async getUserById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const user = await userService.getUserById(id);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password, ...safeUser } = user;
      res.status(200).json(
        ApiResponse.success({
          ...safeUser,
          role: (user as { role?: { name: string } }).role?.name || null,
        }),
      );
    } catch (error) {
      next(error);
    }
  }

  async createUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const user = await userService.createUser(req.body);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password, ...safeUser } = user;
      // Send in-app notifications to owner/manager/admin (exclude actor)
      try {
        const actorId = (req.user as any)?.id;
        const actorLabel = (req.user as any)?.name || 'System';
        const targetRoles = ['owner', 'manager', 'admin'];
        const recipients = await userRepository.findByRoles(targetRoles);
        const recipientIds = recipients
          .filter((u: any) => !actorId || u.id !== actorId)
          .map((u: any) => u.id);

        if (recipientIds.length > 0) {
          const title = `New user created: ${user.name}`;
          const body = `${actorLabel} created a new user ${user.name} (${(user as any).role?.name || (user as any).role || 'N/A'}).`;
          await notificationService.notifyUsers(recipientIds, title, body, `/users/${user.id}`);
        }

        // Send welcome email to created user if email provided
        if ((user as any).email) {
          const to = (user as any).email;
          const subject = 'Welcome to Shubham Advertise';
          const text = `Hello ${user.name},\n\nYour account has been created. Login with your email to access the Hoarding Management system.\n\nRegards,\nShubham Advertise`;
          await emailService.sendEmail({ to, subject, text });
        }
      } catch (notifyErr) {
        // Log and continue - do not block user creation on notification/email failures
        console.error('Error sending user creation notifications/emails:', notifyErr);
      }

      res.status(201).json(
        ApiResponse.success(
          {
            ...safeUser,
            role: (user as { role?: { name: string } }).role?.name || null,
          },
          'User created successfully',
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  async updateUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const user = await userService.updateUser(id, req.body);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password, ...safeUser } = user;
      res.status(200).json(
        ApiResponse.success(
          {
            ...safeUser,
            role: (user as { role?: { name: string } }).role?.name || null,
          },
          'User updated successfully',
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  async deleteUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await userService.deleteUser(id);
      res.status(200).json(ApiResponse.success(null, 'User deleted successfully'));
    } catch (error) {
      next(error);
    }
  }

  async getUserDevices(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { userId } = req.params;
      const devices = await userDeviceRepository.findByUserId(userId);
      res.status(200).json(ApiResponse.success(devices));
    } catch (error) {
      next(error);
    }
  }

  async revokeDevice(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { deviceId } = req.params;
      await userDeviceRepository.revoke(deviceId);
      res.status(200).json(ApiResponse.success(null, 'Device revoked'));
    } catch (error) {
      next(error);
    }
  }
}
