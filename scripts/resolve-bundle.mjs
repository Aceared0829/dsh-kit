import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const anchor = process.argv[2]
const name = process.argv[3]
if (!anchor || !name || !existsSync(anchor)) process.exit(1)
try {
  createRequire(anchor).resolve(name + '/package.json')
  process.exit(0)
} catch {
  process.exit(1)
}
