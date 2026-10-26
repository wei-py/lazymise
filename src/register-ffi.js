import { registerHooks } from 'node:module'

// OpenTUI's portable Node facade is backed by Koffi on LTS, not experimental node:ffi.
const adapter = new URL('./ffi.cjs', import.meta.url).href
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'node:ffi')
      return { url: adapter, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})
