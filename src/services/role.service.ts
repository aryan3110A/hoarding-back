import { RoleRepository } from '../repositories/role.repository';
import { BadRequestError, NotFoundError } from '../lib/errors';

const roleRepository = new RoleRepository();

export class RoleService {
    async getAllRoles() {
        return roleRepository.findAll();
    }

    async getRoleById(id: number) {
        const role = await roleRepository.findById(id);
        if (!role) {
            throw new NotFoundError('Role not found');
        }
        return role;
    }

    async createRole(data: { name: string }) {
        // Check if role already exists
        const existing = await roleRepository.findByName(data.name.toLowerCase());
        if (existing) {
            throw new BadRequestError('Role already exists');
        }

        return roleRepository.create({
            name: data.name.toLowerCase(),
        });
    }

    async updateRole(id: number, data: { name: string }) {
        const role = await roleRepository.findById(id);
        if (!role) {
            throw new NotFoundError('Role not found');
        }

        // Check if new name already exists (and is not the current role)
        if (data.name.toLowerCase() !== role.name) {
            const existing = await roleRepository.findByName(data.name.toLowerCase());
            if (existing) {
                throw new BadRequestError('Role name already exists');
            }
        }

        return roleRepository.update(id, {
            name: data.name.toLowerCase(),
        });
    }

    async deleteRole(id: number) {
        const role = await roleRepository.findById(id);
        if (!role) {
            throw new NotFoundError('Role not found');
        }

        // Check if role is in use
        const userCount = (role as any)._count?.users || 0;
        if (userCount > 0) {
            throw new BadRequestError(`Cannot delete role: ${userCount} user(s) are assigned to this role`);
        }

        return roleRepository.delete(id);
    }
}

