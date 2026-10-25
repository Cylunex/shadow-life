import type { OperationError } from "@shadow/contracts";

export class KernelError extends Error {
  constructor(readonly status: number, readonly detail: OperationError) {
    super(detail.message);
  }
}

export function permissionDenied(effect: string): KernelError {
  return new KernelError(403, { protocol: "shadow.error", code: "permission_denied", message: `Missing permission: ${effect}` });
}

export function conflict(message: string): KernelError {
  return new KernelError(409, { protocol: "shadow.error", code: "conflict", message });
}

export function notFound(message: string): KernelError {
  return new KernelError(404, { protocol: "shadow.error", code: "not_found", message });
}

export function invalidInput(message: string, fields?: string[]): KernelError {
  return new KernelError(422, { protocol: "shadow.error", code: "validation", message, ...(fields ? { fields } : {}) });
}

export function retryableNotApplied(message: string): KernelError {
  return new KernelError(503, { protocol:"shadow.error",code:"retryable_not_applied",message });
}
