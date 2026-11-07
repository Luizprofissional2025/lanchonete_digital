export class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message)
    this.status = status
    this.details = details
  }
}

export const fail = (status, message, details) => {
  throw new HttpError(status, message, details)
}
