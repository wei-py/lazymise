import packageJson from '../package.json' with { type: 'json' }

const tag = process.env.RELEASE_TAG || (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : null)
const expectedTag = `v${packageJson.version}`
if (tag && tag !== expectedTag)
  throw new Error(`Release tag "${tag}" does not match package.json. Expected "${expectedTag}" (v<version>, with no dot after v). Create the matching tag on the release commit instead of bypassing this check.`)
