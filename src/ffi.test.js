import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { test } from '../support/node-test.js'
import ffi from './ffi.cjs'

const libc = process.platform === 'win32' ? 'ucrtbase.dll' : process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6'

test('LTS FFI preserves sliced buffer addresses, zero-copy views and 64-bit results', () => {
  const { lib, functions } = ffi.dlopen(libc, {
    strlen: { arguments: ['pointer'], return: 'u64' },
    strtoll: { arguments: ['pointer', 'pointer', 'i32'], return: 'i64' },
  })
  try {
    const bytes = Buffer.from('skip9223372036854775807\0')
    const slice = bytes.subarray(4)
    assert.equal(functions.strlen(slice), 19n)
    assert.equal(functions.strtoll(slice, 0n, 10), 9223372036854775807n)
    const address = ffi.getRawPointer(bytes.buffer) + BigInt(bytes.byteOffset + 4)
    const view = new Uint8Array(ffi.toArrayBuffer(address, slice.length))
    view[0] = 0x31
    assert.equal(bytes.toString(), 'skip1223372036854775807\0')
    assert.equal(functions.strtoll(address, 0n, 10), 1223372036854775807n)
  }
  finally {
    lib.close()
  }
})

test('LTS FFI callbacks receive live pointers and can be released before library close', () => {
  const { lib, functions } = ffi.dlopen(libc, {
    qsort: { arguments: ['pointer', 'u64', 'u64', 'pointer'], return: 'void' },
  })
  try {
    const callback = lib.registerCallback({ arguments: ['pointer', 'pointer'], return: 'i32' }, (left, right) => {
      const a = new Int32Array(ffi.toArrayBuffer(left, 4))[0]
      const b = new Int32Array(ffi.toArrayBuffer(right, 4))[0]
      return a - b
    })
    const values = new Int32Array([9, -3, 0, 2, -3])
    functions.qsort(values, 5n, 4n, callback)
    assert.deepEqual([...values], [-3, -3, 0, 2, 9])
    lib.unregisterCallback(callback)
  }
  finally {
    lib.close()
  }
  lib.close()
  assert.throws(() => lib.registerCallback({ arguments: [], return: 'void' }, () => {}), /closed/)
})
