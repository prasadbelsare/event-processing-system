import { ZodError } from 'zod';

// Permanent = retrying can never help, so skip the retries and go straight to the DLQ.
export function isPermanent(err: unknown): boolean {
    return err instanceof ZodError || err instanceof SyntaxError;
}