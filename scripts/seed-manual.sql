-- Manual Seed Script for Database
-- Run this if Prisma seed fails due to connection issues
-- Password hash for 'Password@123': $2b$10$GgeNf4P1YGLZRVL3pbQaHuL4mSXCERyAtnTV0vQq18SUvJqVJZK3W

-- 1. Create Roles (if not exists)
INSERT INTO "Role" (name) VALUES ('owner') ON CONFLICT (name) DO NOTHING;
INSERT INTO "Role" (name) VALUES ('manager') ON CONFLICT (name) DO NOTHING;
INSERT INTO "Role" (name) VALUES ('sales') ON CONFLICT (name) DO NOTHING;
INSERT INTO "Role" (name) VALUES ('designer') ON CONFLICT (name) DO NOTHING;
INSERT INTO "Role" (name) VALUES ('fitter') ON CONFLICT (name) DO NOTHING;

-- 2. Create Users (upsert - won't duplicate if exists)
INSERT INTO "User" (id, name, email, password, "roleId", "isActive", "createdAt", "updatedAt")
SELECT 
    gen_random_uuid()::text,
    'Owner User',
    'owner@demo.com',
    '$2b$10$GgeNf4P1YGLZRVL3pbQaHuL4mSXCERyAtnTV0vQq18SUvJqVJZK3W',
    (SELECT id FROM "Role" WHERE name = 'owner' LIMIT 1),
    true,
    NOW(),
    NOW()
WHERE NOT EXISTS (SELECT 1 FROM "User" WHERE email = 'owner@demo.com');

INSERT INTO "User" (id, name, email, password, "roleId", "isActive", "createdAt", "updatedAt")
SELECT 
    gen_random_uuid()::text,
    'Manager User',
    'manager@demo.com',
    '$2b$10$GgeNf4P1YGLZRVL3pbQaHuL4mSXCERyAtnTV0vQq18SUvJqVJZK3W',
    (SELECT id FROM "Role" WHERE name = 'manager' LIMIT 1),
    true,
    NOW(),
    NOW()
WHERE NOT EXISTS (SELECT 1 FROM "User" WHERE email = 'manager@demo.com');

INSERT INTO "User" (id, name, email, password, "roleId", "isActive", "createdAt", "updatedAt")
SELECT 
    gen_random_uuid()::text,
    'Sales User',
    'sales@demo.com',
    '$2b$10$GgeNf4P1YGLZRVL3pbQaHuL4mSXCERyAtnTV0vQq18SUvJqVJZK3W',
    (SELECT id FROM "Role" WHERE name = 'sales' LIMIT 1),
    true,
    NOW(),
    NOW()
WHERE NOT EXISTS (SELECT 1 FROM "User" WHERE email = 'sales@demo.com');

INSERT INTO "User" (id, name, email, password, "roleId", "isActive", "createdAt", "updatedAt")
SELECT 
    gen_random_uuid()::text,
    'Designer User',
    'designer@demo.com',
    '$2b$10$GgeNf4P1YGLZRVL3pbQaHuL4mSXCERyAtnTV0vQq18SUvJqVJZK3W',
    (SELECT id FROM "Role" WHERE name = 'designer' LIMIT 1),
    true,
    NOW(),
    NOW()
WHERE NOT EXISTS (SELECT 1 FROM "User" WHERE email = 'designer@demo.com');

INSERT INTO "User" (id, name, email, password, "roleId", "isActive", "createdAt", "updatedAt")
SELECT 
    gen_random_uuid()::text,
    'Fitter User',
    'fitter@demo.com',
    '$2b$10$GgeNf4P1YGLZRVL3pbQaHuL4mSXCERyAtnTV0vQq18SUvJqVJZK3W',
    (SELECT id FROM "Role" WHERE name = 'fitter' LIMIT 1),
    true,
    NOW(),
    NOW()
WHERE NOT EXISTS (SELECT 1 FROM "User" WHERE email = 'fitter@demo.com');

-- Verify users were created
SELECT name, email, (SELECT name FROM "Role" WHERE id = "User"."roleId") as role FROM "User";
