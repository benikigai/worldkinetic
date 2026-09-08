import { safeError, type ApiError } from '../shared/contracts.js';
export class ExecutionError extends Error {
  constructor(readonly code: string, message: string, readonly retryable = false) {
    super(message);
    this.name = 'ExecutionError';
  }
}

export class ToolExecutionError extends ExecutionError {
  constructor(code: ApiError['code']) { const error = safeError(code); super(error.code, error.message, error.retryable); }
}
