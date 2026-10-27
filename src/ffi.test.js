import { dlopen, JSCallback, ptr, toArrayBuffer } from 'bun:ffi'
import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'

const libc = process.platform === 'win32' ? 'ucrtbase.dll' : process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6'

test('Bun FFI preserves sliced buffer addresses, zero-copy views and 64-bit results', () => {
  const library = dlopen(libc, {
    strlen: { args: ['ptr'], returns: 'u64' },
    strtoll: { args: ['ptr', 'ptr', 'i32'], returns: 'i64' },
  })
  try {
    const bytes = Buffer.from('skip9223372036854775807\0')
    const slice = bytes.subarray(4)
    const address = ptr(slice)
    assert.equal(address, ptr(bytes) + 4)
    assert.equal(BigInt(library.symbols.strlen(address)), 19n)
    assert.equal(library.symbols.strtoll(address, null, 10), 9223372036854775807n)
    const view = new Uint8Array(toArrayBuffer(address, 0, slice.length))
    view[0] = 0x31
    assert.equal(bytes.toString(), 'skip1223372036854775807\0')
    assert.equal(BigInt(library.symbols.strtoll(address, null, 10)), 1223372036854775807n)
  }
  finally {
    library.close()
  }
})

test('Bun FFI callbacks receive live pointers and release their native resources', () => {
  const library = dlopen(libc, {
    qsort: { args: ['ptr', 'u64', 'u64', 'ptr'], returns: 'void' },
  })
  const callback = new JSCallback((left, right) => {
    const a = new Int32Array(toArrayBuffer(left, 0, 4))[0]
    const b = new Int32Array(toArrayBuffer(right, 0, 4))[0]
    return a - b
  }, { args: ['ptr', 'ptr'], returns: 'i32' })
  try {
    const values = new Int32Array([9, -3, 0, 2, -3])
    library.symbols.qsort(ptr(values), 5, 4, callback.ptr)
    assert.deepEqual([...values], [-3, -3, 0, 2, 9])
  }
  finally {
    callback.close()
    library.close()
  }
})
