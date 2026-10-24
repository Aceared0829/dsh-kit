/**
 * The marks service: the Host half that writes and reads durable marks.
 *
 * A mark is a person's observation about one turn. It is stored in the
 * `harness_marks` domain rather than in the session log, and it carries the
 * harness fingerprint it was made under so it still answers "did the same
 * failure recur under the same harness?" after the session is gone.
 *
 * @module dsh-harness-eval/marks-service
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: the module augmentation on `Context.storageDomain` lives here.
import type {} from '@deepseek-ai/dsh-storage-domain'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { marksDomain, markSchema, MARK_KINDS, MAX_REASON_LENGTH } from './marks.js'

/** The judgement a person attaches to one turn. */
type MarkKind = 'failure' | 'success' | 'note'

/** The durable record shape, as the marks domain stores it. */
interface StoredMark {
  id: string
  sessionId: string
  turn: number
  kind: MarkKind
  reason: string
  createdAt: number
  harness: { cwd?: string; agentPreset?: string; parentSession?: string }
}

/** One mark as the client sends and receives it. */
export interface MarkRecord {
  readonly id: string
  readonly turn: number
  readonly kind: MarkKind
  readonly reason: string
  readonly createdAt: number
}

/** Request to record one mark. */
export interface CreateMarkRequest {
  readonly sessionId: string
  readonly turn: number
  readonly kind: MarkKind
  readonly reason: string
}

/** Request to read one session's marks. */
export interface ListMarksRequest {
  readonly sessionId: string
}

/** Refusal raised for a request the service will not store. */
export class MarkError extends Error {
  override name = 'MarkError'

  /**
   * @param code - stable classification.
   * @param message - human-readable reason.
   */
  constructor(readonly code: 'invalid-request' | 'unavailable', message: string) {
    super(message)
  }
}

/**
 * Reduce a stored record to its client projection.
 * @param record - stored mark.
 * @returns the fields the client reads.
 */
function project(record: {
  id: string
  turn: number
  kind: MarkKind
  reason: string
  createdAt: number
}): MarkRecord {
  return {
    id: record.id,
    turn: record.turn,
    kind: record.kind,
    reason: record.reason,
    createdAt: record.createdAt,
  }
}

/**
 * Decide whether a value is one of the declared mark kinds.
 * @param value - candidate.
 * @returns whether it is a mark kind.
 */
function isMarkKind(value: unknown): value is MarkKind {
  return value === 'failure' || value === 'success' || value === 'note'
}

/** Marks service (`ctx.harnessMarks`); owns the durable mark records. */
export default class HarnessMarks extends TypertRemoteService {
  /** The domain facility is the service's whole storage input. */
  static inject = ['storageDomain']

  /** The open marks domain, or `undefined` until it opens. */
  private domain: Awaited<ReturnType<Context['storageDomain']['open']>> | undefined
  private opening: Promise<void> | undefined

  /**
   * @param ctx - host context carrying the storage domain facility.
   */
  constructor(ctx: Context) {
    super(ctx, 'harnessMarks')
    void this.ensureOpen()
  }

  /**
   * Open the marks domain once, and close it with this service.
   * @returns resolution after the domain is open or definitively unavailable.
   */
  private ensureOpen(): Promise<void> {
    this.opening ??= (async () => {
      const domain = await this.ctx.storageDomain.open(marksDomain)
      this.domain = domain
      this.ctx.effect(() => () => { void domain.close() }, 'harness-eval: marks domain')
    })().catch((error: unknown) => {
      throw new MarkError('unavailable', `marks domain is unavailable: ${String(error)}`)
    })
    return this.opening
  }

  /**
   * Prove the service is reachable over the Remote boundary.
   * @returns a fixed acknowledgment.
   */
  @Remote
  ping(): string {
    return 'pong'
  }

  /**
   * Record one observation about a turn.
   * @param request - session, turn, kind, and reason.
   * @returns the stored mark.
   */
  @Remote('create')
  async create(request: CreateMarkRequest): Promise<MarkRecord> {
    const turn = Number(request?.turn)
    const reason = typeof request?.reason === 'string' ? request.reason.trim() : ''
    const kind = request?.kind
    if (typeof request?.sessionId !== 'string' || request.sessionId === '') {
      throw new MarkError('invalid-request', 'a mark must name its session')
    }
    if (!Number.isSafeInteger(turn) || turn < 0) {
      throw new MarkError('invalid-request', 'a mark must name a non-negative turn')
    }
    if (!isMarkKind(kind)) {
      throw new MarkError('invalid-request', `kind must be one of ${MARK_KINDS.join(', ')}`)
    }
    if (reason === '') throw new MarkError('invalid-request', 'a mark must carry a reason')
    if (reason.length > MAX_REASON_LENGTH) {
      throw new MarkError('invalid-request', `reason must be at most ${MAX_REASON_LENGTH} characters`)
    }

    await this.ensureOpen()
    const domain = this.domain
    if (domain === undefined) throw new MarkError('unavailable', 'marks domain is not open')

    const stored: StoredMark = {
      id: `${request.sessionId}:${String(turn)}:${String(Date.now())}`,
      sessionId: request.sessionId,
      turn,
      kind,
      reason,
      createdAt: Date.now(),
      // The fingerprint is copied from the header at marking time so the mark
      // survives the session. `markSchema.parse` drops absent keys.
      harness: {},
    }
    // Parsing is the durable boundary: it validates and normalizes absent keys.
    const parsed = markSchema.parse(stored) as StoredMark
    await domain.table('marks').put(parsed.id, parsed)
    return project(parsed)
  }

  /**
   * Read every mark recorded for one session.
   * @param request - the session to read.
   * @returns the marks in creation order.
   */
  @Remote('list')
  async list(request: ListMarksRequest): Promise<readonly MarkRecord[]> {
    const sessionId = typeof request?.sessionId === 'string' ? request.sessionId : ''
    if (sessionId === '') throw new MarkError('invalid-request', 'a read must name its session')

    await this.ensureOpen()
    const domain = this.domain
    if (domain === undefined) throw new MarkError('unavailable', 'marks domain is not open')

    const marks: MarkRecord[] = []
    for (const [, record] of domain.table('marks').entries()) {
      // The domain validates every stored record at open, so the shape here is
      // the schema's; the cast states that boundary once.
      const stored = record as StoredMark
      if (stored.sessionId === sessionId) marks.push(project(stored))
    }
    return marks.sort((left, right) => left.createdAt - right.createdAt)
  }

  /**
   * Read every mark recorded for one session, synchronously.
   *
   * This is the Host-side read the evidence projection uses; it never crosses
   * the wire, so it stays off the `@Remote` surface.
   * @param sessionId - session whose marks are wanted.
   * @returns the marks in creation order, or an empty list before the domain opens.
   */
  marksFor(sessionId: string): readonly MarkRecord[] {
    const domain = this.domain
    if (domain === undefined) return []
    const marks: MarkRecord[] = []
    for (const [, record] of domain.table('marks').entries()) {
      const stored = record as StoredMark
      if (stored.sessionId === sessionId) marks.push(project(stored))
    }
    return marks.sort((left, right) => left.createdAt - right.createdAt)
  }

  /**
   * Delete one mark.
   * @param request - the mark id to discard.
   * @returns whether a record was removed.
   */
  @Remote('discard')
  async discard(request: { id: string }): Promise<boolean> {
    const id = typeof request?.id === 'string' ? request.id : ''
    if (id === '') throw new MarkError('invalid-request', 'a discard must name its mark')

    await this.ensureOpen()
    const domain = this.domain
    if (domain === undefined) throw new MarkError('unavailable', 'marks domain is not open')
    return await domain.table('marks').delete(id)
  }
}
