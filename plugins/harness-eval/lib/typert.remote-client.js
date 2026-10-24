/**
 * Hand-written Remote client projection for the marks namespace.
 *
 * This is the artifact `@deepseek-ai/dsh-typert-generator` would emit for
 * `src/marks-service.ts`. It is written by hand because the generator only runs
 * inside the repository workspace (it locates a root holding both
 * `tsconfig.host.json` and `packages/`), while this plugin is a self-contained
 * bundle outside it. The generated form is a plain
 * `createTypertRemoteInfo(spec, z)` call — the generator contributes type
 * analysis and Zod construction, not runtime behavior — so an equivalent spec
 * written directly is valid input.
 *
 * Host-side discovery does NOT read this file: `api-gateway` finds services by
 * reflecting `typertRemote` and the `@Remote` metadata the decorators write.
 * What this file supplies is the Client side — the descriptors the browser
 * mounts through `ctx.remote.$mount(...)`.
 *
 * Keep it in step with `src/marks-service.ts`. `remote-spec.test.mjs` compares
 * the two so a drift fails a test instead of surfacing as a rejected call.
 *
 * @module dsh-harness-eval/remote-spec
 */

import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'

/** One mark, as the browser receives it. */
const markSchema = z.object({
  id: z.string(),
  turn: z.number(),
  kind: z.enum(['failure', 'success', 'note']),
  reason: z.string(),
  createdAt: z.number(),
})

/** Request to record one mark. */
const createRequestSchema = z.object({
  sessionId: z.string(),
  turn: z.number(),
  kind: z.enum(['failure', 'success', 'note']),
  reason: z.string(),
})

/** Request to read one session's marks. */
const listRequestSchema = z.object({ sessionId: z.string() })

/** Request to discard one mark. */
const discardRequestSchema = z.object({ id: z.string() })

/** The JSON Schema a request type projects to; kept beside its Zod factory. */
const createRequestJson = {
  type: 'object',
  properties: {
    sessionId: { type: 'string' },
    turn: { type: 'number' },
    kind: { type: 'string', enum: ['failure', 'success', 'note'] },
    reason: { type: 'string' },
  },
  required: ['sessionId', 'turn', 'kind', 'reason'],
}

/**
 * Declare one codec pair. Generated artifacts carry both an ordinary and a
 * strict policy even when they agree, so this mirrors that shape.
 * @param factory - the Zod schema instance.
 * @param typeSymbol - source type the codec represents.
 * @param jsonSchema - lossless JSON Schema projection of that type.
 * @returns the `codec` and `strictCodec` entries for one parameter.
 */
function codecs(factory, typeSymbol, jsonSchema) {
  return {
    codec: { mode: 'strict', typeSymbol, create: () => factory, jsonSchema },
    strictCodec: { mode: 'strict', typeSymbol, create: () => factory, jsonSchema },
  }
}

export const TYPERT_REMOTE = createTypertRemoteInfo({
  package: 'dsh-harness-eval',
  methods: {
    'harnessMarks/ping': {
      service: 'harnessMarks',
      description: 'Prove the marks service is reachable over the Remote boundary.',
      invocation: { kind: 'direct' },
      parameters: [],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-harness-eval#harnessMarks/ping:result',
        create: () => z.string(),
        description: 'a fixed acknowledgment.',
        jsonSchema: { type: 'string' },
      },
      sourceLocation: { file: 'plugins/harness-eval/src/marks-service.ts', line: 1, column: 1 },
    },
    'harnessMarks/create': {
      service: 'harnessMarks',
      description: 'Record one observation about a turn.',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'request',
          wire: 'request',
          description: 'session, turn, kind, and reason.',
          ...codecs(createRequestSchema, 'dsh-harness-eval#CreateMarkRequest', createRequestJson),
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-harness-eval#harnessMarks/create:result',
        create: () => markSchema,
        description: 'the stored mark.',
        jsonSchema: { type: 'object' },
      },
      sourceLocation: { file: 'plugins/harness-eval/src/marks-service.ts', line: 40, column: 3 },
    },
    'harnessMarks/list': {
      service: 'harnessMarks',
      description: 'Read every mark recorded for one session.',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'request',
          wire: 'request',
          description: 'the session to read.',
          ...codecs(
            listRequestSchema,
            'dsh-harness-eval#ListMarksRequest',
            { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] },
          ),
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-harness-eval#harnessMarks/list:result',
        create: () => z.array(markSchema),
        description: 'the marks in creation order.',
        jsonSchema: { type: 'array' },
      },
      sourceLocation: { file: 'plugins/harness-eval/src/marks-service.ts', line: 60, column: 3 },
    },
    'harnessMarks/discard': {
      service: 'harnessMarks',
      description: 'Delete one mark.',
      invocation: { kind: 'direct' },
      parameters: [
        {
          name: 'request',
          wire: 'request',
          description: 'the mark id to discard.',
          ...codecs(
            discardRequestSchema,
            'dsh-harness-eval#DiscardMarkRequest',
            { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
          ),
        },
      ],
      result: {
        mode: 'strict',
        typeSymbol: 'dsh-harness-eval#harnessMarks/discard:result',
        create: () => z.boolean(),
        description: 'whether a record was discarded.',
        jsonSchema: { type: 'boolean' },
      },
      sourceLocation: { file: 'plugins/harness-eval/src/marks-service.ts', line: 80, column: 3 },
    },
  },
}, z)

export default TYPERT_REMOTE
