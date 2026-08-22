import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const trackedPaths = execFileSync('git', ['ls-files', '-z'], {
  cwd: repoRoot,
  encoding: 'utf8',
})

const errors = []
const docSymlinks = []

for (const trackedPath of trackedPaths.split('\0').filter(Boolean)) {
  if (!trackedPath.toLowerCase().endsWith('.md')) continue
  const linkPath = resolve(repoRoot, trackedPath)
  try {
    if (!lstatSync(linkPath).isSymbolicLink()) continue
    docSymlinks.push(trackedPath)
    const resolvedPath = realpathSync(linkPath)
    const relativePath = relative(repoRoot, resolvedPath)
    if (isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
      errors.push(`${trackedPath}: resolves outside the repository`)
    } else if (!statSync(resolvedPath).isFile()) {
      errors.push(`${trackedPath}: does not resolve to a file`)
    }
  } catch (error) {
    errors.push(`${trackedPath}: ${error.code || error.message}`)
  }
}

const rootGuides = ['AGENTS.md', 'CLAUDE.md']
const rootGuideTargets = []
for (const guide of rootGuides) {
  try {
    const contents = readFileSync(resolve(repoRoot, guide), 'utf8').trim()
    if (!contents) errors.push(`${guide}: guide is empty`)
    rootGuideTargets.push(realpathSync(resolve(repoRoot, guide)))
  } catch (error) {
    errors.push(`${guide}: ${error.code || error.message}`)
  }
}

if (new Set(rootGuideTargets).size > 1) {
  errors.push('AGENTS.md and CLAUDE.md do not resolve to the same canonical guide')
}

if (errors.length) {
  for (const error of errors) console.error(`documentation link error: ${error}`)
  process.exit(1)
}

console.log(`Verified ${docSymlinks.length} tracked Markdown symlink(s) and both root agent guides.`)
