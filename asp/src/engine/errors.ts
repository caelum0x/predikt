// Shared service error type. Lives in its own module so engine submodules
// (orders, trades) can throw typed errors without importing the full
// MarketService module and creating import cycles.

export class ServiceError extends Error {
  readonly status: 400 | 401 | 402 | 403 | 404 | 409
  constructor(status: 400 | 401 | 402 | 403 | 404 | 409, message: string) {
    super(message)
    this.name = 'ServiceError'
    this.status = status
  }
}
