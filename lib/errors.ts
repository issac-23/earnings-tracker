export type DataErrorCode = "NOT_FOUND" | "RATE_LIMIT" | "MISSING_KEY" | "UPSTREAM";

export class DataError extends Error {
  readonly code: DataErrorCode;
  constructor(code: DataErrorCode, message: string) {
    super(message);
    this.name = "DataError";
    this.code = code;
  }
}
