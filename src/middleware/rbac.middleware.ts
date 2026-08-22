import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/authenticated-request';
import { ForbiddenError } from '../lib/errors';

export const authorize = (roles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new ForbiddenError('User not authenticated'));
    }

    const roleField = (req.user as any)?.role;
    const userRole = String(
      (typeof roleField === 'string' ? roleField : roleField?.name) ??
        (req.user as any)?.roleName ??
        '',
    )
      .toLowerCase()
      .trim();
    const allowedRoles = (roles || []).map((r) => String(r).toLowerCase().trim());

    if (!allowedRoles.includes(userRole)) {
      return next(new ForbiddenError(`Insufficient permissions (role: ${userRole || 'unknown'})`));
    }

    // Territory enforcement for 'sales' role
    if (userRole === 'sales') {
      // We don't block here, but we ensure the user has territories assigned if required.
      // The actual filtering happens in the service layer (HoardingService).
      // However, we can attach the territory IDs to the request for easier access if not already there.
      // They are already in req.user.territories.
    }

    next();
  };
};
