import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { authorize, type Actor, type Action } from '@scribe/core';

/** Current actor from the session, or null if unauthenticated. */
export async function getActor(): Promise<Actor | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return { id: session.user.id, role: session.user.role };
}

/** Require an authenticated actor; redirect to /login otherwise. */
export async function requireActor(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect('/login');
  return actor;
}

/** Require an actor authorized for `action`; throws AuthorizationError if denied. */
export async function requireCan(action: Action): Promise<Actor> {
  const actor = await requireActor();
  authorize(actor, action);
  return actor;
}
