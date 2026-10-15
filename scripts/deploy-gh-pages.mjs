// Build and publish dist/ to the gh-pages branch of the "origin" remote.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' })
const out = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim()

const remote = out('git remote get-url origin')
run('npm run build')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gh-pages-'))
fs.cpSync('dist', tmp, { recursive: true })
fs.writeFileSync(path.join(tmp, '.nojekyll'), '')

run('git init -q -b gh-pages', tmp)
run('git add -A', tmp)
run('git -c user.name="deploy" -c user.email="deploy@users.noreply.github.com" commit -q -m "Deploy"', tmp)
run(`git push -f "${remote}" gh-pages`, tmp)
fs.rmSync(tmp, { recursive: true, force: true })
console.log('Deployed to gh-pages')
