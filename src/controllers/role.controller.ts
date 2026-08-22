import { Response, NextFunction } from 'express';
import { ApiResponse } from '../lib/apiResponse';
import { RoleService } from '../services/role.service';
import { AuthenticatedRequest } from '../types/authenticated-request';

const roleService = new RoleService();

export class RoleController {
    async getAllRoles(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const roles = await roleService.getAllRoles();
            res.status(200).json(ApiResponse.success(roles));
        } catch (error) {
            next(error);
        }
    }

    async getRoleById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            const role = await roleService.getRoleById(parseInt(id));
            res.status(200).json(ApiResponse.success(role));
        } catch (error) {
            next(error);
        }
    }

    async createRole(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const role = await roleService.createRole(req.body);
            res.status(201).json(ApiResponse.success(role, 'Role created successfully'));
        } catch (error) {
            next(error);
        }
    }

    async updateRole(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            const role = await roleService.updateRole(parseInt(id), req.body);
            res.status(200).json(ApiResponse.success(role, 'Role updated successfully'));
        } catch (error) {
            next(error);
        }
    }

    async deleteRole(req: AuthenticatedRequest, res: Response, next: NextFunction) {
        try {
            const { id } = req.params;
            await roleService.deleteRole(parseInt(id));
            res.status(200).json(ApiResponse.success(null, 'Role deleted successfully'));
        } catch (error) {
            next(error);
        }
    }
}

