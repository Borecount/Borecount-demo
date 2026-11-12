/** Safe client error understood by the host's shared domain-error responder. */
export class LibraryInputError extends Error {
  readonly code = 'INVALID_INPUT';
  readonly httpStatus = 400;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LibraryInputError';
  }
}
