import type { FastifyReply } from 'fastify'

/** One error shape for the whole API, so clients never have to guess. */
export interface ApiError { error: { code: string; message: string; detail?: unknown } }

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly detail?: unknown) {
    super(message)
  }
}

export const badRequest = (m: string, d?: unknown) => new HttpError(400, 'BAD_REQUEST', m, d)
export const notFound = (m: string) => new HttpError(404, 'NOT_FOUND', m)
export const unauthorized = (m = 'No session') => new HttpError(401, 'UNAUTHORIZED', m)

export function send(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof HttpError) {
    const body: ApiError = { error: { code: err.code, message: err.message } }
    if (err.detail !== undefined) body.error.detail = err.detail
    return reply.status(err.status).send(body)
  }
  const message = err instanceof Error ? err.message : 'Unexpected error'
  return reply.status(500).send({ error: { code: 'INTERNAL', message } } satisfies ApiError)
}
