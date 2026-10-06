export class WorkflowCommandError extends Error {
  constructor(message: string, readonly status: 404 | 409) { super(message); }
}
