// Application error with a machine-readable code and optional field list.
export class AppError extends Error {
  constructor(code, extra = {}) {
    super(code);
    this.name = 'AppError';
    this.code = code;
    this.fields = extra.fields;
  }
}
