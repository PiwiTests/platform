# Authentication Implementation Summary

## Overview

This PR implements a complete user authentication system for the Playwright Dashboard with three distinct roles: **administrator**, **reporter**, and **user**.

## Key Features

### 1. Role-Based Access Control

- **Administrator**: Full access to all features
  - Can view all pages and data
  - Can edit projects (PUT `/api/projects/:id`)
  - Can submit test results
  - Full dashboard access

- **Reporter**: Limited to API submission
  - Can submit test results via POST `/api/test-runs/submit`
  - Can upload test results via POST `/api/test-runs/upload`
  - Cannot access dashboard UI when auth is enabled

- **User**: Read-only access
  - Can view all dashboard pages
  - Can view all test results and projects
  - Cannot edit or submit data

### 2. Environment-Based Configuration

Authentication is **disabled by default** and can be enabled via environment variables:

```bash
NUXT_AUTH_ENABLED=true
NUXT_AUTH_SECRET=your-secret-key-here
```

When disabled, the dashboard works exactly as before with no authentication requirements.

### 3. Database Schema

Added `users` table with the following structure:
- `id`: Primary key
- `username`: Unique username
- `password`: SHA-256 hashed password
- `role`: One of 'administrator', 'reporter', 'user'
- `name`: Optional display name
- `created_at`, `updated_at`: Timestamps

### 4. API Endpoints

#### Authentication Endpoints
- `GET /api/auth/me` - Get current user session
- `POST /api/auth/login` - Login with username/password
- `POST /api/auth/logout` - Logout and clear session
- `POST /api/auth/setup` - Create initial admin user (only works when no users exist)

#### Protected Endpoints
- `POST /api/test-runs/submit` - Requires `reporter` or `administrator` role
- `POST /api/test-runs/upload` - Requires `reporter` or `administrator` role
- `PUT /api/projects/:id` - Requires `administrator` role
- All GET endpoints remain public (no authentication required)

### 5. UI Components

#### Login Page (`/login`)
- Clean, simple login form
- Username and password fields
- Error handling with user-friendly messages
- Automatic redirect to home page on success

#### User Menu
- Shows username when authenticated
- Logout option in dropdown menu
- Falls back to "Configuration" when auth is disabled

#### Route Protection
- Global middleware checks authentication status
- Redirects to `/login` if not authenticated (when auth is enabled)
- Protects edit routes from non-administrator users

### 6. Session Management

- Sessions stored in encrypted HTTP-only cookies
- 7-day session expiration
- Uses Nuxt's built-in `sealData`/`unsealData` for encryption
- Secure cookie settings in production (HTTPS only)

### 7. Security Features

- Password hashing using SHA-256
- Encrypted session cookies
- HTTP-only cookies (not accessible via JavaScript)
- CSRF protection via same-site cookies
- No authentication tokens or passwords exposed in URLs

## Implementation Files

### Backend
- `server/database/schema.ts` - Users table schema
- `server/database/index.ts` - Database initialization with users table
- `server/utils/auth.ts` - Authentication utilities (session, hashing, authorization)
- `server/api/auth/login.post.ts` - Login endpoint
- `server/api/auth/logout.post.ts` - Logout endpoint
- `server/api/auth/me.get.ts` - Current user endpoint
- `server/api/auth/setup.post.ts` - Initial setup endpoint
- `server/api/projects/[id].put.ts` - Updated with auth check
- `server/api/test-runs/submit.post.ts` - Updated with auth check
- `server/api/test-runs/upload.post.ts` - Updated with auth check

### Frontend
- `app/pages/login.vue` - Login page
- `app/middleware/auth.global.ts` - Global authentication middleware
- `app/composables/useAuth.ts` - Authentication composable
- `app/components/UserMenu.vue` - Updated with user info and logout

### Configuration
- `.env.example` - Added auth environment variables
- `nuxt.config.ts` - Added runtime config for auth
- `AUTHENTICATION.md` - Complete setup documentation

### Tests
- `tests/authentication.spec.ts` - Authentication test suite

## Testing

The implementation includes comprehensive tests that verify:
- Authentication works correctly when disabled (default behavior)
- API endpoints are accessible without auth when disabled
- Login endpoint correctly rejects attempts when auth is disabled
- Project editing works without auth when disabled

All tests pass successfully.

## Backward Compatibility

✅ **100% Backward Compatible**

When `NUXT_AUTH_ENABLED` is not set or set to `false`:
- All endpoints work exactly as before
- No login required
- No authentication checks
- All existing functionality preserved

## Setup Instructions

See [AUTHENTICATION.md](./AUTHENTICATION.md) for complete setup instructions including:
- Enabling authentication
- Creating the initial admin user
- Managing users
- Security considerations

## Future Enhancements

Potential improvements for future versions:
- API key authentication for reporters
- User management UI for administrators
- Password reset functionality
- Stronger password hashing (bcrypt, argon2)
- Two-factor authentication
- Session management UI
- Role-based permissions UI

## Technical Notes

### Password Hashing
Currently uses SHA-256 for password hashing. While adequate for initial implementation, consider upgrading to bcrypt or argon2 for production use as they are designed specifically for password hashing with built-in salting and configurable work factors.

### Session Storage
Sessions are stored in cookies rather than a database, making the system stateless and easier to scale. The h3 framework's `sealData`/`unsealData` functions provide AES-256-GCM encryption.

### Role Checking
Role-based access control is implemented at both the API level (server-side) and UI level (client-side). Server-side checks are authoritative; client-side checks are for UX only.

## Breaking Changes

None. Authentication is opt-in via environment variable.
