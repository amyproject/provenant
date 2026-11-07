export class ApiClientError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}
