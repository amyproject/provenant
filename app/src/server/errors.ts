/** Business error with an HTTP status; route handlers turn it into an ApiError body. */
export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiProblem";
  }
}

export const notFound = (what: string, id: string) => new ApiProblem(404, `${what} not found: ${id}`);
export const badRequest = (message: string, details?: unknown) => new ApiProblem(400, message, details);
