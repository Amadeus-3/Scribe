import type { Role } from '@prisma/client';
import type { DefaultSession } from 'next-auth';

// Augment Auth.js types with our `id` + `role` (Spec §10.2 RBAC).
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession['user'];
  }
  interface User {
    role?: Role;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    role?: Role;
    /** Epoch ms of the last role/status re-read from the database. */
    accessCheckedAt?: number;
  }
}
