const process = require('node:process')
const koffi = require('koffi')

// Only the portable ABI used by OpenTUI's Node backend is exposed here.
const types = {
  char: 'char',
  i8: 'int8_t',
  u8: 'uint8_t',
  i16: 'int16_t',
  u16: 'uint16_t',
  i32: 'int32_t',
  u32: 'uint32_t',
  i64: 'int64_t',
  u64: 'uint64_t',
  f32: 'float',
  f64: 'double',
  bool: 'bool',
  pointer: 'void *',
  string: 'str',
  void: 'void',
}
function type(name) {
  if (!Object.hasOwn(types, name))
    throw new TypeError(`Unsupported OpenTUI FFI type: ${name}`)
  return types[name]
}
function pointer(value) {
  return value == null ? 0n : koffi.address(value)
}
function result(value, kind) {
  if (kind === 'pointer')
    return pointer(value)
  if (kind === 'i64' || kind === 'u64')
    return BigInt(value)
  return value
}

module.exports = {
  suffix: process.platform === 'win32' ? 'dll' : process.platform === 'darwin' ? 'dylib' : 'so',
  getRawPointer: pointer,
  toArrayBuffer(address, length) {
    return koffi.view(address, length)
  },
  dlopen(path, definitions) {
    const library = koffi.load(path)
    const callbacks = new Set()
    const functions = {}
    for (const [name, definition] of Object.entries(definitions)) {
      const fn = library.func(name, type(definition.return), definition.arguments.map(type))
      const booleans = definition.arguments.flatMap((kind, index) => kind === 'bool' ? [index] : [])
      functions[name] = (...args) => {
        for (const index of booleans)
          args[index] = Boolean(args[index])
        return result(fn(...args), definition.return)
      }
    }
    let closed = false
    return {
      functions,
      lib: {
        registerCallback(definition, callback) {
          if (closed)
            throw new Error('Native library is closed')
          const prototype = koffi.proto(type(definition.return), definition.arguments.map(type))
          const native = koffi.register((...args) => callback(...args.map((value, index) => result(value, definition.arguments[index]))), koffi.pointer(prototype))
          callbacks.add(native)
          return pointer(native)
        },
        unregisterCallback(address) {
          for (const native of callbacks) {
            if (pointer(native) === address) {
              koffi.unregister(native)
              callbacks.delete(native)
              return
            }
          }
        },
        close() {
          if (closed)
            return
          closed = true
          for (const native of callbacks)
            koffi.unregister(native)
          callbacks.clear()
          library.unload()
        },
      },
    }
  },
}
