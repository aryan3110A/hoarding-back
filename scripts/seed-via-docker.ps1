# PowerShell script to seed database via Docker container
# This bypasses the Prisma connection issue from host

Write-Host "Seeding database via Docker container..." -ForegroundColor Green

# First, copy seed file and node_modules into container (if needed)
# Or run the seed script directly with proper environment

# Option 1: Run seed script inside a temporary Node container
Write-Host "`nAttempting to seed via Docker..." -ForegroundColor Yellow

# Check if we can run Node inside postgres container (won't work, need separate container)
# Better: Create a one-time Node container that connects to postgres

Write-Host "`nNote: This requires Node.js to be available in Docker." -ForegroundColor Yellow
Write-Host "Alternative: Use the manual SQL seed or fix DATABASE_URL connection." -ForegroundColor Yellow

# Manual approach: Generate password hash first
Write-Host "`nTo seed manually, you need to:" -ForegroundColor Cyan
Write-Host "1. Generate bcrypt hash for 'Password@123'" -ForegroundColor White
Write-Host "2. Run SQL INSERT statements with the hash" -ForegroundColor White
Write-Host "`nOr use the workaround: Set DATABASE_URL in environment before running seed" -ForegroundColor Yellow






