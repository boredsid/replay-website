import { adminJson } from './auth';

export function handleWhoami(email: string, origin: string): Response {
  return adminJson({ email }, 200, origin);
}
