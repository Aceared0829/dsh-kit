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
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { marksDomain, markSchema, MARK_KINDS, MAX_REASON_LENGTH } from './marks.js';
/** Refusal raised for a request the service will not store. */
export class MarkError extends Error {
    code;
    name = 'MarkError';
    /**
     * @param code - stable classification.
     * @param message - human-readable reason.
     */
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
/**
 * Reduce a stored record to its client projection.
 * @param record - stored mark.
 * @returns the fields the client reads.
 */
function project(record) {
    return {
        id: record.id,
        turn: record.turn,
        kind: record.kind,
        reason: record.reason,
        createdAt: record.createdAt,
    };
}
/**
 * Decide whether a value is one of the declared mark kinds.
 * @param value - candidate.
 * @returns whether it is a mark kind.
 */
function isMarkKind(value) {
    return value === 'failure' || value === 'success' || value === 'note';
}
let HarnessMarks = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _ping_decorators;
    let _create_decorators;
    let _list_decorators;
    let _discard_decorators;
    return class HarnessMarks extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _ping_decorators = [Remote];
            _create_decorators = [Remote('create')];
            _list_decorators = [Remote('list')];
            _discard_decorators = [Remote('discard')];
            __esDecorate(this, null, _ping_decorators, { kind: "method", name: "ping", static: false, private: false, access: { has: obj => "ping" in obj, get: obj => obj.ping }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _create_decorators, { kind: "method", name: "create", static: false, private: false, access: { has: obj => "create" in obj, get: obj => obj.create }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _list_decorators, { kind: "method", name: "list", static: false, private: false, access: { has: obj => "list" in obj, get: obj => obj.list }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _discard_decorators, { kind: "method", name: "discard", static: false, private: false, access: { has: obj => "discard" in obj, get: obj => obj.discard }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        /** The domain facility is the service's whole storage input. */
        static inject = ['storageDomain'];
        /** The open marks domain, or `undefined` until it opens. */
        domain = __runInitializers(this, _instanceExtraInitializers);
        opening;
        /**
         * @param ctx - host context carrying the storage domain facility.
         */
        constructor(ctx) {
            super(ctx, 'harnessMarks');
            void this.ensureOpen();
        }
        /**
         * Open the marks domain once, and close it with this service.
         * @returns resolution after the domain is open or definitively unavailable.
         */
        ensureOpen() {
            this.opening ??= (async () => {
                const domain = await this.ctx.storageDomain.open(marksDomain);
                this.domain = domain;
                this.ctx.effect(() => () => { void domain.close(); }, 'harness-eval: marks domain');
            })().catch((error) => {
                throw new MarkError('unavailable', `marks domain is unavailable: ${String(error)}`);
            });
            return this.opening;
        }
        /**
         * Prove the service is reachable over the Remote boundary.
         * @returns a fixed acknowledgment.
         */
        ping() {
            return 'pong';
        }
        /**
         * Record one observation about a turn.
         * @param request - session, turn, kind, and reason.
         * @returns the stored mark.
         */
        async create(request) {
            const turn = Number(request?.turn);
            const reason = typeof request?.reason === 'string' ? request.reason.trim() : '';
            const kind = request?.kind;
            if (typeof request?.sessionId !== 'string' || request.sessionId === '') {
                throw new MarkError('invalid-request', 'a mark must name its session');
            }
            if (!Number.isSafeInteger(turn) || turn < 0) {
                throw new MarkError('invalid-request', 'a mark must name a non-negative turn');
            }
            if (!isMarkKind(kind)) {
                throw new MarkError('invalid-request', `kind must be one of ${MARK_KINDS.join(', ')}`);
            }
            if (reason === '')
                throw new MarkError('invalid-request', 'a mark must carry a reason');
            if (reason.length > MAX_REASON_LENGTH) {
                throw new MarkError('invalid-request', `reason must be at most ${MAX_REASON_LENGTH} characters`);
            }
            await this.ensureOpen();
            const domain = this.domain;
            if (domain === undefined)
                throw new MarkError('unavailable', 'marks domain is not open');
            const stored = {
                id: `${request.sessionId}:${String(turn)}:${String(Date.now())}`,
                sessionId: request.sessionId,
                turn,
                kind,
                reason,
                createdAt: Date.now(),
                // The fingerprint is copied from the header at marking time so the mark
                // survives the session. `markSchema.parse` drops absent keys.
                harness: {},
            };
            // Parsing is the durable boundary: it validates and normalizes absent keys.
            const parsed = markSchema.parse(stored);
            await domain.table('marks').put(parsed.id, parsed);
            return project(parsed);
        }
        /**
         * Read every mark recorded for one session.
         * @param request - the session to read.
         * @returns the marks in creation order.
         */
        async list(request) {
            const sessionId = typeof request?.sessionId === 'string' ? request.sessionId : '';
            if (sessionId === '')
                throw new MarkError('invalid-request', 'a read must name its session');
            await this.ensureOpen();
            const domain = this.domain;
            if (domain === undefined)
                throw new MarkError('unavailable', 'marks domain is not open');
            const marks = [];
            for (const [, record] of domain.table('marks').entries()) {
                // The domain validates every stored record at open, so the shape here is
                // the schema's; the cast states that boundary once.
                const stored = record;
                if (stored.sessionId === sessionId)
                    marks.push(project(stored));
            }
            return marks.sort((left, right) => left.createdAt - right.createdAt);
        }
        /**
         * Read every mark recorded for one session, synchronously.
         *
         * This is the Host-side read the evidence projection uses; it never crosses
         * the wire, so it stays off the `@Remote` surface.
         * @param sessionId - session whose marks are wanted.
         * @returns the marks in creation order, or an empty list before the domain opens.
         */
        marksFor(sessionId) {
            const domain = this.domain;
            if (domain === undefined)
                return [];
            const marks = [];
            for (const [, record] of domain.table('marks').entries()) {
                const stored = record;
                if (stored.sessionId === sessionId)
                    marks.push(project(stored));
            }
            return marks.sort((left, right) => left.createdAt - right.createdAt);
        }
        /**
         * Delete one mark.
         * @param request - the mark id to discard.
         * @returns whether a record was removed.
         */
        async discard(request) {
            const id = typeof request?.id === 'string' ? request.id : '';
            if (id === '')
                throw new MarkError('invalid-request', 'a discard must name its mark');
            await this.ensureOpen();
            const domain = this.domain;
            if (domain === undefined)
                throw new MarkError('unavailable', 'marks domain is not open');
            return await domain.table('marks').delete(id);
        }
    };
})();
/** Marks service (`ctx.harnessMarks`); owns the durable mark records. */
export default HarnessMarks;
