(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){

},{}],2:[function(require,module,exports){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('is-array')

exports.Buffer = Buffer
exports.SlowBuffer = Buffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var kMaxLength = 0x3fffffff

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Note:
 *
 * - Implementation must support adding new properties to `Uint8Array` instances.
 *   Firefox 4-29 lacked support, fixed in Firefox 30+.
 *   See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *  - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *  - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *    incorrect length in some situations.
 *
 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they will
 * get the Object implementation, which is slower but will work correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = (function () {
  try {
    var buf = new ArrayBuffer(0)
    var arr = new Uint8Array(buf)
    arr.foo = function () { return 42 }
    return 42 === arr.foo() && // typed array instances can be augmented
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        new Uint8Array(1).subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
})()

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (subject, encoding, noZero) {
  if (!(this instanceof Buffer))
    return new Buffer(subject, encoding, noZero)

  var type = typeof subject

  // Find the length
  var length
  if (type === 'number')
    length = subject > 0 ? subject >>> 0 : 0
  else if (type === 'string') {
    if (encoding === 'base64')
      subject = base64clean(subject)
    length = Buffer.byteLength(subject, encoding)
  } else if (type === 'object' && subject !== null) { // assume object is array-like
    if (subject.type === 'Buffer' && isArray(subject.data))
      subject = subject.data
    length = +subject.length > 0 ? Math.floor(+subject.length) : 0
  } else
    throw new TypeError('must start with number, buffer, array or string')

  if (this.length > kMaxLength)
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
      'size: 0x' + kMaxLength.toString(16) + ' bytes')

  var buf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Preferred: Return an augmented `Uint8Array` instance for best performance
    buf = Buffer._augment(new Uint8Array(length))
  } else {
    // Fallback: Return THIS instance of Buffer (created by `new`)
    buf = this
    buf.length = length
    buf._isBuffer = true
  }

  var i
  if (Buffer.TYPED_ARRAY_SUPPORT && typeof subject.byteLength === 'number') {
    // Speed optimization -- use set if we're copying from a typed array
    buf._set(subject)
  } else if (isArrayish(subject)) {
    // Treat array-ish objects as a byte array
    if (Buffer.isBuffer(subject)) {
      for (i = 0; i < length; i++)
        buf[i] = subject.readUInt8(i)
    } else {
      for (i = 0; i < length; i++)
        buf[i] = ((subject[i] % 256) + 256) % 256
    }
  } else if (type === 'string') {
    buf.write(subject, 0, encoding)
  } else if (type === 'number' && !Buffer.TYPED_ARRAY_SUPPORT && !noZero) {
    for (i = 0; i < length; i++) {
      buf[i] = 0
    }
  }

  return buf
}

Buffer.isBuffer = function (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b))
    throw new TypeError('Arguments must be Buffers')

  var x = a.length
  var y = b.length
  for (var i = 0, len = Math.min(x, y); i < len && a[i] === b[i]; i++) {}
  if (i !== len) {
    x = a[i]
    y = b[i]
  }
  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function (list, totalLength) {
  if (!isArray(list)) throw new TypeError('Usage: Buffer.concat(list[, length])')

  if (list.length === 0) {
    return new Buffer(0)
  } else if (list.length === 1) {
    return list[0]
  }

  var i
  if (totalLength === undefined) {
    totalLength = 0
    for (i = 0; i < list.length; i++) {
      totalLength += list[i].length
    }
  }

  var buf = new Buffer(totalLength)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

Buffer.byteLength = function (str, encoding) {
  var ret
  str = str + ''
  switch (encoding || 'utf8') {
    case 'ascii':
    case 'binary':
    case 'raw':
      ret = str.length
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = str.length * 2
      break
    case 'hex':
      ret = str.length >>> 1
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8ToBytes(str).length
      break
    case 'base64':
      ret = base64ToBytes(str).length
      break
    default:
      ret = str.length
  }
  return ret
}

// pre-set for values that may exist in the future
Buffer.prototype.length = undefined
Buffer.prototype.parent = undefined

// toString(encoding, start=0, end=buffer.length)
Buffer.prototype.toString = function (encoding, start, end) {
  var loweredCase = false

  start = start >>> 0
  end = end === undefined || end === Infinity ? this.length : end >>> 0

  if (!encoding) encoding = 'utf8'
  if (start < 0) start = 0
  if (end > this.length) end = this.length
  if (end <= start) return ''

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase)
          throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.equals = function (b) {
  if(!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max)
      str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  return Buffer.compare(this, b)
}

// `get` will be removed in Node 0.13+
Buffer.prototype.get = function (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` will be removed in Node 0.13+
Buffer.prototype.set = function (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var byte = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(byte)) throw new Error('Invalid hex string')
    buf[offset + i] = byte
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  var charsWritten = blitBuffer(utf8ToBytes(string), buf, offset, length)
  return charsWritten
}

function asciiWrite (buf, string, offset, length) {
  var charsWritten = blitBuffer(asciiToBytes(string), buf, offset, length)
  return charsWritten
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  var charsWritten = blitBuffer(base64ToBytes(string), buf, offset, length)
  return charsWritten
}

function utf16leWrite (buf, string, offset, length) {
  var charsWritten = blitBuffer(utf16leToBytes(string), buf, offset, length)
  return charsWritten
}

Buffer.prototype.write = function (string, offset, length, encoding) {
  // Support both (string, offset, length, encoding)
  // and the legacy (string, encoding, offset, length)
  if (isFinite(offset)) {
    if (!isFinite(length)) {
      encoding = length
      length = undefined
    }
  } else {  // legacy
    var swap = encoding
    encoding = offset
    offset = length
    length = swap
  }

  offset = Number(offset) || 0
  var remaining = this.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }
  encoding = String(encoding || 'utf8').toLowerCase()

  var ret
  switch (encoding) {
    case 'hex':
      ret = hexWrite(this, string, offset, length)
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8Write(this, string, offset, length)
      break
    case 'ascii':
      ret = asciiWrite(this, string, offset, length)
      break
    case 'binary':
      ret = binaryWrite(this, string, offset, length)
      break
    case 'base64':
      ret = base64Write(this, string, offset, length)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = utf16leWrite(this, string, offset, length)
      break
    default:
      throw new TypeError('Unknown encoding: ' + encoding)
  }
  return ret
}

Buffer.prototype.toJSON = function () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  var res = ''
  var tmp = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    if (buf[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])
      tmp = ''
    } else {
      tmp += '%' + buf[i].toString(16)
    }
  }

  return res + decodeUtf8Char(tmp)
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function binarySlice (buf, start, end) {
  return asciiSlice(buf, start, end)
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len;
    if (start < 0)
      start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0)
      end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start)
    end = start

  if (Buffer.TYPED_ARRAY_SUPPORT) {
    return Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    var newBuf = new Buffer(sliceLen, undefined, true)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
    return newBuf
  }
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0)
    throw new RangeError('offset is not uint')
  if (offset + ext > length)
    throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUInt8 = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
      ((this[offset + 1] << 16) |
      (this[offset + 2] << 8) |
      this[offset + 3])
}

Buffer.prototype.readInt8 = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80))
    return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)

  return (this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16) |
      (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
      (this[offset + 1] << 16) |
      (this[offset + 2] << 8) |
      (this[offset + 3])
}

Buffer.prototype.readFloatLE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function (offset, noAssert) {
  if (!noAssert)
    checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new TypeError('value is out of bounds')
  if (offset + ext > buf.length) throw new TypeError('index out of range')
}

Buffer.prototype.writeUInt8 = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = value
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else objectWriteUInt16(this, value, offset, true)
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else objectWriteUInt16(this, value, offset, false)
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = value
  } else objectWriteUInt32(this, value, offset, true)
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else objectWriteUInt32(this, value, offset, false)
  return offset + 4
}

Buffer.prototype.writeInt8 = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = value
  return offset + 1
}

Buffer.prototype.writeInt16LE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else objectWriteUInt16(this, value, offset, true)
  return offset + 2
}

Buffer.prototype.writeInt16BE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else objectWriteUInt16(this, value, offset, false)
  return offset + 2
}

Buffer.prototype.writeInt32LE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else objectWriteUInt32(this, value, offset, true)
  return offset + 4
}

Buffer.prototype.writeInt32BE = function (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
  if (!noAssert)
    checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else objectWriteUInt32(this, value, offset, false)
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (value > max || value < min) throw new TypeError('value is out of bounds')
  if (offset + ext > buf.length) throw new TypeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert)
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert)
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function (target, target_start, start, end) {
  var source = this

  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (!target_start) target_start = 0

  // Copy 0 bytes; we're done
  if (end === start) return
  if (target.length === 0 || source.length === 0) return

  // Fatal error conditions
  if (end < start) throw new TypeError('sourceEnd < sourceStart')
  if (target_start < 0 || target_start >= target.length)
    throw new TypeError('targetStart out of bounds')
  if (start < 0 || start >= source.length) throw new TypeError('sourceStart out of bounds')
  if (end < 0 || end > source.length) throw new TypeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length)
    end = this.length
  if (target.length - target_start < end - start)
    end = target.length - target_start + start

  var len = end - start

  if (len < 100 || !Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < len; i++) {
      target[i + target_start] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), target_start)
  }
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new TypeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new TypeError('start out of bounds')
  if (end < 0 || end > this.length) throw new TypeError('end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1) {
        buf[i] = this[i]
      }
      return buf.buffer
    }
  } else {
    throw new TypeError('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function (arr) {
  arr._isBuffer = true

  // save reference to original Uint8Array get/set methods before overwriting
  arr._get = arr.get
  arr._set = arr.set

  // deprecated, will be removed in node 0.13+
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.equals = BP.equals
  arr.compare = BP.compare
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

var INVALID_BASE64_RE = /[^+\/0-9A-z]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function isArrayish (subject) {
  return isArray(subject) || Buffer.isBuffer(subject) ||
      subject && typeof subject === 'object' &&
      typeof subject.length === 'number'
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    var b = str.charCodeAt(i)
    if (b <= 0x7F) {
      byteArray.push(b)
    } else {
      var start = i
      if (b >= 0xD800 && b <= 0xDFFF) i++
      var h = encodeURIComponent(str.slice(start, i+1)).substr(1).split('%')
      for (var j = 0; j < h.length; j++) {
        byteArray.push(parseInt(h[j], 16))
      }
    }
  }
  return byteArray
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(str)
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length))
      break
    dst[i + offset] = src[i]
  }
  return i
}

function decodeUtf8Char (str) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    return String.fromCharCode(0xFFFD) // UTF 8 invalid char
  }
}

},{"base64-js":3,"ieee754":4,"is-array":5}],3:[function(require,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS)
			return 62 // '+'
		if (code === SLASH)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

},{}],4:[function(require,module,exports){
exports.read = function(buffer, offset, isLE, mLen, nBytes) {
  var e, m,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      nBits = -7,
      i = isLE ? (nBytes - 1) : 0,
      d = isLE ? -1 : 1,
      s = buffer[offset + i];

  i += d;

  e = s & ((1 << (-nBits)) - 1);
  s >>= (-nBits);
  nBits += eLen;
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8);

  m = e & ((1 << (-nBits)) - 1);
  e >>= (-nBits);
  nBits += mLen;
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8);

  if (e === 0) {
    e = 1 - eBias;
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity);
  } else {
    m = m + Math.pow(2, mLen);
    e = e - eBias;
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
};

exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0),
      i = isLE ? 0 : (nBytes - 1),
      d = isLE ? 1 : -1,
      s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;

  value = Math.abs(value);

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0;
    e = eMax;
  } else {
    e = Math.floor(Math.log(value) / Math.LN2);
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--;
      c *= 2;
    }
    if (e + eBias >= 1) {
      value += rt / c;
    } else {
      value += rt * Math.pow(2, 1 - eBias);
    }
    if (value * c >= 2) {
      e++;
      c /= 2;
    }

    if (e + eBias >= eMax) {
      m = 0;
      e = eMax;
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen);
      e = e + eBias;
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
      e = 0;
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8);

  e = (e << mLen) | m;
  eLen += mLen;
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8);

  buffer[offset + i - d] |= s * 128;
};

},{}],5:[function(require,module,exports){

/**
 * isArray
 */

var isArray = Array.isArray;

/**
 * toString
 */

var str = Object.prototype.toString;

/**
 * Whether or not the given `val`
 * is an array.
 *
 * example:
 *
 *        isArray([]);
 *        // > true
 *        isArray(arguments);
 *        // > false
 *        isArray('');
 *        // > false
 *
 * @param {mixed} val
 * @return {bool}
 */

module.exports = isArray || function (val) {
  return !! val && '[object Array]' == str.call(val);
};

},{}],6:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      }
      throw TypeError('Uncaught, unspecified "error" event.');
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        len = arguments.length;
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    len = arguments.length;
    args = new Array(len - 1);
    for (i = 1; i < len; i++)
      args[i - 1] = arguments[i];

    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    var m;
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      if (typeof console.trace === 'function') {
        // not supported in IE 10
        console.trace();
      }
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (isFunction(emitter._events[type]))
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],7:[function(require,module,exports){
if (typeof Object.create === 'function') {
  // implementation from standard node.js 'util' module
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: {
        value: ctor,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
  };
} else {
  // old school shim for old browsers
  module.exports = function inherits(ctor, superCtor) {
    ctor.super_ = superCtor
    var TempCtor = function () {}
    TempCtor.prototype = superCtor.prototype
    ctor.prototype = new TempCtor()
    ctor.prototype.constructor = ctor
  }
}

},{}],8:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};

process.nextTick = (function () {
    var canSetImmediate = typeof window !== 'undefined'
    && window.setImmediate;
    var canMutationObserver = typeof window !== 'undefined'
    && window.MutationObserver;
    var canPost = typeof window !== 'undefined'
    && window.postMessage && window.addEventListener
    ;

    if (canSetImmediate) {
        return function (f) { return window.setImmediate(f) };
    }

    var queue = [];

    if (canMutationObserver) {
        var hiddenDiv = document.createElement("div");
        var observer = new MutationObserver(function () {
            var queueList = queue.slice();
            queue.length = 0;
            queueList.forEach(function (fn) {
                fn();
            });
        });

        observer.observe(hiddenDiv, { attributes: true });

        return function nextTick(fn) {
            if (!queue.length) {
                hiddenDiv.setAttribute('yes', 'no');
            }
            queue.push(fn);
        };
    }

    if (canPost) {
        window.addEventListener('message', function (ev) {
            var source = ev.source;
            if ((source === window || source === null) && ev.data === 'process-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);

        return function nextTick(fn) {
            queue.push(fn);
            window.postMessage('process-tick', '*');
        };
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };
})();

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};

},{}],9:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

module.exports = Stream;

var EE = require('events').EventEmitter;
var inherits = require('inherits');

inherits(Stream, EE);
Stream.Readable = require('readable-stream/readable.js');
Stream.Writable = require('readable-stream/writable.js');
Stream.Duplex = require('readable-stream/duplex.js');
Stream.Transform = require('readable-stream/transform.js');
Stream.PassThrough = require('readable-stream/passthrough.js');

// Backwards-compat with node 0.4.x
Stream.Stream = Stream;



// old-style streams.  Note that the pipe method (the only relevant
// part of this class) is overridden in the Readable class.

function Stream() {
  EE.call(this);
}

Stream.prototype.pipe = function(dest, options) {
  var source = this;

  function ondata(chunk) {
    if (dest.writable) {
      if (false === dest.write(chunk) && source.pause) {
        source.pause();
      }
    }
  }

  source.on('data', ondata);

  function ondrain() {
    if (source.readable && source.resume) {
      source.resume();
    }
  }

  dest.on('drain', ondrain);

  // If the 'end' option is not supplied, dest.end() will be called when
  // source gets the 'end' or 'close' events.  Only dest.end() once.
  if (!dest._isStdio && (!options || options.end !== false)) {
    source.on('end', onend);
    source.on('close', onclose);
  }

  var didOnEnd = false;
  function onend() {
    if (didOnEnd) return;
    didOnEnd = true;

    dest.end();
  }


  function onclose() {
    if (didOnEnd) return;
    didOnEnd = true;

    if (typeof dest.destroy === 'function') dest.destroy();
  }

  // don't leave dangling pipes when there are errors.
  function onerror(er) {
    cleanup();
    if (EE.listenerCount(this, 'error') === 0) {
      throw er; // Unhandled stream error in pipe.
    }
  }

  source.on('error', onerror);
  dest.on('error', onerror);

  // remove all the event listeners that were added.
  function cleanup() {
    source.removeListener('data', ondata);
    dest.removeListener('drain', ondrain);

    source.removeListener('end', onend);
    source.removeListener('close', onclose);

    source.removeListener('error', onerror);
    dest.removeListener('error', onerror);

    source.removeListener('end', cleanup);
    source.removeListener('close', cleanup);

    dest.removeListener('close', cleanup);
  }

  source.on('end', cleanup);
  source.on('close', cleanup);

  dest.on('close', cleanup);

  dest.emit('pipe', source);

  // Allow for unix-like usage: A.pipe(B).pipe(C)
  return dest;
};

},{"events":6,"inherits":7,"readable-stream/duplex.js":10,"readable-stream/passthrough.js":20,"readable-stream/readable.js":21,"readable-stream/transform.js":22,"readable-stream/writable.js":23}],10:[function(require,module,exports){
module.exports = require("./lib/_stream_duplex.js")

},{"./lib/_stream_duplex.js":11}],11:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// a duplex stream is just a stream that is both readable and writable.
// Since JS doesn't have multiple prototypal inheritance, this class
// prototypally inherits from Readable, and then parasitically from
// Writable.

module.exports = Duplex;

/*<replacement>*/
var objectKeys = Object.keys || function (obj) {
  var keys = [];
  for (var key in obj) keys.push(key);
  return keys;
}
/*</replacement>*/


/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

var Readable = require('./_stream_readable');
var Writable = require('./_stream_writable');

util.inherits(Duplex, Readable);

forEach(objectKeys(Writable.prototype), function(method) {
  if (!Duplex.prototype[method])
    Duplex.prototype[method] = Writable.prototype[method];
});

function Duplex(options) {
  if (!(this instanceof Duplex))
    return new Duplex(options);

  Readable.call(this, options);
  Writable.call(this, options);

  if (options && options.readable === false)
    this.readable = false;

  if (options && options.writable === false)
    this.writable = false;

  this.allowHalfOpen = true;
  if (options && options.allowHalfOpen === false)
    this.allowHalfOpen = false;

  this.once('end', onend);
}

// the no-half-open enforcer
function onend() {
  // if we allow half-open state, or if the writable side ended,
  // then we're ok.
  if (this.allowHalfOpen || this._writableState.ended)
    return;

  // no more data can be written.
  // But allow more writes to happen in this tick.
  process.nextTick(this.end.bind(this));
}

function forEach (xs, f) {
  for (var i = 0, l = xs.length; i < l; i++) {
    f(xs[i], i);
  }
}

}).call(this,require('_process'))
},{"./_stream_readable":13,"./_stream_writable":15,"_process":8,"core-util-is":16,"inherits":17}],12:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// a passthrough stream.
// basically just the most minimal sort of Transform stream.
// Every written chunk gets output as-is.

module.exports = PassThrough;

var Transform = require('./_stream_transform');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

util.inherits(PassThrough, Transform);

function PassThrough(options) {
  if (!(this instanceof PassThrough))
    return new PassThrough(options);

  Transform.call(this, options);
}

PassThrough.prototype._transform = function(chunk, encoding, cb) {
  cb(null, chunk);
};

},{"./_stream_transform":14,"core-util-is":16,"inherits":17}],13:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

module.exports = Readable;

/*<replacement>*/
var isArray = require('isarray');
/*</replacement>*/


/*<replacement>*/
var Buffer = require('buffer').Buffer;
/*</replacement>*/

Readable.ReadableState = ReadableState;

var EE = require('events').EventEmitter;

/*<replacement>*/
if (!EE.listenerCount) EE.listenerCount = function(emitter, type) {
  return emitter.listeners(type).length;
};
/*</replacement>*/

var Stream = require('stream');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

var StringDecoder;


/*<replacement>*/
var debug = require('util');
if (debug && debug.debuglog) {
  debug = debug.debuglog('stream');
} else {
  debug = function () {};
}
/*</replacement>*/


util.inherits(Readable, Stream);

function ReadableState(options, stream) {
  var Duplex = require('./_stream_duplex');

  options = options || {};

  // the point at which it stops calling _read() to fill the buffer
  // Note: 0 is a valid value, means "don't call _read preemptively ever"
  var hwm = options.highWaterMark;
  var defaultHwm = options.objectMode ? 16 : 16 * 1024;
  this.highWaterMark = (hwm || hwm === 0) ? hwm : defaultHwm;

  // cast to ints.
  this.highWaterMark = ~~this.highWaterMark;

  this.buffer = [];
  this.length = 0;
  this.pipes = null;
  this.pipesCount = 0;
  this.flowing = null;
  this.ended = false;
  this.endEmitted = false;
  this.reading = false;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // whenever we return null, then we set a flag to say
  // that we're awaiting a 'readable' event emission.
  this.needReadable = false;
  this.emittedReadable = false;
  this.readableListening = false;


  // object stream flag. Used to make read(n) ignore n and to
  // make all the buffer merging and length checks go away
  this.objectMode = !!options.objectMode;

  if (stream instanceof Duplex)
    this.objectMode = this.objectMode || !!options.readableObjectMode;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // when piping, we only care about 'readable' events that happen
  // after read()ing all the bytes and not getting any pushback.
  this.ranOut = false;

  // the number of writers that are awaiting a drain event in .pipe()s
  this.awaitDrain = 0;

  // if true, a maybeReadMore has been scheduled
  this.readingMore = false;

  this.decoder = null;
  this.encoding = null;
  if (options.encoding) {
    if (!StringDecoder)
      StringDecoder = require('string_decoder/').StringDecoder;
    this.decoder = new StringDecoder(options.encoding);
    this.encoding = options.encoding;
  }
}

function Readable(options) {
  var Duplex = require('./_stream_duplex');

  if (!(this instanceof Readable))
    return new Readable(options);

  this._readableState = new ReadableState(options, this);

  // legacy
  this.readable = true;

  Stream.call(this);
}

// Manually shove something into the read() buffer.
// This returns true if the highWaterMark has not been hit yet,
// similar to how Writable.write() returns true if you should
// write() some more.
Readable.prototype.push = function(chunk, encoding) {
  var state = this._readableState;

  if (util.isString(chunk) && !state.objectMode) {
    encoding = encoding || state.defaultEncoding;
    if (encoding !== state.encoding) {
      chunk = new Buffer(chunk, encoding);
      encoding = '';
    }
  }

  return readableAddChunk(this, state, chunk, encoding, false);
};

// Unshift should *always* be something directly out of read()
Readable.prototype.unshift = function(chunk) {
  var state = this._readableState;
  return readableAddChunk(this, state, chunk, '', true);
};

function readableAddChunk(stream, state, chunk, encoding, addToFront) {
  var er = chunkInvalid(state, chunk);
  if (er) {
    stream.emit('error', er);
  } else if (util.isNullOrUndefined(chunk)) {
    state.reading = false;
    if (!state.ended)
      onEofChunk(stream, state);
  } else if (state.objectMode || chunk && chunk.length > 0) {
    if (state.ended && !addToFront) {
      var e = new Error('stream.push() after EOF');
      stream.emit('error', e);
    } else if (state.endEmitted && addToFront) {
      var e = new Error('stream.unshift() after end event');
      stream.emit('error', e);
    } else {
      if (state.decoder && !addToFront && !encoding)
        chunk = state.decoder.write(chunk);

      if (!addToFront)
        state.reading = false;

      // if we want the data now, just emit it.
      if (state.flowing && state.length === 0 && !state.sync) {
        stream.emit('data', chunk);
        stream.read(0);
      } else {
        // update the buffer info.
        state.length += state.objectMode ? 1 : chunk.length;
        if (addToFront)
          state.buffer.unshift(chunk);
        else
          state.buffer.push(chunk);

        if (state.needReadable)
          emitReadable(stream);
      }

      maybeReadMore(stream, state);
    }
  } else if (!addToFront) {
    state.reading = false;
  }

  return needMoreData(state);
}



// if it's past the high water mark, we can push in some more.
// Also, if we have no data yet, we can stand some
// more bytes.  This is to work around cases where hwm=0,
// such as the repl.  Also, if the push() triggered a
// readable event, and the user called read(largeNumber) such that
// needReadable was set, then we ought to push more, so that another
// 'readable' event will be triggered.
function needMoreData(state) {
  return !state.ended &&
         (state.needReadable ||
          state.length < state.highWaterMark ||
          state.length === 0);
}

// backwards compatibility.
Readable.prototype.setEncoding = function(enc) {
  if (!StringDecoder)
    StringDecoder = require('string_decoder/').StringDecoder;
  this._readableState.decoder = new StringDecoder(enc);
  this._readableState.encoding = enc;
  return this;
};

// Don't raise the hwm > 128MB
var MAX_HWM = 0x800000;
function roundUpToNextPowerOf2(n) {
  if (n >= MAX_HWM) {
    n = MAX_HWM;
  } else {
    // Get the next highest power of 2
    n--;
    for (var p = 1; p < 32; p <<= 1) n |= n >> p;
    n++;
  }
  return n;
}

function howMuchToRead(n, state) {
  if (state.length === 0 && state.ended)
    return 0;

  if (state.objectMode)
    return n === 0 ? 0 : 1;

  if (isNaN(n) || util.isNull(n)) {
    // only flow one buffer at a time
    if (state.flowing && state.buffer.length)
      return state.buffer[0].length;
    else
      return state.length;
  }

  if (n <= 0)
    return 0;

  // If we're asking for more than the target buffer level,
  // then raise the water mark.  Bump up to the next highest
  // power of 2, to prevent increasing it excessively in tiny
  // amounts.
  if (n > state.highWaterMark)
    state.highWaterMark = roundUpToNextPowerOf2(n);

  // don't have that much.  return null, unless we've ended.
  if (n > state.length) {
    if (!state.ended) {
      state.needReadable = true;
      return 0;
    } else
      return state.length;
  }

  return n;
}

// you can override either this method, or the async _read(n) below.
Readable.prototype.read = function(n) {
  debug('read', n);
  var state = this._readableState;
  var nOrig = n;

  if (!util.isNumber(n) || n > 0)
    state.emittedReadable = false;

  // if we're doing read(0) to trigger a readable event, but we
  // already have a bunch of data in the buffer, then just trigger
  // the 'readable' event and move on.
  if (n === 0 &&
      state.needReadable &&
      (state.length >= state.highWaterMark || state.ended)) {
    debug('read: emitReadable', state.length, state.ended);
    if (state.length === 0 && state.ended)
      endReadable(this);
    else
      emitReadable(this);
    return null;
  }

  n = howMuchToRead(n, state);

  // if we've ended, and we're now clear, then finish it up.
  if (n === 0 && state.ended) {
    if (state.length === 0)
      endReadable(this);
    return null;
  }

  // All the actual chunk generation logic needs to be
  // *below* the call to _read.  The reason is that in certain
  // synthetic stream cases, such as passthrough streams, _read
  // may be a completely synchronous operation which may change
  // the state of the read buffer, providing enough data when
  // before there was *not* enough.
  //
  // So, the steps are:
  // 1. Figure out what the state of things will be after we do
  // a read from the buffer.
  //
  // 2. If that resulting state will trigger a _read, then call _read.
  // Note that this may be asynchronous, or synchronous.  Yes, it is
  // deeply ugly to write APIs this way, but that still doesn't mean
  // that the Readable class should behave improperly, as streams are
  // designed to be sync/async agnostic.
  // Take note if the _read call is sync or async (ie, if the read call
  // has returned yet), so that we know whether or not it's safe to emit
  // 'readable' etc.
  //
  // 3. Actually pull the requested chunks out of the buffer and return.

  // if we need a readable event, then we need to do some reading.
  var doRead = state.needReadable;
  debug('need readable', doRead);

  // if we currently have less than the highWaterMark, then also read some
  if (state.length === 0 || state.length - n < state.highWaterMark) {
    doRead = true;
    debug('length less than watermark', doRead);
  }

  // however, if we've ended, then there's no point, and if we're already
  // reading, then it's unnecessary.
  if (state.ended || state.reading) {
    doRead = false;
    debug('reading or ended', doRead);
  }

  if (doRead) {
    debug('do read');
    state.reading = true;
    state.sync = true;
    // if the length is currently zero, then we *need* a readable event.
    if (state.length === 0)
      state.needReadable = true;
    // call internal read method
    this._read(state.highWaterMark);
    state.sync = false;
  }

  // If _read pushed data synchronously, then `reading` will be false,
  // and we need to re-evaluate how much data we can return to the user.
  if (doRead && !state.reading)
    n = howMuchToRead(nOrig, state);

  var ret;
  if (n > 0)
    ret = fromList(n, state);
  else
    ret = null;

  if (util.isNull(ret)) {
    state.needReadable = true;
    n = 0;
  }

  state.length -= n;

  // If we have nothing in the buffer, then we want to know
  // as soon as we *do* get something into the buffer.
  if (state.length === 0 && !state.ended)
    state.needReadable = true;

  // If we tried to read() past the EOF, then emit end on the next tick.
  if (nOrig !== n && state.ended && state.length === 0)
    endReadable(this);

  if (!util.isNull(ret))
    this.emit('data', ret);

  return ret;
};

function chunkInvalid(state, chunk) {
  var er = null;
  if (!util.isBuffer(chunk) &&
      !util.isString(chunk) &&
      !util.isNullOrUndefined(chunk) &&
      !state.objectMode) {
    er = new TypeError('Invalid non-string/buffer chunk');
  }
  return er;
}


function onEofChunk(stream, state) {
  if (state.decoder && !state.ended) {
    var chunk = state.decoder.end();
    if (chunk && chunk.length) {
      state.buffer.push(chunk);
      state.length += state.objectMode ? 1 : chunk.length;
    }
  }
  state.ended = true;

  // emit 'readable' now to make sure it gets picked up.
  emitReadable(stream);
}

// Don't emit readable right away in sync mode, because this can trigger
// another read() call => stack overflow.  This way, it might trigger
// a nextTick recursion warning, but that's not so bad.
function emitReadable(stream) {
  var state = stream._readableState;
  state.needReadable = false;
  if (!state.emittedReadable) {
    debug('emitReadable', state.flowing);
    state.emittedReadable = true;
    if (state.sync)
      process.nextTick(function() {
        emitReadable_(stream);
      });
    else
      emitReadable_(stream);
  }
}

function emitReadable_(stream) {
  debug('emit readable');
  stream.emit('readable');
  flow(stream);
}


// at this point, the user has presumably seen the 'readable' event,
// and called read() to consume some data.  that may have triggered
// in turn another _read(n) call, in which case reading = true if
// it's in progress.
// However, if we're not ended, or reading, and the length < hwm,
// then go ahead and try to read some more preemptively.
function maybeReadMore(stream, state) {
  if (!state.readingMore) {
    state.readingMore = true;
    process.nextTick(function() {
      maybeReadMore_(stream, state);
    });
  }
}

function maybeReadMore_(stream, state) {
  var len = state.length;
  while (!state.reading && !state.flowing && !state.ended &&
         state.length < state.highWaterMark) {
    debug('maybeReadMore read 0');
    stream.read(0);
    if (len === state.length)
      // didn't get any data, stop spinning.
      break;
    else
      len = state.length;
  }
  state.readingMore = false;
}

// abstract method.  to be overridden in specific implementation classes.
// call cb(er, data) where data is <= n in length.
// for virtual (non-string, non-buffer) streams, "length" is somewhat
// arbitrary, and perhaps not very meaningful.
Readable.prototype._read = function(n) {
  this.emit('error', new Error('not implemented'));
};

Readable.prototype.pipe = function(dest, pipeOpts) {
  var src = this;
  var state = this._readableState;

  switch (state.pipesCount) {
    case 0:
      state.pipes = dest;
      break;
    case 1:
      state.pipes = [state.pipes, dest];
      break;
    default:
      state.pipes.push(dest);
      break;
  }
  state.pipesCount += 1;
  debug('pipe count=%d opts=%j', state.pipesCount, pipeOpts);

  var doEnd = (!pipeOpts || pipeOpts.end !== false) &&
              dest !== process.stdout &&
              dest !== process.stderr;

  var endFn = doEnd ? onend : cleanup;
  if (state.endEmitted)
    process.nextTick(endFn);
  else
    src.once('end', endFn);

  dest.on('unpipe', onunpipe);
  function onunpipe(readable) {
    debug('onunpipe');
    if (readable === src) {
      cleanup();
    }
  }

  function onend() {
    debug('onend');
    dest.end();
  }

  // when the dest drains, it reduces the awaitDrain counter
  // on the source.  This would be more elegant with a .once()
  // handler in flow(), but adding and removing repeatedly is
  // too slow.
  var ondrain = pipeOnDrain(src);
  dest.on('drain', ondrain);

  function cleanup() {
    debug('cleanup');
    // cleanup event handlers once the pipe is broken
    dest.removeListener('close', onclose);
    dest.removeListener('finish', onfinish);
    dest.removeListener('drain', ondrain);
    dest.removeListener('error', onerror);
    dest.removeListener('unpipe', onunpipe);
    src.removeListener('end', onend);
    src.removeListener('end', cleanup);
    src.removeListener('data', ondata);

    // if the reader is waiting for a drain event from this
    // specific writer, then it would cause it to never start
    // flowing again.
    // So, if this is awaiting a drain, then we just call it now.
    // If we don't know, then assume that we are waiting for one.
    if (state.awaitDrain &&
        (!dest._writableState || dest._writableState.needDrain))
      ondrain();
  }

  src.on('data', ondata);
  function ondata(chunk) {
    debug('ondata');
    var ret = dest.write(chunk);
    if (false === ret) {
      debug('false write response, pause',
            src._readableState.awaitDrain);
      src._readableState.awaitDrain++;
      src.pause();
    }
  }

  // if the dest has an error, then stop piping into it.
  // however, don't suppress the throwing behavior for this.
  function onerror(er) {
    debug('onerror', er);
    unpipe();
    dest.removeListener('error', onerror);
    if (EE.listenerCount(dest, 'error') === 0)
      dest.emit('error', er);
  }
  // This is a brutally ugly hack to make sure that our error handler
  // is attached before any userland ones.  NEVER DO THIS.
  if (!dest._events || !dest._events.error)
    dest.on('error', onerror);
  else if (isArray(dest._events.error))
    dest._events.error.unshift(onerror);
  else
    dest._events.error = [onerror, dest._events.error];



  // Both close and finish should trigger unpipe, but only once.
  function onclose() {
    dest.removeListener('finish', onfinish);
    unpipe();
  }
  dest.once('close', onclose);
  function onfinish() {
    debug('onfinish');
    dest.removeListener('close', onclose);
    unpipe();
  }
  dest.once('finish', onfinish);

  function unpipe() {
    debug('unpipe');
    src.unpipe(dest);
  }

  // tell the dest that it's being piped to
  dest.emit('pipe', src);

  // start the flow if it hasn't been started already.
  if (!state.flowing) {
    debug('pipe resume');
    src.resume();
  }

  return dest;
};

function pipeOnDrain(src) {
  return function() {
    var state = src._readableState;
    debug('pipeOnDrain', state.awaitDrain);
    if (state.awaitDrain)
      state.awaitDrain--;
    if (state.awaitDrain === 0 && EE.listenerCount(src, 'data')) {
      state.flowing = true;
      flow(src);
    }
  };
}


Readable.prototype.unpipe = function(dest) {
  var state = this._readableState;

  // if we're not piping anywhere, then do nothing.
  if (state.pipesCount === 0)
    return this;

  // just one destination.  most common case.
  if (state.pipesCount === 1) {
    // passed in one, but it's not the right one.
    if (dest && dest !== state.pipes)
      return this;

    if (!dest)
      dest = state.pipes;

    // got a match.
    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;
    if (dest)
      dest.emit('unpipe', this);
    return this;
  }

  // slow case. multiple pipe destinations.

  if (!dest) {
    // remove all.
    var dests = state.pipes;
    var len = state.pipesCount;
    state.pipes = null;
    state.pipesCount = 0;
    state.flowing = false;

    for (var i = 0; i < len; i++)
      dests[i].emit('unpipe', this);
    return this;
  }

  // try to find the right one.
  var i = indexOf(state.pipes, dest);
  if (i === -1)
    return this;

  state.pipes.splice(i, 1);
  state.pipesCount -= 1;
  if (state.pipesCount === 1)
    state.pipes = state.pipes[0];

  dest.emit('unpipe', this);

  return this;
};

// set up data events if they are asked for
// Ensure readable listeners eventually get something
Readable.prototype.on = function(ev, fn) {
  var res = Stream.prototype.on.call(this, ev, fn);

  // If listening to data, and it has not explicitly been paused,
  // then call resume to start the flow of data on the next tick.
  if (ev === 'data' && false !== this._readableState.flowing) {
    this.resume();
  }

  if (ev === 'readable' && this.readable) {
    var state = this._readableState;
    if (!state.readableListening) {
      state.readableListening = true;
      state.emittedReadable = false;
      state.needReadable = true;
      if (!state.reading) {
        var self = this;
        process.nextTick(function() {
          debug('readable nexttick read 0');
          self.read(0);
        });
      } else if (state.length) {
        emitReadable(this, state);
      }
    }
  }

  return res;
};
Readable.prototype.addListener = Readable.prototype.on;

// pause() and resume() are remnants of the legacy readable stream API
// If the user uses them, then switch into old mode.
Readable.prototype.resume = function() {
  var state = this._readableState;
  if (!state.flowing) {
    debug('resume');
    state.flowing = true;
    if (!state.reading) {
      debug('resume read 0');
      this.read(0);
    }
    resume(this, state);
  }
  return this;
};

function resume(stream, state) {
  if (!state.resumeScheduled) {
    state.resumeScheduled = true;
    process.nextTick(function() {
      resume_(stream, state);
    });
  }
}

function resume_(stream, state) {
  state.resumeScheduled = false;
  stream.emit('resume');
  flow(stream);
  if (state.flowing && !state.reading)
    stream.read(0);
}

Readable.prototype.pause = function() {
  debug('call pause flowing=%j', this._readableState.flowing);
  if (false !== this._readableState.flowing) {
    debug('pause');
    this._readableState.flowing = false;
    this.emit('pause');
  }
  return this;
};

function flow(stream) {
  var state = stream._readableState;
  debug('flow', state.flowing);
  if (state.flowing) {
    do {
      var chunk = stream.read();
    } while (null !== chunk && state.flowing);
  }
}

// wrap an old-style stream as the async data source.
// This is *not* part of the readable stream interface.
// It is an ugly unfortunate mess of history.
Readable.prototype.wrap = function(stream) {
  var state = this._readableState;
  var paused = false;

  var self = this;
  stream.on('end', function() {
    debug('wrapped end');
    if (state.decoder && !state.ended) {
      var chunk = state.decoder.end();
      if (chunk && chunk.length)
        self.push(chunk);
    }

    self.push(null);
  });

  stream.on('data', function(chunk) {
    debug('wrapped data');
    if (state.decoder)
      chunk = state.decoder.write(chunk);
    if (!chunk || !state.objectMode && !chunk.length)
      return;

    var ret = self.push(chunk);
    if (!ret) {
      paused = true;
      stream.pause();
    }
  });

  // proxy all the other methods.
  // important when wrapping filters and duplexes.
  for (var i in stream) {
    if (util.isFunction(stream[i]) && util.isUndefined(this[i])) {
      this[i] = function(method) { return function() {
        return stream[method].apply(stream, arguments);
      }}(i);
    }
  }

  // proxy certain important events.
  var events = ['error', 'close', 'destroy', 'pause', 'resume'];
  forEach(events, function(ev) {
    stream.on(ev, self.emit.bind(self, ev));
  });

  // when we try to consume some more bytes, simply unpause the
  // underlying stream.
  self._read = function(n) {
    debug('wrapped _read', n);
    if (paused) {
      paused = false;
      stream.resume();
    }
  };

  return self;
};



// exposed for testing purposes only.
Readable._fromList = fromList;

// Pluck off n bytes from an array of buffers.
// Length is the combined lengths of all the buffers in the list.
function fromList(n, state) {
  var list = state.buffer;
  var length = state.length;
  var stringMode = !!state.decoder;
  var objectMode = !!state.objectMode;
  var ret;

  // nothing in the list, definitely empty.
  if (list.length === 0)
    return null;

  if (length === 0)
    ret = null;
  else if (objectMode)
    ret = list.shift();
  else if (!n || n >= length) {
    // read it all, truncate the array.
    if (stringMode)
      ret = list.join('');
    else
      ret = Buffer.concat(list, length);
    list.length = 0;
  } else {
    // read just some of it.
    if (n < list[0].length) {
      // just take a part of the first list item.
      // slice is the same for buffers and strings.
      var buf = list[0];
      ret = buf.slice(0, n);
      list[0] = buf.slice(n);
    } else if (n === list[0].length) {
      // first list is a perfect match
      ret = list.shift();
    } else {
      // complex case.
      // we have enough to cover it, but it spans past the first buffer.
      if (stringMode)
        ret = '';
      else
        ret = new Buffer(n);

      var c = 0;
      for (var i = 0, l = list.length; i < l && c < n; i++) {
        var buf = list[0];
        var cpy = Math.min(n - c, buf.length);

        if (stringMode)
          ret += buf.slice(0, cpy);
        else
          buf.copy(ret, c, 0, cpy);

        if (cpy < buf.length)
          list[0] = buf.slice(cpy);
        else
          list.shift();

        c += cpy;
      }
    }
  }

  return ret;
}

function endReadable(stream) {
  var state = stream._readableState;

  // If we get here before consuming all the bytes, then that is a
  // bug in node.  Should never happen.
  if (state.length > 0)
    throw new Error('endReadable called on non-empty stream');

  if (!state.endEmitted) {
    state.ended = true;
    process.nextTick(function() {
      // Check that we didn't get one last unshift.
      if (!state.endEmitted && state.length === 0) {
        state.endEmitted = true;
        stream.readable = false;
        stream.emit('end');
      }
    });
  }
}

function forEach (xs, f) {
  for (var i = 0, l = xs.length; i < l; i++) {
    f(xs[i], i);
  }
}

function indexOf (xs, x) {
  for (var i = 0, l = xs.length; i < l; i++) {
    if (xs[i] === x) return i;
  }
  return -1;
}

}).call(this,require('_process'))
},{"./_stream_duplex":11,"_process":8,"buffer":2,"core-util-is":16,"events":6,"inherits":17,"isarray":18,"stream":9,"string_decoder/":19,"util":1}],14:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.


// a transform stream is a readable/writable stream where you do
// something with the data.  Sometimes it's called a "filter",
// but that's not a great name for it, since that implies a thing where
// some bits pass through, and others are simply ignored.  (That would
// be a valid example of a transform, of course.)
//
// While the output is causally related to the input, it's not a
// necessarily symmetric or synchronous transformation.  For example,
// a zlib stream might take multiple plain-text writes(), and then
// emit a single compressed chunk some time in the future.
//
// Here's how this works:
//
// The Transform stream has all the aspects of the readable and writable
// stream classes.  When you write(chunk), that calls _write(chunk,cb)
// internally, and returns false if there's a lot of pending writes
// buffered up.  When you call read(), that calls _read(n) until
// there's enough pending readable data buffered up.
//
// In a transform stream, the written data is placed in a buffer.  When
// _read(n) is called, it transforms the queued up data, calling the
// buffered _write cb's as it consumes chunks.  If consuming a single
// written chunk would result in multiple output chunks, then the first
// outputted bit calls the readcb, and subsequent chunks just go into
// the read buffer, and will cause it to emit 'readable' if necessary.
//
// This way, back-pressure is actually determined by the reading side,
// since _read has to be called to start processing a new chunk.  However,
// a pathological inflate type of transform can cause excessive buffering
// here.  For example, imagine a stream where every byte of input is
// interpreted as an integer from 0-255, and then results in that many
// bytes of output.  Writing the 4 bytes {ff,ff,ff,ff} would result in
// 1kb of data being output.  In this case, you could write a very small
// amount of input, and end up with a very large amount of output.  In
// such a pathological inflating mechanism, there'd be no way to tell
// the system to stop doing the transform.  A single 4MB write could
// cause the system to run out of memory.
//
// However, even in such a pathological case, only a single written chunk
// would be consumed, and then the rest would wait (un-transformed) until
// the results of the previous transformed chunk were consumed.

module.exports = Transform;

var Duplex = require('./_stream_duplex');

/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

util.inherits(Transform, Duplex);


function TransformState(options, stream) {
  this.afterTransform = function(er, data) {
    return afterTransform(stream, er, data);
  };

  this.needTransform = false;
  this.transforming = false;
  this.writecb = null;
  this.writechunk = null;
}

function afterTransform(stream, er, data) {
  var ts = stream._transformState;
  ts.transforming = false;

  var cb = ts.writecb;

  if (!cb)
    return stream.emit('error', new Error('no writecb in Transform class'));

  ts.writechunk = null;
  ts.writecb = null;

  if (!util.isNullOrUndefined(data))
    stream.push(data);

  if (cb)
    cb(er);

  var rs = stream._readableState;
  rs.reading = false;
  if (rs.needReadable || rs.length < rs.highWaterMark) {
    stream._read(rs.highWaterMark);
  }
}


function Transform(options) {
  if (!(this instanceof Transform))
    return new Transform(options);

  Duplex.call(this, options);

  this._transformState = new TransformState(options, this);

  // when the writable side finishes, then flush out anything remaining.
  var stream = this;

  // start out asking for a readable event once data is transformed.
  this._readableState.needReadable = true;

  // we have implemented the _read method, and done the other things
  // that Readable wants before the first _read call, so unset the
  // sync guard flag.
  this._readableState.sync = false;

  this.once('prefinish', function() {
    if (util.isFunction(this._flush))
      this._flush(function(er) {
        done(stream, er);
      });
    else
      done(stream);
  });
}

Transform.prototype.push = function(chunk, encoding) {
  this._transformState.needTransform = false;
  return Duplex.prototype.push.call(this, chunk, encoding);
};

// This is the part where you do stuff!
// override this function in implementation classes.
// 'chunk' is an input chunk.
//
// Call `push(newChunk)` to pass along transformed output
// to the readable side.  You may call 'push' zero or more times.
//
// Call `cb(err)` when you are done with this chunk.  If you pass
// an error, then that'll put the hurt on the whole operation.  If you
// never call cb(), then you'll never get another chunk.
Transform.prototype._transform = function(chunk, encoding, cb) {
  throw new Error('not implemented');
};

Transform.prototype._write = function(chunk, encoding, cb) {
  var ts = this._transformState;
  ts.writecb = cb;
  ts.writechunk = chunk;
  ts.writeencoding = encoding;
  if (!ts.transforming) {
    var rs = this._readableState;
    if (ts.needTransform ||
        rs.needReadable ||
        rs.length < rs.highWaterMark)
      this._read(rs.highWaterMark);
  }
};

// Doesn't matter what the args are here.
// _transform does all the work.
// That we got here means that the readable side wants more data.
Transform.prototype._read = function(n) {
  var ts = this._transformState;

  if (!util.isNull(ts.writechunk) && ts.writecb && !ts.transforming) {
    ts.transforming = true;
    this._transform(ts.writechunk, ts.writeencoding, ts.afterTransform);
  } else {
    // mark that we need a transform, so that any data that comes in
    // will get processed, now that we've asked for it.
    ts.needTransform = true;
  }
};


function done(stream, er) {
  if (er)
    return stream.emit('error', er);

  // if there's nothing in the write buffer, then that means
  // that nothing more will ever be provided
  var ws = stream._writableState;
  var ts = stream._transformState;

  if (ws.length)
    throw new Error('calling transform done when ws.length != 0');

  if (ts.transforming)
    throw new Error('calling transform done when still transforming');

  return stream.push(null);
}

},{"./_stream_duplex":11,"core-util-is":16,"inherits":17}],15:[function(require,module,exports){
(function (process){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// A bit simpler than readable streams.
// Implement an async ._write(chunk, cb), and it'll handle all
// the drain event emission and buffering.

module.exports = Writable;

/*<replacement>*/
var Buffer = require('buffer').Buffer;
/*</replacement>*/

Writable.WritableState = WritableState;


/*<replacement>*/
var util = require('core-util-is');
util.inherits = require('inherits');
/*</replacement>*/

var Stream = require('stream');

util.inherits(Writable, Stream);

function WriteReq(chunk, encoding, cb) {
  this.chunk = chunk;
  this.encoding = encoding;
  this.callback = cb;
}

function WritableState(options, stream) {
  var Duplex = require('./_stream_duplex');

  options = options || {};

  // the point at which write() starts returning false
  // Note: 0 is a valid value, means that we always return false if
  // the entire buffer is not flushed immediately on write()
  var hwm = options.highWaterMark;
  var defaultHwm = options.objectMode ? 16 : 16 * 1024;
  this.highWaterMark = (hwm || hwm === 0) ? hwm : defaultHwm;

  // object stream flag to indicate whether or not this stream
  // contains buffers or objects.
  this.objectMode = !!options.objectMode;

  if (stream instanceof Duplex)
    this.objectMode = this.objectMode || !!options.writableObjectMode;

  // cast to ints.
  this.highWaterMark = ~~this.highWaterMark;

  this.needDrain = false;
  // at the start of calling end()
  this.ending = false;
  // when end() has been called, and returned
  this.ended = false;
  // when 'finish' is emitted
  this.finished = false;

  // should we decode strings into buffers before passing to _write?
  // this is here so that some node-core streams can optimize string
  // handling at a lower level.
  var noDecode = options.decodeStrings === false;
  this.decodeStrings = !noDecode;

  // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.
  this.defaultEncoding = options.defaultEncoding || 'utf8';

  // not an actual buffer we keep track of, but a measurement
  // of how much we're waiting to get pushed to some underlying
  // socket or file.
  this.length = 0;

  // a flag to see when we're in the middle of a write.
  this.writing = false;

  // when true all writes will be buffered until .uncork() call
  this.corked = 0;

  // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.
  this.sync = true;

  // a flag to know if we're processing previously buffered items, which
  // may call the _write() callback in the same tick, so that we don't
  // end up in an overlapped onwrite situation.
  this.bufferProcessing = false;

  // the callback that's passed to _write(chunk,cb)
  this.onwrite = function(er) {
    onwrite(stream, er);
  };

  // the callback that the user supplies to write(chunk,encoding,cb)
  this.writecb = null;

  // the amount that is being written when _write is called.
  this.writelen = 0;

  this.buffer = [];

  // number of pending user-supplied write callbacks
  // this must be 0 before 'finish' can be emitted
  this.pendingcb = 0;

  // emit prefinish if the only thing we're waiting for is _write cbs
  // This is relevant for synchronous Transform streams
  this.prefinished = false;

  // True if the error was already emitted and should not be thrown again
  this.errorEmitted = false;
}

function Writable(options) {
  var Duplex = require('./_stream_duplex');

  // Writable ctor is applied to Duplexes, though they're not
  // instanceof Writable, they're instanceof Readable.
  if (!(this instanceof Writable) && !(this instanceof Duplex))
    return new Writable(options);

  this._writableState = new WritableState(options, this);

  // legacy.
  this.writable = true;

  Stream.call(this);
}

// Otherwise people can pipe Writable streams, which is just wrong.
Writable.prototype.pipe = function() {
  this.emit('error', new Error('Cannot pipe. Not readable.'));
};


function writeAfterEnd(stream, state, cb) {
  var er = new Error('write after end');
  // TODO: defer error events consistently everywhere, not just the cb
  stream.emit('error', er);
  process.nextTick(function() {
    cb(er);
  });
}

// If we get something that is not a buffer, string, null, or undefined,
// and we're not in objectMode, then that's an error.
// Otherwise stream chunks are all considered to be of length=1, and the
// watermarks determine how many objects to keep in the buffer, rather than
// how many bytes or characters.
function validChunk(stream, state, chunk, cb) {
  var valid = true;
  if (!util.isBuffer(chunk) &&
      !util.isString(chunk) &&
      !util.isNullOrUndefined(chunk) &&
      !state.objectMode) {
    var er = new TypeError('Invalid non-string/buffer chunk');
    stream.emit('error', er);
    process.nextTick(function() {
      cb(er);
    });
    valid = false;
  }
  return valid;
}

Writable.prototype.write = function(chunk, encoding, cb) {
  var state = this._writableState;
  var ret = false;

  if (util.isFunction(encoding)) {
    cb = encoding;
    encoding = null;
  }

  if (util.isBuffer(chunk))
    encoding = 'buffer';
  else if (!encoding)
    encoding = state.defaultEncoding;

  if (!util.isFunction(cb))
    cb = function() {};

  if (state.ended)
    writeAfterEnd(this, state, cb);
  else if (validChunk(this, state, chunk, cb)) {
    state.pendingcb++;
    ret = writeOrBuffer(this, state, chunk, encoding, cb);
  }

  return ret;
};

Writable.prototype.cork = function() {
  var state = this._writableState;

  state.corked++;
};

Writable.prototype.uncork = function() {
  var state = this._writableState;

  if (state.corked) {
    state.corked--;

    if (!state.writing &&
        !state.corked &&
        !state.finished &&
        !state.bufferProcessing &&
        state.buffer.length)
      clearBuffer(this, state);
  }
};

function decodeChunk(state, chunk, encoding) {
  if (!state.objectMode &&
      state.decodeStrings !== false &&
      util.isString(chunk)) {
    chunk = new Buffer(chunk, encoding);
  }
  return chunk;
}

// if we're already writing something, then just put this
// in the queue, and wait our turn.  Otherwise, call _write
// If we return false, then we need a drain event, so set that flag.
function writeOrBuffer(stream, state, chunk, encoding, cb) {
  chunk = decodeChunk(state, chunk, encoding);
  if (util.isBuffer(chunk))
    encoding = 'buffer';
  var len = state.objectMode ? 1 : chunk.length;

  state.length += len;

  var ret = state.length < state.highWaterMark;
  // we must ensure that previous needDrain will not be reset to false.
  if (!ret)
    state.needDrain = true;

  if (state.writing || state.corked)
    state.buffer.push(new WriteReq(chunk, encoding, cb));
  else
    doWrite(stream, state, false, len, chunk, encoding, cb);

  return ret;
}

function doWrite(stream, state, writev, len, chunk, encoding, cb) {
  state.writelen = len;
  state.writecb = cb;
  state.writing = true;
  state.sync = true;
  if (writev)
    stream._writev(chunk, state.onwrite);
  else
    stream._write(chunk, encoding, state.onwrite);
  state.sync = false;
}

function onwriteError(stream, state, sync, er, cb) {
  if (sync)
    process.nextTick(function() {
      state.pendingcb--;
      cb(er);
    });
  else {
    state.pendingcb--;
    cb(er);
  }

  stream._writableState.errorEmitted = true;
  stream.emit('error', er);
}

function onwriteStateUpdate(state) {
  state.writing = false;
  state.writecb = null;
  state.length -= state.writelen;
  state.writelen = 0;
}

function onwrite(stream, er) {
  var state = stream._writableState;
  var sync = state.sync;
  var cb = state.writecb;

  onwriteStateUpdate(state);

  if (er)
    onwriteError(stream, state, sync, er, cb);
  else {
    // Check if we're actually ready to finish, but don't emit yet
    var finished = needFinish(stream, state);

    if (!finished &&
        !state.corked &&
        !state.bufferProcessing &&
        state.buffer.length) {
      clearBuffer(stream, state);
    }

    if (sync) {
      process.nextTick(function() {
        afterWrite(stream, state, finished, cb);
      });
    } else {
      afterWrite(stream, state, finished, cb);
    }
  }
}

function afterWrite(stream, state, finished, cb) {
  if (!finished)
    onwriteDrain(stream, state);
  state.pendingcb--;
  cb();
  finishMaybe(stream, state);
}

// Must force callback to be called on nextTick, so that we don't
// emit 'drain' before the write() consumer gets the 'false' return
// value, and has a chance to attach a 'drain' listener.
function onwriteDrain(stream, state) {
  if (state.length === 0 && state.needDrain) {
    state.needDrain = false;
    stream.emit('drain');
  }
}


// if there's something in the buffer waiting, then process it
function clearBuffer(stream, state) {
  state.bufferProcessing = true;

  if (stream._writev && state.buffer.length > 1) {
    // Fast case, write everything using _writev()
    var cbs = [];
    for (var c = 0; c < state.buffer.length; c++)
      cbs.push(state.buffer[c].callback);

    // count the one we are adding, as well.
    // TODO(isaacs) clean this up
    state.pendingcb++;
    doWrite(stream, state, true, state.length, state.buffer, '', function(err) {
      for (var i = 0; i < cbs.length; i++) {
        state.pendingcb--;
        cbs[i](err);
      }
    });

    // Clear buffer
    state.buffer = [];
  } else {
    // Slow case, write chunks one-by-one
    for (var c = 0; c < state.buffer.length; c++) {
      var entry = state.buffer[c];
      var chunk = entry.chunk;
      var encoding = entry.encoding;
      var cb = entry.callback;
      var len = state.objectMode ? 1 : chunk.length;

      doWrite(stream, state, false, len, chunk, encoding, cb);

      // if we didn't call the onwrite immediately, then
      // it means that we need to wait until it does.
      // also, that means that the chunk and cb are currently
      // being processed, so move the buffer counter past them.
      if (state.writing) {
        c++;
        break;
      }
    }

    if (c < state.buffer.length)
      state.buffer = state.buffer.slice(c);
    else
      state.buffer.length = 0;
  }

  state.bufferProcessing = false;
}

Writable.prototype._write = function(chunk, encoding, cb) {
  cb(new Error('not implemented'));

};

Writable.prototype._writev = null;

Writable.prototype.end = function(chunk, encoding, cb) {
  var state = this._writableState;

  if (util.isFunction(chunk)) {
    cb = chunk;
    chunk = null;
    encoding = null;
  } else if (util.isFunction(encoding)) {
    cb = encoding;
    encoding = null;
  }

  if (!util.isNullOrUndefined(chunk))
    this.write(chunk, encoding);

  // .end() fully uncorks
  if (state.corked) {
    state.corked = 1;
    this.uncork();
  }

  // ignore unnecessary end() calls.
  if (!state.ending && !state.finished)
    endWritable(this, state, cb);
};


function needFinish(stream, state) {
  return (state.ending &&
          state.length === 0 &&
          !state.finished &&
          !state.writing);
}

function prefinish(stream, state) {
  if (!state.prefinished) {
    state.prefinished = true;
    stream.emit('prefinish');
  }
}

function finishMaybe(stream, state) {
  var need = needFinish(stream, state);
  if (need) {
    if (state.pendingcb === 0) {
      prefinish(stream, state);
      state.finished = true;
      stream.emit('finish');
    } else
      prefinish(stream, state);
  }
  return need;
}

function endWritable(stream, state, cb) {
  state.ending = true;
  finishMaybe(stream, state);
  if (cb) {
    if (state.finished)
      process.nextTick(cb);
    else
      stream.once('finish', cb);
  }
  state.ended = true;
}

}).call(this,require('_process'))
},{"./_stream_duplex":11,"_process":8,"buffer":2,"core-util-is":16,"inherits":17,"stream":9}],16:[function(require,module,exports){
(function (Buffer){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// NOTE: These type checking functions intentionally don't use `instanceof`
// because it is fragile and can be easily faked with `Object.create()`.
function isArray(ar) {
  return Array.isArray(ar);
}
exports.isArray = isArray;

function isBoolean(arg) {
  return typeof arg === 'boolean';
}
exports.isBoolean = isBoolean;

function isNull(arg) {
  return arg === null;
}
exports.isNull = isNull;

function isNullOrUndefined(arg) {
  return arg == null;
}
exports.isNullOrUndefined = isNullOrUndefined;

function isNumber(arg) {
  return typeof arg === 'number';
}
exports.isNumber = isNumber;

function isString(arg) {
  return typeof arg === 'string';
}
exports.isString = isString;

function isSymbol(arg) {
  return typeof arg === 'symbol';
}
exports.isSymbol = isSymbol;

function isUndefined(arg) {
  return arg === void 0;
}
exports.isUndefined = isUndefined;

function isRegExp(re) {
  return isObject(re) && objectToString(re) === '[object RegExp]';
}
exports.isRegExp = isRegExp;

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}
exports.isObject = isObject;

function isDate(d) {
  return isObject(d) && objectToString(d) === '[object Date]';
}
exports.isDate = isDate;

function isError(e) {
  return isObject(e) &&
      (objectToString(e) === '[object Error]' || e instanceof Error);
}
exports.isError = isError;

function isFunction(arg) {
  return typeof arg === 'function';
}
exports.isFunction = isFunction;

function isPrimitive(arg) {
  return arg === null ||
         typeof arg === 'boolean' ||
         typeof arg === 'number' ||
         typeof arg === 'string' ||
         typeof arg === 'symbol' ||  // ES6 symbol
         typeof arg === 'undefined';
}
exports.isPrimitive = isPrimitive;

function isBuffer(arg) {
  return Buffer.isBuffer(arg);
}
exports.isBuffer = isBuffer;

function objectToString(o) {
  return Object.prototype.toString.call(o);
}
}).call(this,require("buffer").Buffer)
},{"buffer":2}],17:[function(require,module,exports){
module.exports=require(7)
},{"/Users/gre/.nvm/v0.10.28/lib/node_modules/browserify/node_modules/inherits/inherits_browser.js":7}],18:[function(require,module,exports){
module.exports = Array.isArray || function (arr) {
  return Object.prototype.toString.call(arr) == '[object Array]';
};

},{}],19:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var Buffer = require('buffer').Buffer;

var isBufferEncoding = Buffer.isEncoding
  || function(encoding) {
       switch (encoding && encoding.toLowerCase()) {
         case 'hex': case 'utf8': case 'utf-8': case 'ascii': case 'binary': case 'base64': case 'ucs2': case 'ucs-2': case 'utf16le': case 'utf-16le': case 'raw': return true;
         default: return false;
       }
     }


function assertEncoding(encoding) {
  if (encoding && !isBufferEncoding(encoding)) {
    throw new Error('Unknown encoding: ' + encoding);
  }
}

// StringDecoder provides an interface for efficiently splitting a series of
// buffers into a series of JS strings without breaking apart multi-byte
// characters. CESU-8 is handled as part of the UTF-8 encoding.
//
// @TODO Handling all encodings inside a single object makes it very difficult
// to reason about this code, so it should be split up in the future.
// @TODO There should be a utf8-strict encoding that rejects invalid UTF-8 code
// points as used by CESU-8.
var StringDecoder = exports.StringDecoder = function(encoding) {
  this.encoding = (encoding || 'utf8').toLowerCase().replace(/[-_]/, '');
  assertEncoding(encoding);
  switch (this.encoding) {
    case 'utf8':
      // CESU-8 represents each of Surrogate Pair by 3-bytes
      this.surrogateSize = 3;
      break;
    case 'ucs2':
    case 'utf16le':
      // UTF-16 represents each of Surrogate Pair by 2-bytes
      this.surrogateSize = 2;
      this.detectIncompleteChar = utf16DetectIncompleteChar;
      break;
    case 'base64':
      // Base-64 stores 3 bytes in 4 chars, and pads the remainder.
      this.surrogateSize = 3;
      this.detectIncompleteChar = base64DetectIncompleteChar;
      break;
    default:
      this.write = passThroughWrite;
      return;
  }

  // Enough space to store all bytes of a single character. UTF-8 needs 4
  // bytes, but CESU-8 may require up to 6 (3 bytes per surrogate).
  this.charBuffer = new Buffer(6);
  // Number of bytes received for the current incomplete multi-byte character.
  this.charReceived = 0;
  // Number of bytes expected for the current incomplete multi-byte character.
  this.charLength = 0;
};


// write decodes the given buffer and returns it as JS string that is
// guaranteed to not contain any partial multi-byte characters. Any partial
// character found at the end of the buffer is buffered up, and will be
// returned when calling write again with the remaining bytes.
//
// Note: Converting a Buffer containing an orphan surrogate to a String
// currently works, but converting a String to a Buffer (via `new Buffer`, or
// Buffer#write) will replace incomplete surrogates with the unicode
// replacement character. See https://codereview.chromium.org/121173009/ .
StringDecoder.prototype.write = function(buffer) {
  var charStr = '';
  // if our last write ended with an incomplete multibyte character
  while (this.charLength) {
    // determine how many remaining bytes this buffer has to offer for this char
    var available = (buffer.length >= this.charLength - this.charReceived) ?
        this.charLength - this.charReceived :
        buffer.length;

    // add the new bytes to the char buffer
    buffer.copy(this.charBuffer, this.charReceived, 0, available);
    this.charReceived += available;

    if (this.charReceived < this.charLength) {
      // still not enough chars in this buffer? wait for more ...
      return '';
    }

    // remove bytes belonging to the current character from the buffer
    buffer = buffer.slice(available, buffer.length);

    // get the character that was split
    charStr = this.charBuffer.slice(0, this.charLength).toString(this.encoding);

    // CESU-8: lead surrogate (D800-DBFF) is also the incomplete character
    var charCode = charStr.charCodeAt(charStr.length - 1);
    if (charCode >= 0xD800 && charCode <= 0xDBFF) {
      this.charLength += this.surrogateSize;
      charStr = '';
      continue;
    }
    this.charReceived = this.charLength = 0;

    // if there are no more bytes in this buffer, just emit our char
    if (buffer.length === 0) {
      return charStr;
    }
    break;
  }

  // determine and set charLength / charReceived
  this.detectIncompleteChar(buffer);

  var end = buffer.length;
  if (this.charLength) {
    // buffer the incomplete character bytes we got
    buffer.copy(this.charBuffer, 0, buffer.length - this.charReceived, end);
    end -= this.charReceived;
  }

  charStr += buffer.toString(this.encoding, 0, end);

  var end = charStr.length - 1;
  var charCode = charStr.charCodeAt(end);
  // CESU-8: lead surrogate (D800-DBFF) is also the incomplete character
  if (charCode >= 0xD800 && charCode <= 0xDBFF) {
    var size = this.surrogateSize;
    this.charLength += size;
    this.charReceived += size;
    this.charBuffer.copy(this.charBuffer, size, 0, size);
    buffer.copy(this.charBuffer, 0, 0, size);
    return charStr.substring(0, end);
  }

  // or just emit the charStr
  return charStr;
};

// detectIncompleteChar determines if there is an incomplete UTF-8 character at
// the end of the given buffer. If so, it sets this.charLength to the byte
// length that character, and sets this.charReceived to the number of bytes
// that are available for this character.
StringDecoder.prototype.detectIncompleteChar = function(buffer) {
  // determine how many bytes we have to check at the end of this buffer
  var i = (buffer.length >= 3) ? 3 : buffer.length;

  // Figure out if one of the last i bytes of our buffer announces an
  // incomplete char.
  for (; i > 0; i--) {
    var c = buffer[buffer.length - i];

    // See http://en.wikipedia.org/wiki/UTF-8#Description

    // 110XXXXX
    if (i == 1 && c >> 5 == 0x06) {
      this.charLength = 2;
      break;
    }

    // 1110XXXX
    if (i <= 2 && c >> 4 == 0x0E) {
      this.charLength = 3;
      break;
    }

    // 11110XXX
    if (i <= 3 && c >> 3 == 0x1E) {
      this.charLength = 4;
      break;
    }
  }
  this.charReceived = i;
};

StringDecoder.prototype.end = function(buffer) {
  var res = '';
  if (buffer && buffer.length)
    res = this.write(buffer);

  if (this.charReceived) {
    var cr = this.charReceived;
    var buf = this.charBuffer;
    var enc = this.encoding;
    res += buf.slice(0, cr).toString(enc);
  }

  return res;
};

function passThroughWrite(buffer) {
  return buffer.toString(this.encoding);
}

function utf16DetectIncompleteChar(buffer) {
  this.charReceived = buffer.length % 2;
  this.charLength = this.charReceived ? 2 : 0;
}

function base64DetectIncompleteChar(buffer) {
  this.charReceived = buffer.length % 3;
  this.charLength = this.charReceived ? 3 : 0;
}

},{"buffer":2}],20:[function(require,module,exports){
module.exports = require("./lib/_stream_passthrough.js")

},{"./lib/_stream_passthrough.js":12}],21:[function(require,module,exports){
exports = module.exports = require('./lib/_stream_readable.js');
exports.Stream = require('stream');
exports.Readable = exports;
exports.Writable = require('./lib/_stream_writable.js');
exports.Duplex = require('./lib/_stream_duplex.js');
exports.Transform = require('./lib/_stream_transform.js');
exports.PassThrough = require('./lib/_stream_passthrough.js');

},{"./lib/_stream_duplex.js":11,"./lib/_stream_passthrough.js":12,"./lib/_stream_readable.js":13,"./lib/_stream_transform.js":14,"./lib/_stream_writable.js":15,"stream":9}],22:[function(require,module,exports){
module.exports = require("./lib/_stream_transform.js")

},{"./lib/_stream_transform.js":14}],23:[function(require,module,exports){
module.exports = require("./lib/_stream_writable.js")

},{"./lib/_stream_writable.js":15}],24:[function(require,module,exports){
module.exports={
  "loop": true,
  "timeline": [
  {
    "image": "./images/run.jpg",
    "duration": 4000,
    "kenburns": {
      "from": [ 0.5, [0.5, 0.6] ],
      "to": [ 1, [0.5, 0.6] ]
    },
    "transitionNext": {
      "name": "crosszoom",
      "duration": 1000
    }
  },
  {
    "image": "./images/barley.jpg",
    "duration": 3000,
    "kenburns": {
      "from": [ 0.9 ],
      "to": [ 0.7, [0.8, 0.6] ]
    },
    "transitionNext": {
      "name": "linearblur",
      "duration": 1000
    }
  },
  {
    "image": "./images/leaves.jpg",
    "duration": 5000,
    "kenburns": {
      "from": [ 0.7, [0, 0.5] ],
      "to": [ 0.7, [1, 0.5] ]
    },
    "transitionNext": {
      "name": "DoomScreenTransition",
      "duration": 2000
    }
  },
  {
    "image": "./images/gladiator.jpg",
    "duration": 5000,
    "kenburns": {
      "from": [ 0.3, [0.5, 0.8] ],
      "to": [ 1 ]
    },
    "transitionNext": {
      "name": "doorway",
      "duration": 1000
    }
  },
  {
    "image": "./images/train.jpg",
    "duration": 4000,
    "kenburns": {
      "from": [ 1 ],
      "to": [ 0.3 ]
    },
    "transitionNext": {
      "name": "heartwipe",
      "duration": 1000
    }
  },
  {
    "image": "./images/paris.jpg",
    "duration": 4000,
    "kenburns": {
      "from": [ 0.4, [1.0, 0.5] ],
      "to":   [ 1.0, [0.5, 0.5] ],
      "easing": [0.3,0,1,1]
    },
    "transitionNext": {
      "name": "pagecurl",
      "duration": 2000
    }
  }
  ]
}

},{}],25:[function(require,module,exports){
var Diaporama = require("diaporama");
var GlslTransitions = require("glsl-transitions");
var json = require("./diaporama.json");

document.body.style.background = "#000";
document.body.style.margin = "0";
document.body.style.overflow = "hidden";

var div = document.createElement("div");
div.style.width = window.innerWidth + "px";
div.style.height = window.innerHeight + "px";
document.body.appendChild(div);

var diaporama = new Diaporama({
  container: div,
  GlslTransitions: GlslTransitions,
  data: json
}).start();

},{"./diaporama.json":24,"diaporama":69,"glsl-transitions":70}],26:[function(require,module,exports){
/**
 * BezierEasing - use bezier curve for transition easing function
 * by Gaëtan Renaudeau 2014 – MIT License
 *
 * Credits: is based on Firefox's nsSMILKeySpline.cpp
 * Usage:
 * var spline = BezierEasing(0.25, 0.1, 0.25, 1.0)
 * spline(x) => returns the easing value | x must be in [0, 1] range
 *
 */
(function (definition) {
  if (typeof exports === "object") {
    module.exports = definition();
  } else if (typeof define === 'function' && define.amd) {
    define([], definition);
  } else {
    window.BezierEasing = definition();
  }
}(function () {
  var global = this;

  // These values are established by empiricism with tests (tradeoff: performance VS precision)
  var NEWTON_ITERATIONS = 4;
  var NEWTON_MIN_SLOPE = 0.001;
  var SUBDIVISION_PRECISION = 0.0000001;
  var SUBDIVISION_MAX_ITERATIONS = 10;

  var kSplineTableSize = 11;
  var kSampleStepSize = 1.0 / (kSplineTableSize - 1.0);

  var float32ArraySupported = 'Float32Array' in global;

  function BezierEasing (mX1, mY1, mX2, mY2) {
    // Validate arguments
    if (arguments.length !== 4) {
      throw new Error("BezierEasing requires 4 arguments.");
    }
    for (var i=0; i<4; ++i) {
      if (typeof arguments[i] !== "number" || isNaN(arguments[i]) || !isFinite(arguments[i])) {
        throw new Error("BezierEasing arguments should be integers.");
      } 
    }
    if (mX1 < 0 || mX1 > 1 || mX2 < 0 || mX2 > 1) {
      throw new Error("BezierEasing x values must be in [0, 1] range.");
    }

    var mSampleValues = float32ArraySupported ? new Float32Array(kSplineTableSize) : new Array(kSplineTableSize);
   
    function A (aA1, aA2) { return 1.0 - 3.0 * aA2 + 3.0 * aA1; }
    function B (aA1, aA2) { return 3.0 * aA2 - 6.0 * aA1; }
    function C (aA1)      { return 3.0 * aA1; }
   
    // Returns x(t) given t, x1, and x2, or y(t) given t, y1, and y2.
    function calcBezier (aT, aA1, aA2) {
      return ((A(aA1, aA2)*aT + B(aA1, aA2))*aT + C(aA1))*aT;
    }
   
    // Returns dx/dt given t, x1, and x2, or dy/dt given t, y1, and y2.
    function getSlope (aT, aA1, aA2) {
      return 3.0 * A(aA1, aA2)*aT*aT + 2.0 * B(aA1, aA2) * aT + C(aA1);
    }

    function newtonRaphsonIterate (aX, aGuessT) {
      for (var i = 0; i < NEWTON_ITERATIONS; ++i) {
        var currentSlope = getSlope(aGuessT, mX1, mX2);
        if (currentSlope === 0.0) return aGuessT;
        var currentX = calcBezier(aGuessT, mX1, mX2) - aX;
        aGuessT -= currentX / currentSlope;
      }
      return aGuessT;
    }

    function calcSampleValues () {
      for (var i = 0; i < kSplineTableSize; ++i) {
        mSampleValues[i] = calcBezier(i * kSampleStepSize, mX1, mX2);
      }
    }

    function binarySubdivide (aX, aA, aB) {
      var currentX, currentT, i = 0;
      do {
        currentT = aA + (aB - aA) / 2.0;
        currentX = calcBezier(currentT, mX1, mX2) - aX;
        if (currentX > 0.0) {
          aB = currentT;
        } else {
          aA = currentT;
        }
      } while (Math.abs(currentX) > SUBDIVISION_PRECISION && ++i < SUBDIVISION_MAX_ITERATIONS);
      return currentT;
    }

    function getTForX (aX) {
      var intervalStart = 0.0;
      var currentSample = 1;
      var lastSample = kSplineTableSize - 1;

      for (; currentSample != lastSample && mSampleValues[currentSample] <= aX; ++currentSample) {
        intervalStart += kSampleStepSize;
      }
      --currentSample;

      // Interpolate to provide an initial guess for t
      var dist = (aX - mSampleValues[currentSample]) / (mSampleValues[currentSample+1] - mSampleValues[currentSample]);
      var guessForT = intervalStart + dist * kSampleStepSize;

      var initialSlope = getSlope(guessForT, mX1, mX2);
      if (initialSlope >= NEWTON_MIN_SLOPE) {
        return newtonRaphsonIterate(aX, guessForT);
      } else if (initialSlope === 0.0) {
        return guessForT;
      } else {
        return binarySubdivide(aX, intervalStart, intervalStart + kSampleStepSize);
      }
    }

    var _precomputed = false;
    function precompute() {
      _precomputed = true;
      if (mX1 != mY1 || mX2 != mY2)
        calcSampleValues();
    }

    var f = function (aX) {
      if (!_precomputed) precompute();
      if (mX1 === mY1 && mX2 === mY2) return aX; // linear
      // Because JavaScript number are imprecise, we should guarantee the extremes are right.
      if (aX === 0) return 0;
      if (aX === 1) return 1;
      return calcBezier(getTForX(aX), mY1, mY2);
    };

    f.getControlPoints = function() { return [{ x: mX1, y: mY1 }, { x: mX2, y: mY2 }]; };

    var args = [mX1, mY1, mX2, mY2];
    var str = "BezierEasing("+args+")";
    f.toString = function () { return str; };

    var css = "cubic-bezier("+args+")";
    f.toCSS = function () { return css; };

    return f;
  }

  // CSS mapping
  BezierEasing.css = {
    "ease":        BezierEasing(0.25, 0.1, 0.25, 1.0),
    "linear":      BezierEasing(0.00, 0.0, 1.00, 1.0),
    "ease-in":     BezierEasing(0.42, 0.0, 1.00, 1.0),
    "ease-out":    BezierEasing(0.00, 0.0, 0.58, 1.0),
    "ease-in-out": BezierEasing(0.42, 0.0, 0.58, 1.0)
  };

  return BezierEasing;

}));

},{}],27:[function(require,module,exports){
"use strict"

module.exports = createAttributeWrapper

//Shader attribute class
function ShaderAttribute(gl, program, location, dimension, name, constFunc, relink) {
  this._gl = gl
  this._program = program
  this._location = location
  this._dimension = dimension
  this._name = name
  this._constFunc = constFunc
  this._relink = relink
}

var proto = ShaderAttribute.prototype

proto.pointer = function setAttribPointer(type, normalized, stride, offset) {
  var gl = this._gl
  gl.vertexAttribPointer(this._location, this._dimension, type||gl.FLOAT, normalized?gl.TRUE:gl.FALSE, stride||0, offset||0)
  this._gl.enableVertexAttribArray(this._location)
}

Object.defineProperty(proto, "location", {
  get: function() {
    return this._location
  }
  , set: function(v) {
    if(v !== this._location) {
      this._location = v
      this._gl.bindAttribLocation(this._program, v, this._name)
      this._gl.linkProgram(this._program)
      this._relink()
    }
  }
})


//Adds a vector attribute to obj
function addVectorAttribute(gl, program, location, dimension, obj, name, doLink) {
  var constFuncArgs = [ "gl", "v" ]
  var varNames = []
  for(var i=0; i<dimension; ++i) {
    constFuncArgs.push("x"+i)
    varNames.push("x"+i)
  }
  constFuncArgs.push([
    "if(x0.length===undefined){return gl.vertexAttrib", dimension, "f(v,", varNames.join(","), ")}else{return gl.vertexAttrib", dimension, "fv(v,x0)}"
  ].join(""))
  var constFunc = Function.apply(undefined, constFuncArgs)
  var attr = new ShaderAttribute(gl, program, location, dimension, name, constFunc, doLink)
  Object.defineProperty(obj, name, {
    set: function(x) {
      gl.disableVertexAttribArray(attr._location)
      constFunc(gl, attr._location, x)
      return x
    }
    , get: function() {
      return attr
    }
    , enumerable: true
  })
}

//Create shims for attributes
function createAttributeWrapper(gl, program, attributes, doLink) {
  var obj = {}
  for(var i=0, n=attributes.length; i<n; ++i) {
    var a = attributes[i]
    var name = a.name
    var type = a.type
    var location = gl.getAttribLocation(program, name)
    
    switch(type) {
      case "bool":
      case "int":
      case "float":
        addVectorAttribute(gl, program, location, 1, obj, name, doLink)
      break
      
      default:
        if(type.indexOf("vec") >= 0) {
          var d = type.charCodeAt(type.length-1) - 48
          if(d < 2 || d > 4) {
            throw new Error("Invalid data type for attribute " + name + ": " + type)
          }
          addVectorAttribute(gl, program, location, d, obj, name, doLink)
        } else {
          throw new Error("Unknown data type for attribute " + name + ": " + type)
        }
      break
    }
  }
  return obj
}

},{}],28:[function(require,module,exports){
"use strict"

var dup = require("dup")
var coallesceUniforms = require("./reflect.js")

module.exports = createUniformWrapper

//Binds a function and returns a value
function identity(x) {
  var c = new Function("y", "return function(){return y}")
  return c(x)
}

//Create shims for uniforms
function createUniformWrapper(gl, program, uniforms, locations) {

  function makeGetter(index) {
    var proc = new Function("gl", "prog", "locations", 
      "return function(){return gl.getUniform(prog,locations[" + index + "])}") 
    return proc(gl, program, locations)
  }

  function makePropSetter(path, index, type) {
    switch(type) {
      case "bool":
      case "int":
      case "sampler2D":
      case "samplerCube":
        return "gl.uniform1i(locations[" + index + "],obj" + path + ")"
      case "float":
        return "gl.uniform1f(locations[" + index + "],obj" + path + ")"
      default:
        var vidx = type.indexOf("vec")
        if(0 <= vidx && vidx <= 1 && type.length === 4 + vidx) {
          var d = type.charCodeAt(type.length-1) - 48
          if(d < 2 || d > 4) {
            throw new Error("Invalid data type")
          }
          switch(type.charAt(0)) {
            case "b":
            case "i":
              return "gl.uniform" + d + "iv(locations[" + index + "],obj" + path + ")"
            case "v":
              return "gl.uniform" + d + "fv(locations[" + index + "],obj" + path + ")"            
            default:
              throw new Error("Unrecognized data type for vector " + name + ": " + type)
          }
        } else if(type.indexOf("mat") === 0 && type.length === 4) {
          var d = type.charCodeAt(type.length-1) - 48
          if(d < 2 || d > 4) {
            throw new Error("Invalid uniform dimension type for matrix " + name + ": " + type)
          }
          return "gl.uniformMatrix" + d + "fv(locations[" + index + "],false,obj" + path + ")"
        } else {
          throw new Error("Unknown uniform data type for " + name + ": " + type)
        }
      break
    }
  }

  function enumerateIndices(prefix, type) {
    if(typeof type !== "object") {
      return [ [prefix, type] ]
    }
    var indices = []
    for(var id in type) {
      var prop = type[id]
      var tprefix = prefix
      if(parseInt(id) + "" === id) {
        tprefix += "[" + id + "]"
      } else {
        tprefix += "." + id
      }
      if(typeof prop === "object") {
        indices.push.apply(indices, enumerateIndices(tprefix, prop))
      } else {
        indices.push([tprefix, prop])
      }
    }
    return indices
  }

  function makeSetter(type) {
    var code = [ "return function updateProperty(obj){" ]
    var indices = enumerateIndices("", type)
    for(var i=0; i<indices.length; ++i) {
      var item = indices[i]
      var path = item[0]
      var idx  = item[1]
      if(locations[idx]) {
        code.push(makePropSetter(path, idx, uniforms[idx].type))
      }
    }
    code.push("return obj}")
    var proc = new Function("gl", "prog", "locations", code.join("\n"))
    return proc(gl, program, locations)
  }

  function defaultValue(type) {
    switch(type) {
      case "bool":
        return false
      case "int":
      case "sampler2D":
      case "samplerCube":
        return 0
      case "float":
        return 0.0
      default:
        var vidx = type.indexOf("vec")
        if(0 <= vidx && vidx <= 1 && type.length === 4 + vidx) {
          var d = type.charCodeAt(type.length-1) - 48
          if(d < 2 || d > 4) {
            throw new Error("Invalid data type")
          }
          if(type.charAt(0) === "b") {
            return dup(d, false)
          }
          return dup(d)
        } else if(type.indexOf("mat") === 0 && type.length === 4) {
          var d = type.charCodeAt(type.length-1) - 48
          if(d < 2 || d > 4) {
            throw new Error("Invalid uniform dimension type for matrix " + name + ": " + type)
          }
          return dup([d,d])
        } else {
          throw new Error("Unknown uniform data type for " + name + ": " + type)
        }
      break
    }
  }

  function storeProperty(obj, prop, type) {
    if(typeof type === "object") {
      var child = processObject(type)
      Object.defineProperty(obj, prop, {
        get: identity(child),
        set: makeSetter(type),
        enumerable: true,
        configurable: false
      })
    } else {
      if(locations[type]) {
        Object.defineProperty(obj, prop, {
          get: makeGetter(type),
          set: makeSetter(type),
          enumerable: true,
          configurable: false
        })
      } else {
        obj[prop] = defaultValue(uniforms[type].type)
      }
    }
  }

  function processObject(obj) {
    var result
    if(Array.isArray(obj)) {
      result = new Array(obj.length)
      for(var i=0; i<obj.length; ++i) {
        storeProperty(result, i, obj[i])
      }
    } else {
      result = {}
      for(var id in obj) {
        storeProperty(result, id, obj[id])
      }
    }
    return result
  }

  //Return data
  var coallesced = coallesceUniforms(uniforms, true)
  return {
    get: identity(processObject(coallesced)),
    set: makeSetter(coallesced),
    enumerable: true,
    configurable: true
  }
}

},{"./reflect.js":29,"dup":30}],29:[function(require,module,exports){
"use strict"

module.exports = makeReflectTypes

//Construct type info for reflection.
//
// This iterates over the flattened list of uniform type values and smashes them into a JSON object.
//
// The leaves of the resulting object are either indices or type strings representing primitive glslify types
function makeReflectTypes(uniforms, useIndex) {
  var obj = {}
  for(var i=0; i<uniforms.length; ++i) {
    var n = uniforms[i].name
    var parts = n.split(".")
    var o = obj
    for(var j=0; j<parts.length; ++j) {
      var x = parts[j].split("[")
      if(x.length > 1) {
        if(!(x[0] in o)) {
          o[x[0]] = []
        }
        o = o[x[0]]
        for(var k=1; k<x.length; ++k) {
          var y = parseInt(x[k])
          if(k<x.length-1 || j<parts.length-1) {
            if(!(y in o)) {
              if(k < x.length-1) {
                o[y] = []
              } else {
                o[y] = {}
              }
            }
            o = o[y]
          } else {
            if(useIndex) {
              o[y] = i
            } else {
              o[y] = uniforms[i].type
            }
          }
        }
      } else if(j < parts.length-1) {
        if(!(x[0] in o)) {
          o[x[0]] = {}
        }
        o = o[x[0]]
      } else {
        if(useIndex) {
          o[x[0]] = i
        } else {
          o[x[0]] = uniforms[i].type
        }
      }
    }
  }
  return obj
}
},{}],30:[function(require,module,exports){
"use strict"

function dupe_array(count, value, i) {
  var c = count[i]|0
  if(c <= 0) {
    return []
  }
  var result = new Array(c), j
  if(i === count.length-1) {
    for(j=0; j<c; ++j) {
      result[j] = value
    }
  } else {
    for(j=0; j<c; ++j) {
      result[j] = dupe_array(count, value, i+1)
    }
  }
  return result
}

function dupe_number(count, value) {
  var result, i
  result = new Array(count)
  for(i=0; i<count; ++i) {
    result[i] = value
  }
  return result
}

function dupe(count, value) {
  if(typeof value === "undefined") {
    value = 0
  }
  switch(typeof count) {
    case "number":
      if(count > 0) {
        return dupe_number(count|0, value)
      }
    break
    case "object":
      if(typeof (count.length) === "number") {
        return dupe_array(count, value, 0)
      }
    break
  }
  return []
}

module.exports = dupe
},{}],31:[function(require,module,exports){
"use strict"

var createUniformWrapper = require("./lib/create-uniforms.js")
var createAttributeWrapper = require("./lib/create-attributes.js")
var makeReflect = require("./lib/reflect.js")

//Shader object
function Shader(gl, prog, vertShader, fragShader) {
  this.gl = gl
  this.handle = prog
  this.attributes = null
  this.uniforms = null
  this.types = null
  this.vertexShader = vertShader
  this.fragmentShader = fragShader
}

//Binds the shader
Shader.prototype.bind = function() {
  this.gl.useProgram(this.handle)
}

//Destroy shader, release resources
Shader.prototype.dispose = function() {
  var gl = this.gl
  gl.deleteShader(this.vertexShader)
  gl.deleteShader(this.fragmentShader)
  gl.deleteProgram(this.handle)
}

Shader.prototype.updateExports = function(uniforms, attributes) {
  var locations = new Array(uniforms.length)
  var program = this.handle
  var gl = this.gl

  var doLink = relinkUniforms.bind(void 0,
    gl,
    program,
    locations,
    uniforms
  )
  doLink()

  this.types = {
    uniforms: makeReflect(uniforms),
    attributes: makeReflect(attributes)
  }

  this.attributes = createAttributeWrapper(
    gl,
    program,
    attributes,
    doLink
  )

  Object.defineProperty(this, "uniforms", createUniformWrapper(
    gl,
    program,
    uniforms,
    locations
  ))
}

//Relinks all uniforms
function relinkUniforms(gl, program, locations, uniforms) {
  for(var i=0; i<uniforms.length; ++i) {
    locations[i] = gl.getUniformLocation(program, uniforms[i].name)
  }
}

//Compiles and links a shader program with the given attribute and vertex list
function createShader(
    gl
  , vertSource
  , fragSource
  , uniforms
  , attributes) {
  
  //Compile vertex shader
  var vertShader = gl.createShader(gl.VERTEX_SHADER)
  gl.shaderSource(vertShader, vertSource)
  gl.compileShader(vertShader)
  if(!gl.getShaderParameter(vertShader, gl.COMPILE_STATUS)) {
    throw new Error("Error compiling vertex shader: " + gl.getShaderInfoLog(vertShader))
  }
  
  //Compile fragment shader
  var fragShader = gl.createShader(gl.FRAGMENT_SHADER)
  gl.shaderSource(fragShader, fragSource)
  gl.compileShader(fragShader)
  if(!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
    throw new Error("Error compiling fragment shader: " + gl.getShaderInfoLog(fragShader))
  }
  
  //Link program
  var program = gl.createProgram()
  gl.attachShader(program, fragShader)
  gl.attachShader(program, vertShader)
  gl.linkProgram(program)
  if(!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error("Error linking shader program: " + gl.getProgramInfoLog (program))
  }
  
  //Return final linked shader object
  var shader = new Shader(
    gl,
    program,
    vertShader,
    fragShader
  )
  shader.updateExports(uniforms, attributes)

  return shader
}

module.exports = createShader

},{"./lib/create-attributes.js":27,"./lib/create-uniforms.js":28,"./lib/reflect.js":29}],32:[function(require,module,exports){
"use strict"

var glslTokenizer = require("glsl-tokenizer")
var glslParser = require("glsl-parser")
var through = require("through")

function parseDeclaration(x) {
  var type, identifiers = [], i
  for(var i=0; i<x.children.length; ++i) {
    var c = x.children[i]
    if(c.type === "placeholder") {
      continue
    } else if(c.type === "keyword") {
      if(c.token.data === "uniform" ||
         c.token.data === "attribute") {
        continue
      }
      type = c.token.data
    } else if(c.type === "decllist") {
      for(var j=0; j<c.children.length; ++j) {
        var d = c.children[j]
        if(d.type === "ident") {
          identifiers.push(d.token.data)
        }
      }
    }
  }
  return {
    type: type,
    vars: identifiers
  }
}

function glslGlobals(src) {
  var uniforms = {}
  var attributes = {}
  var strm = through()
  strm.pipe(glslTokenizer()).pipe(glslParser()).on('data', function(x) {
    if(x.type === "decl" && x.token.type === "keyword") {
      if(x.token.data === "uniform") {
        var result = parseDeclaration(x)
        for(var i=0; i<result.vars.length; ++i) {
          uniforms[result.vars[i]] = result.type
        }
      } else if(x.token.data === "attribute") {
        var result = parseDeclaration(x)
        for(var i=0; i<result.vars.length; ++i) {
          attributes[result.vars[i]] = result.type
        }
      }
    }
  })
  strm.write(src)
  return {
    uniforms: uniforms,
    attributes: attributes
  };
}

module.exports = glslGlobals
},{"glsl-parser":33,"glsl-tokenizer":38,"through":42}],33:[function(require,module,exports){
module.exports = require('./lib/index')

},{"./lib/index":35}],34:[function(require,module,exports){
var state
  , token
  , tokens
  , idx

var original_symbol = {
    nud: function() { return this.children && this.children.length ? this : fail('unexpected')() }
  , led: fail('missing operator')
}

var symbol_table = {}

function itself() {
  return this
}

symbol('(ident)').nud = itself
symbol('(keyword)').nud = itself
symbol('(builtin)').nud = itself
symbol('(literal)').nud = itself
symbol('(end)')

symbol(':')
symbol(';')
symbol(',')
symbol(')')
symbol(']')
symbol('}')

infixr('&&', 30)
infixr('||', 30)
infix('|', 43)
infix('^', 44)
infix('&', 45)
infix('==', 46)
infix('!=', 46)
infix('<', 47)
infix('<=', 47)
infix('>', 47)
infix('>=', 47)
infix('>>', 48)
infix('<<', 48)
infix('+', 50)
infix('-', 50)
infix('*', 60)
infix('/', 60)
infix('%', 60)
infix('?', 20, function(left) {
  this.children = [left, expression(0), (advance(':'), expression(0))]
  this.type = 'ternary'
  return this
})
infix('.', 80, function(left) {
  token.type = 'literal'
  state.fake(token)
  this.children = [left, token]
  advance()
  return this
})
infix('[', 80, function(left) {
  this.children = [left, expression(0)]
  this.type = 'binary'
  advance(']')
  return this
})
infix('(', 80, function(left) {
  this.children = [left]
  this.type = 'call'

  if(token.data !== ')') while(1) {
    this.children.push(expression(0))
    if(token.data !== ',') break
    advance(',')
  }
  advance(')')
  return this
})

prefix('-')
prefix('+')
prefix('!')
prefix('~')
prefix('defined')
prefix('(', function() {
  this.type = 'group'
  this.children = [expression(0)]
  advance(')')
  return this 
})
prefix('++')
prefix('--')
suffix('++')
suffix('--')

assignment('=')
assignment('+=')
assignment('-=')
assignment('*=')
assignment('/=')
assignment('%=')
assignment('&=')
assignment('|=')
assignment('^=')
assignment('>>=')
assignment('<<=')

module.exports = function(incoming_state, incoming_tokens) {
  state = incoming_state
  tokens = incoming_tokens
  idx = 0
  var result

  if(!tokens.length) return

  advance()
  result = expression(0)
  result.parent = state[0]
  emit(result)

  if(idx < tokens.length) {
    throw new Error('did not use all tokens')
  }

  result.parent.children = [result]

  function emit(node) {
    state.unshift(node, false)
    for(var i = 0, len = node.children.length; i < len; ++i) {
      emit(node.children[i])
    }
    state.shift()
  }

}

function symbol(id, binding_power) {
  var sym = symbol_table[id]
  binding_power = binding_power || 0
  if(sym) {
    if(binding_power > sym.lbp) {
      sym.lbp = binding_power
    }
  } else {
    sym = Object.create(original_symbol)
    sym.id = id 
    sym.lbp = binding_power
    symbol_table[id] = sym
  }
  return sym
}

function expression(rbp) {
  var left, t = token
  advance()

  left = t.nud()
  while(rbp < token.lbp) {
    t = token
    advance()
    left = t.led(left)
  }
  return left
}

function infix(id, bp, led) {
  var sym = symbol(id, bp)
  sym.led = led || function(left) {
    this.children = [left, expression(bp)]
    this.type = 'binary'
    return this
  }
}

function infixr(id, bp, led) {
  var sym = symbol(id, bp)
  sym.led = led || function(left) {
    this.children = [left, expression(bp - 1)]
    this.type = 'binary'
    return this
  }
  return sym
}

function prefix(id, nud) {
  var sym = symbol(id)
  sym.nud = nud || function() {
    this.children = [expression(70)]
    this.type = 'unary'
    return this
  }
  return sym
}

function suffix(id) {
  var sym = symbol(id, 150)
  sym.led = function(left) {
    this.children = [left]
    this.type = 'suffix'
    return this
  }
}

function assignment(id) {
  return infixr(id, 10, function(left) {
    this.children = [left, expression(9)]
    this.assignment = true
    this.type = 'assign'
    return this
  })
}

function advance(id) {
  var next
    , value
    , type
    , output

  if(id && token.data !== id) {
    return state.unexpected('expected `'+ id + '`, got `'+token.data+'`')
  }

  if(idx >= tokens.length) {
    token = symbol_table['(end)']
    return
  }

  next = tokens[idx++]
  value = next.data
  type = next.type

  if(type === 'ident') {
    output = state.scope.find(value) || state.create_node()
    type = output.type
  } else if(type === 'builtin') {
    output = symbol_table['(builtin)']
  } else if(type === 'keyword') {
    output = symbol_table['(keyword)']
  } else if(type === 'operator') {
    output = symbol_table[value]
    if(!output) {
      return state.unexpected('unknown operator `'+value+'`')
    }
  } else if(type === 'float' || type === 'integer') {
    type = 'literal'
    output = symbol_table['(literal)']
  } else {
    return state.unexpected('unexpected token.')
  }

  if(output) {
    if(!output.nud) { output.nud = itself }
    if(!output.children) { output.children = [] }
  }

  output = Object.create(output)
  output.token = next
  output.type = type
  if(!output.data) output.data = value

  return token = output
}

function fail(message) {
  return function() { return state.unexpected(message) }
}

},{}],35:[function(require,module,exports){
module.exports = parser

var through = require('through')
  , full_parse_expr = require('./expr')
  , Scope = require('./scope')

// singleton!
var Advance = new Object

var DEBUG = false

var _ = 0
  , IDENT = _++
  , STMT = _++
  , STMTLIST = _++
  , STRUCT = _++
  , FUNCTION = _++
  , FUNCTIONARGS = _++
  , DECL = _++
  , DECLLIST = _++
  , FORLOOP = _++
  , WHILELOOP = _++
  , IF = _++
  , EXPR = _++
  , PRECISION = _++
  , COMMENT = _++
  , PREPROCESSOR = _++
  , KEYWORD = _++
  , KEYWORD_OR_IDENT = _++
  , RETURN = _++
  , BREAK = _++
  , CONTINUE = _++
  , DISCARD = _++
  , DOWHILELOOP = _++
  , PLACEHOLDER = _++
  , QUANTIFIER = _++

var DECL_ALLOW_ASSIGN = 0x1
  , DECL_ALLOW_COMMA = 0x2
  , DECL_REQUIRE_NAME = 0x4
  , DECL_ALLOW_INVARIANT = 0x8
  , DECL_ALLOW_STORAGE = 0x10
  , DECL_NO_INOUT = 0x20
  , DECL_ALLOW_STRUCT = 0x40
  , DECL_STATEMENT = 0xFF
  , DECL_FUNCTION = DECL_STATEMENT & ~(DECL_ALLOW_ASSIGN | DECL_ALLOW_COMMA | DECL_NO_INOUT | DECL_ALLOW_INVARIANT | DECL_REQUIRE_NAME)
  , DECL_STRUCT = DECL_STATEMENT & ~(DECL_ALLOW_ASSIGN | DECL_ALLOW_INVARIANT | DECL_ALLOW_STORAGE | DECL_ALLOW_STRUCT)

var QUALIFIERS = ['const', 'attribute', 'uniform', 'varying']

var NO_ASSIGN_ALLOWED = false
  , NO_COMMA_ALLOWED = false

// map of tokens to stmt types
var token_map = {
    'block-comment': COMMENT
  , 'line-comment': COMMENT
  , 'preprocessor': PREPROCESSOR
}

// map of stmt types to human
var stmt_type = _ = [ 
    'ident'
  , 'stmt'
  , 'stmtlist'
  , 'struct'
  , 'function'
  , 'functionargs'
  , 'decl'
  , 'decllist'
  , 'forloop'
  , 'whileloop'
  , 'if'
  , 'expr'
  , 'precision'
  , 'comment'
  , 'preprocessor'
  , 'keyword'
  , 'keyword_or_ident'
  , 'return'
  , 'break'
  , 'continue'
  , 'discard'
  , 'do-while'
  , 'placeholder'
  , 'quantifier'
]

function parser() {
  var stmtlist = n(STMTLIST)
    , stmt = n(STMT)
    , decllist = n(DECLLIST)
    , precision = n(PRECISION)
    , ident = n(IDENT)
    , keyword_or_ident = n(KEYWORD_OR_IDENT)
    , fn = n(FUNCTION)
    , fnargs = n(FUNCTIONARGS)
    , forstmt = n(FORLOOP)
    , ifstmt = n(IF)
    , whilestmt = n(WHILELOOP)
    , returnstmt = n(RETURN)
    , dowhilestmt = n(DOWHILELOOP)
    , quantifier = n(QUANTIFIER)

  var parse_struct
    , parse_precision
    , parse_quantifier
    , parse_forloop
    , parse_if
    , parse_return
    , parse_whileloop
    , parse_dowhileloop
    , parse_function
    , parse_function_args

  var stream = through(write, end)
    , check = arguments.length ? [].slice.call(arguments) : []
    , depth = 0
    , state = []
    , tokens = []
    , whitespace = []
    , errored = false
    , program
    , token
    , node

  // setup state
  state.shift = special_shift
  state.unshift = special_unshift
  state.fake = special_fake
  state.unexpected = unexpected
  state.scope = new Scope(state)
  state.create_node = function() {
    var n = mknode(IDENT, token)
    n.parent = stream.program
    return n
  }

  setup_stative_parsers()

  // setup root node
  node = stmtlist()
  node.expecting = '(eof)'
  node.mode = STMTLIST
  node.token = {type: '(program)', data: '(program)'}
  program = node

  stream.program = program
  stream.scope = function(scope) {
    if(arguments.length === 1) {
      state.scope = scope
    }
    return state.scope
  }

  state.unshift(node)
  return stream

  // stream functions ---------------------------------------------

  function write(input) {
    if(input.type === 'whitespace' || input.type === 'line-comment' || input.type === 'block-comment') {

      whitespace.push(input)
      return
    }
    tokens.push(input)
    token = token || tokens[0]

    if(token && whitespace.length) {
      token.preceding = token.preceding || []
      token.preceding = token.preceding.concat(whitespace)
      whitespace = []
    }

    while(take()) switch(state[0].mode) {
      case STMT: parse_stmt(); break
      case STMTLIST: parse_stmtlist(); break
      case DECL: parse_decl(); break
      case DECLLIST: parse_decllist(); break
      case EXPR: parse_expr(); break
      case STRUCT: parse_struct(true, true); break
      case PRECISION: parse_precision(); break
      case IDENT: parse_ident(); break
      case KEYWORD: parse_keyword(); break
      case KEYWORD_OR_IDENT: parse_keyword_or_ident(); break
      case FUNCTION: parse_function(); break
      case FUNCTIONARGS: parse_function_args(); break
      case FORLOOP: parse_forloop(); break
      case WHILELOOP: parse_whileloop(); break
      case DOWHILELOOP: parse_dowhileloop(); break
      case RETURN: parse_return(); break
      case IF: parse_if(); break
      case QUANTIFIER: parse_quantifier(); break
    }
  }
  
  function end(tokens) {
    if(arguments.length) {
      write(tokens)
    }

    if(state.length > 1) {
      unexpected('unexpected EOF')
      return
    }

    stream.emit('end')
  }

  function take() {
    if(errored || !state.length)
      return false

    return (token = tokens[0]) && !stream.paused
  }

  // ----- state manipulation --------

  function special_fake(x) {
    state.unshift(x)
    state.shift()
  }

  function special_unshift(_node, add_child) {
    _node.parent = state[0]

    var ret = [].unshift.call(this, _node)

    add_child = add_child === undefined ? true : add_child

    if(DEBUG) {
      var pad = ''
      for(var i = 0, len = this.length - 1; i < len; ++i) {
        pad += ' |'
      }
      console.log(pad, '\\'+_node.type, _node.token.data)
    }

    if(add_child && node !== _node) node.children.push(_node)
    node = _node

    return ret
  }

  function special_shift() {
    var _node = [].shift.call(this)
      , okay = check[this.length]
      , emit = false

    if(DEBUG) {
      var pad = ''
      for(var i = 0, len = this.length; i < len; ++i) {
        pad += ' |'
      }
      console.log(pad, '/'+_node.type)
    }

    if(check.length) { 
      if(typeof check[0] === 'function') {
        emit = check[0](_node)
      } else if(okay !== undefined) {
        emit = okay.test ? okay.test(_node.type) : okay === _node.type
      }
    } else {
      emit = true
    }

    if(emit) stream.emit('data', _node) 
  
    node = _node.parent
    return _node
  }

  // parse states ---------------

  function parse_stmtlist() {
    // determine the type of the statement
    // and then start parsing
    return stative(
      function() { state.scope.enter(); return Advance }
    , normal_mode
    )()

    function normal_mode() {
      if(token.data === state[0].expecting) {
        return state.scope.exit(), state.shift()
      }
      switch(token.type) {
        case 'preprocessor':
          state.fake(adhoc())
          tokens.shift()
        return
        default:
          state.unshift(stmt())
        return 
      }
    }
  }

  function parse_stmt() {
    if(state[0].brace) {
      if(token.data !== '}') {
        return unexpected('expected `}`, got '+token.data)
      }
      state[0].brace = false
      return tokens.shift(), state.shift()
    }
    switch(token.type) {
      case 'eof': return state.shift()
      case 'keyword': 
        switch(token.data) {
          case 'for': return state.unshift(forstmt());
          case 'if': return state.unshift(ifstmt());
          case 'while': return state.unshift(whilestmt());
          case 'do': return state.unshift(dowhilestmt());
          case 'break': return state.fake(mknode(BREAK, token)), tokens.shift()
          case 'continue': return state.fake(mknode(CONTINUE, token)), tokens.shift()
          case 'discard': return state.fake(mknode(DISCARD, token)), tokens.shift()
          case 'return': return state.unshift(returnstmt());
          case 'precision': return state.unshift(precision());
        }
        return state.unshift(decl(DECL_STATEMENT))
      case 'ident':
        var lookup
        if(lookup = state.scope.find(token.data)) {
          if(lookup.parent.type === 'struct') {
            // this is strictly untrue, you could have an
            // expr that starts with a struct constructor.
            //      ... sigh
            return state.unshift(decl(DECL_STATEMENT))
          }
          return state.unshift(expr(';'))
        }
      case 'operator':
        if(token.data === '{') {
          state[0].brace = true
          var n = stmtlist()
          n.expecting = '}'
          return tokens.shift(), state.unshift(n)
        }
        if(token.data === ';') {
          return tokens.shift(), state.shift()
        }
      default: return state.unshift(expr(';'))
    }
  }

  function parse_decl() {
    var stmt = state[0]

    return stative(
      invariant_or_not,
      storage_or_not,
      parameter_or_not,
      precision_or_not,
      struct_or_type,
      maybe_name,
      maybe_lparen,     // lparen means we're a function
      is_decllist,
      done
    )()

    function invariant_or_not() {
      if(token.data === 'invariant') {
        if(stmt.flags & DECL_ALLOW_INVARIANT) {
          state.unshift(keyword())
          return Advance
        } else {
          return unexpected('`invariant` is not allowed here') 
        }
      } else {
        state.fake(mknode(PLACEHOLDER, {data: '', position: token.position}))
        return Advance
      }
    }

    function storage_or_not() {
      if(is_storage(token)) {
        if(stmt.flags & DECL_ALLOW_STORAGE) {
          state.unshift(keyword()) 
          return Advance
        } else {
          return unexpected('storage is not allowed here') 
        }
      } else {
        state.fake(mknode(PLACEHOLDER, {data: '', position: token.position}))
        return Advance
      }
    }

    function parameter_or_not() {
      if(is_parameter(token)) {
        if(!(stmt.flags & DECL_NO_INOUT)) {
          state.unshift(keyword()) 
          return Advance
        } else {
          return unexpected('parameter is not allowed here') 
        }
      } else {
        state.fake(mknode(PLACEHOLDER, {data: '', position: token.position}))
        return Advance
      }
    }

    function precision_or_not() {
      if(is_precision(token)) {
        state.unshift(keyword())
        return Advance
      } else {
        state.fake(mknode(PLACEHOLDER, {data: '', position: token.position}))
        return Advance
      }
    }

    function struct_or_type() {
      if(token.data === 'struct') {
        if(!(stmt.flags & DECL_ALLOW_STRUCT)) {
          return unexpected('cannot nest structs')
        }
        state.unshift(struct())
        return Advance
      }

      if(token.type === 'keyword') {
        state.unshift(keyword())
        return Advance
      }

      var lookup = state.scope.find(token.data)

      if(lookup) {
        state.fake(Object.create(lookup))
        tokens.shift()
        return Advance  
      }
      return unexpected('expected user defined type, struct or keyword, got '+token.data)
    }

    function maybe_name() {
      if(token.data === ',' && !(stmt.flags & DECL_ALLOW_COMMA)) {
        return state.shift()
      }

      if(token.data === '[') {
        // oh lord.
        state.unshift(quantifier())
        return
      }

      if(token.data === ')') return state.shift()

      if(token.data === ';') {
        return stmt.stage + 3
      }

      if(token.type !== 'ident' && token.type !== 'builtin') {
        return unexpected('expected identifier, got '+token.data)
      }

      stmt.collected_name = tokens.shift()
      return Advance      
    }

    function maybe_lparen() {
      if(token.data === '(') {
        tokens.unshift(stmt.collected_name)
        delete stmt.collected_name
        state.unshift(fn())
        return stmt.stage + 2 
      }
      return Advance
    }

    function is_decllist() {
      tokens.unshift(stmt.collected_name)
      delete stmt.collected_name
      state.unshift(decllist())
      return Advance
    }

    function done() {
      return state.shift()
    }
  }
  
  function parse_decllist() {
    // grab ident

    if(token.type === 'ident') {
      var name = token.data
      state.unshift(ident())
      state.scope.define(name)
      return
    }

    if(token.type === 'operator') {

      if(token.data === ',') {
        // multi-decl!
        if(!(state[1].flags & DECL_ALLOW_COMMA)) {
          return state.shift()
        }

        return tokens.shift()
      } else if(token.data === '=') {
        if(!(state[1].flags & DECL_ALLOW_ASSIGN)) return unexpected('`=` is not allowed here.')

        tokens.shift()

        state.unshift(expr(',', ';'))
        return
      } else if(token.data === '[') {
        state.unshift(quantifier())
        return
      }
    }
    return state.shift()
  }

  function parse_keyword_or_ident() {
    if(token.type === 'keyword') {
      state[0].type = 'keyword'
      state[0].mode = KEYWORD
      return
    }

    if(token.type === 'ident') {
      state[0].type = 'ident'
      state[0].mode = IDENT
      return
    }

    return unexpected('expected keyword or user-defined name, got '+token.data)
  }

  function parse_keyword() {
    if(token.type !== 'keyword') {
      return unexpected('expected keyword, got '+token.data)
    }

    return state.shift(), tokens.shift()
  }

  function parse_ident() {
    if(token.type !== 'ident') {
      return unexpected('expected user-defined name, got '+token.data)
    }

    state[0].data = token.data
    return state.shift(), tokens.shift()
  }


  function parse_expr() {
    var expecting = state[0].expecting

    state[0].tokens = state[0].tokens || []

    if(state[0].parenlevel === undefined) {
      state[0].parenlevel = 0
      state[0].bracelevel = 0
    }
    if(state[0].parenlevel < 1 && expecting.indexOf(token.data) > -1) {
      return parseexpr(state[0].tokens)
    }
    if(token.data === '(') {
      ++state[0].parenlevel
    } else if(token.data === ')') {
      --state[0].parenlevel
    }

    switch(token.data) {
      case '{': ++state[0].bracelevel; break
      case '}': --state[0].bracelevel; break
      case '(': ++state[0].parenlevel; break
      case ')': --state[0].parenlevel; break
    }

    if(state[0].parenlevel < 0) return unexpected('unexpected `)`')
    if(state[0].bracelevel < 0) return unexpected('unexpected `}`')

    state[0].tokens.push(tokens.shift())
    return

    function parseexpr(tokens) {
      return full_parse_expr(state, tokens), state.shift()
    }
  }

  // node types ---------------

  function n(type) {
    // this is a function factory that suffices for most kinds of expressions and statements
    return function() {
      return mknode(type, token)
    }
  }

  function adhoc() {
    return mknode(token_map[token.type], token, node)
  }

  function decl(flags) {
    var _ = mknode(DECL, token, node)
    _.flags = flags

    return _
  }

  function struct(allow_assign, allow_comma) {
    var _ = mknode(STRUCT, token, node)
    _.allow_assign = allow_assign === undefined ? true : allow_assign
    _.allow_comma = allow_comma === undefined ? true : allow_comma
    return _
  }

  function expr() {
    var n = mknode(EXPR, token, node)

    n.expecting = [].slice.call(arguments)
    return n
  }
  
  function keyword(default_value) {
    var t = token
    if(default_value) {
      t = {'type': '(implied)', data: '(default)', position: t.position} 
    }
    return mknode(KEYWORD, t, node)
  }

  // utils ----------------------------

  function unexpected(str) {
    errored = true
    stream.emit('error', new Error(
      (str || 'unexpected '+state) +
      ' at line '+state[0].token.line
    ))
  }

  function assert(type, data) {
    return 1,
      assert_null_string_or_array(type, token.type) && 
      assert_null_string_or_array(data, token.data)
  }

  function assert_null_string_or_array(x, y) {
    switch(typeof x) {
      case 'string': if(y !== x) {
        unexpected('expected `'+x+'`, got '+y+'\n'+token.data);
      } return !errored

      case 'object': if(x && x.indexOf(y) === -1) {
        unexpected('expected one of `'+x.join('`, `')+'`, got '+y);
      } return !errored
    }
    return true
  }

  // stative ----------------------------

  function stative() {
    var steps = [].slice.call(arguments)
      , step
      , result

    return function() {
      var current = state[0]

      current.stage || (current.stage = 0)

      step = steps[current.stage]
      if(!step) return unexpected('parser in undefined state!')

      result = step()

      if(result === Advance) return ++current.stage
      if(result === undefined) return
      current.stage = result
    } 
  }

  function advance(op, t) {
    t = t || 'operator'
    return function() {
      if(!assert(t, op)) return

      var last = tokens.shift()
        , children = state[0].children
        , last_node = children[children.length - 1]

      if(last_node && last_node.token && last.preceding) {
        last_node.token.succeeding = last_node.token.succeeding || []
        last_node.token.succeeding = last_node.token.succeeding.concat(last.preceding)
      }
      return Advance
    }
  }

  function advance_expr(until) {
    return function() { return state.unshift(expr(until)), Advance }
  }

  function advance_ident(declare) {
    return declare ? function() {
      var name = token.data
      return assert('ident') && (state.unshift(ident()), state.scope.define(name), Advance)
    } :  function() {
      if(!assert('ident')) return

      var s = Object.create(state.scope.find(token.data))
      s.token = token

      return (tokens.shift(), Advance)
    }
  }

  function advance_stmtlist() {
    return function() {
      var n = stmtlist()
      n.expecting = '}'
      return state.unshift(n), Advance
    }
  }

  function maybe_stmtlist(skip) {
    return function() {
      var current = state[0].stage
      if(token.data !== '{') { return state.unshift(stmt()), current + skip }
      return tokens.shift(), Advance
    }
  }

  function popstmt() {
    return function() { return state.shift(), state.shift() }
  }


  function setup_stative_parsers() {

    // could also be
    // struct { } decllist
    parse_struct =
        stative(
          advance('struct', 'keyword')
        , function() {
            if(token.data === '{') {
              state.fake(mknode(IDENT, {data:'', position: token.position, type:'ident'}))
              return Advance
            }

            return advance_ident(true)()
          }
        , function() { state.scope.enter(); return Advance }
        , advance('{')
        , function() {
            if(token.type === 'preprocessor') {
              state.fake(adhoc())
              tokens.shift()
              return
            }
            if(token.data === '}') {
              state.scope.exit()
              tokens.shift()
              return state.shift()
            }
            if(token.data === ';') { tokens.shift(); return }
            state.unshift(decl(DECL_STRUCT))
          }
        )

    parse_precision =
        stative(
          function() { return tokens.shift(), Advance }
        , function() { 
            return assert(
            'keyword', ['lowp', 'mediump', 'highp']
            ) && (state.unshift(keyword()), Advance) 
          }
        , function() { return (state.unshift(keyword()), Advance) }
        , function() { return state.shift() } 
        )

    parse_quantifier =
        stative(
          advance('[')
        , advance_expr(']')
        , advance(']')
        , function() { return state.shift() }
        )

    parse_forloop = 
        stative(
          advance('for', 'keyword')
        , advance('(')
        , function() {
            var lookup
            if(token.type === 'ident') {
              if(!(lookup = state.scope.find(token.data))) {
                lookup = state.create_node()
              }
             
              if(lookup.parent.type === 'struct') {
                return state.unshift(decl(DECL_STATEMENT)), Advance
              }
            } else if(token.type === 'builtin' || token.type === 'keyword') {
              return state.unshift(decl(DECL_STATEMENT)), Advance
            }
            return advance_expr(';')()
          }
        , advance(';')
        , advance_expr(';')
        , advance(';')
        , advance_expr(')')
        , advance(')')
        , maybe_stmtlist(3)
        , advance_stmtlist()
        , advance('}')
        , popstmt()
        )

    parse_if = 
        stative(
          advance('if', 'keyword')
        , advance('(')
        , advance_expr(')')
        , advance(')')
        , maybe_stmtlist(3)
        , advance_stmtlist()
        , advance('}')
        , function() {
            if(token.data === 'else') {
              return tokens.shift(), state.unshift(stmt()), Advance
            }
            return popstmt()()
          }
        , popstmt()
        )

    parse_return =
        stative(
          advance('return', 'keyword')
        , function() {
            if(token.data === ';') return Advance
            return state.unshift(expr(';')), Advance
          }
        , function() { tokens.shift(), popstmt()() } 
        )

    parse_whileloop =
        stative(
          advance('while', 'keyword')
        , advance('(')
        , advance_expr(')')
        , advance(')')
        , maybe_stmtlist(3)
        , advance_stmtlist()
        , advance('}')
        , popstmt()
        )

    parse_dowhileloop = 
      stative(
        advance('do', 'keyword')
      , maybe_stmtlist(3)
      , advance_stmtlist()
      , advance('}')
      , advance('while', 'keyword')
      , advance('(')
      , advance_expr(')')
      , advance(')')
      , popstmt()
      )

    parse_function =
      stative(
        function() {
          for(var i = 1, len = state.length; i < len; ++i) if(state[i].mode === FUNCTION) {
            return unexpected('function definition is not allowed within another function')
          }

          return Advance
        }
      , function() {
          if(!assert("ident")) return

          var name = token.data
            , lookup = state.scope.find(name)

          state.unshift(ident())
          state.scope.define(name)

          state.scope.enter(lookup ? lookup.scope : null)
          return Advance
        }
      , advance('(')
      , function() { return state.unshift(fnargs()), Advance }
      , advance(')')
      , function() { 
          // forward decl
          if(token.data === ';') {
            return state.scope.exit(), state.shift(), state.shift()
          }
          return Advance
        }
      , advance('{')
      , advance_stmtlist()
      , advance('}')
      , function() { state.scope.exit(); return Advance } 
      , function() { return state.shift(), state.shift(), state.shift() }
      )

    parse_function_args =
      stative(
        function() {
          if(token.data === 'void') { state.fake(keyword()); tokens.shift(); return Advance }
          if(token.data === ')') { state.shift(); return }
          if(token.data === 'struct') {
            state.unshift(struct(NO_ASSIGN_ALLOWED, NO_COMMA_ALLOWED))
            return Advance
          }
          state.unshift(decl(DECL_FUNCTION))
          return Advance
        }
      , function() {
          if(token.data === ',') { tokens.shift(); return 0 }
          if(token.data === ')') { state.shift(); return }
          unexpected('expected one of `,` or `)`, got '+token.data)
        }
      )
  }
}

function mknode(mode, sourcetoken) {
  return {
      mode: mode
    , token: sourcetoken
    , children: []
    , type: stmt_type[mode]
    , id: (Math.random() * 0xFFFFFFFF).toString(16)
  }
}

function is_storage(token) {
  return token.data === 'const' ||
         token.data === 'attribute' ||
         token.data === 'uniform' ||
         token.data === 'varying'
}

function is_parameter(token) {
  return token.data === 'in' ||
         token.data === 'inout' ||
         token.data === 'out'
}

function is_precision(token) {
  return token.data === 'highp' ||
         token.data === 'mediump' ||
         token.data === 'lowp'
}

},{"./expr":34,"./scope":36,"through":37}],36:[function(require,module,exports){
module.exports = scope

function scope(state) {
  if(this.constructor !== scope)
    return new scope(state)

  this.state = state
  this.scopes = []
  this.current = null
}

var cons = scope
  , proto = cons.prototype

proto.enter = function(s) {
  this.scopes.push(
    this.current = this.state[0].scope = s || {}
  )
}

proto.exit = function() {
  this.scopes.pop()
  this.current = this.scopes[this.scopes.length - 1]
}

proto.define = function(str) {
  this.current[str] = this.state[0]
}

proto.find = function(name, fail) {
  for(var i = this.scopes.length - 1; i > -1; --i) {
    if(this.scopes[i].hasOwnProperty(name)) {
      return this.scopes[i][name]
    }
  }

  return null
}

},{}],37:[function(require,module,exports){
(function (process){
var Stream = require('stream')

// through
//
// a stream that does nothing but re-emit the input.
// useful for aggregating a series of changing but not ending streams into one stream)



exports = module.exports = through
through.through = through

//create a readable writable stream.

function through (write, end) {
  write = write || function (data) { this.emit('data', data) }
  end = end || function () { this.emit('end') }

  var ended = false, destroyed = false
  var stream = new Stream(), buffer = []
  stream.buffer = buffer
  stream.readable = stream.writable = true
  stream.paused = false
  stream.write = function (data) {
    write.call(this, data)
    return !stream.paused
  }

  function drain() {
    while(buffer.length && !stream.paused) {
      var data = buffer.shift()
      if(null === data)
        return stream.emit('end')
      else
        stream.emit('data', data)
    }
  }

  stream.queue = function (data) {
    buffer.push(data)
    drain()
  }

  //this will be registered as the first 'end' listener
  //must call destroy next tick, to make sure we're after any
  //stream piped from here.
  //this is only a problem if end is not emitted synchronously.
  //a nicer way to do this is to make sure this is the last listener for 'end'

  stream.on('end', function () {
    stream.readable = false
    if(!stream.writable)
      process.nextTick(function () {
        stream.destroy()
      })
  })

  function _end () {
    stream.writable = false
    end.call(stream)
    if(!stream.readable)
      stream.destroy()
  }

  stream.end = function (data) {
    if(ended) return
    ended = true
    if(arguments.length) stream.write(data)
    _end() // will emit or queue
  }

  stream.destroy = function () {
    if(destroyed) return
    destroyed = true
    ended = true
    buffer.length = 0
    stream.writable = stream.readable = false
    stream.emit('close')
  }

  stream.pause = function () {
    if(stream.paused) return
    stream.paused = true
    stream.emit('pause')
  }
  stream.resume = function () {
    if(stream.paused) {
      stream.paused = false
    }
    drain()
    //may have become paused again,
    //as drain emits 'data'.
    if(!stream.paused)
      stream.emit('drain')
  }
  return stream
}


}).call(this,require('_process'))
},{"_process":8,"stream":9}],38:[function(require,module,exports){
module.exports = tokenize

var through = require('through')

var literals = require('./lib/literals')
  , operators = require('./lib/operators')
  , builtins = require('./lib/builtins')

var NORMAL = 999          // <-- never emitted
  , TOKEN = 9999          // <-- never emitted 
  , BLOCK_COMMENT = 0 
  , LINE_COMMENT = 1
  , PREPROCESSOR = 2
  , OPERATOR = 3
  , INTEGER = 4
  , FLOAT = 5
  , IDENT = 6
  , BUILTIN = 7
  , KEYWORD = 8
  , WHITESPACE = 9
  , EOF = 10 
  , HEX = 11

var map = [
    'block-comment'
  , 'line-comment'
  , 'preprocessor'
  , 'operator'
  , 'integer'
  , 'float'
  , 'ident'
  , 'builtin'
  , 'keyword'
  , 'whitespace'
  , 'eof'
  , 'integer'
]

function tokenize() {
  var stream = through(write, end)

  var i = 0
    , total = 0
    , mode = NORMAL 
    , c
    , last
    , content = []
    , token_idx = 0
    , token_offs = 0
    , line = 1
    , start = 0
    , isnum = false
    , isoperator = false
    , input = ''
    , len

  return stream

  function token(data) {
    if(data.length) {
      stream.queue({
        type: map[mode]
      , data: data
      , position: start
      , line: line
      })
    }
  }

  function write(chunk) {
    i = 0
    input += chunk.toString()
    len = input.length

    while(c = input[i], i < len) switch(mode) {
      case BLOCK_COMMENT: i = block_comment(); break
      case LINE_COMMENT: i = line_comment(); break
      case PREPROCESSOR: i = preprocessor(); break 
      case OPERATOR: i = operator(); break
      case INTEGER: i = integer(); break
      case HEX: i = hex(); break
      case FLOAT: i = decimal(); break
      case TOKEN: i = readtoken(); break
      case WHITESPACE: i = whitespace(); break
      case NORMAL: i = normal(); break
    }

    total += i
    input = input.slice(i)
  } 

  function end(chunk) {
    if(content.length) {
      token(content.join(''))
    }

    mode = EOF
    token('(eof)')

    stream.queue(null)
  }

  function normal() {
    content = content.length ? [] : content

    if(last === '/' && c === '*') {
      start = total + i - 1
      mode = BLOCK_COMMENT
      last = c
      return i + 1
    }

    if(last === '/' && c === '/') {
      start = total + i - 1
      mode = LINE_COMMENT
      last = c
      return i + 1
    }

    if(c === '#') {
      mode = PREPROCESSOR
      start = total + i
      return i
    }

    if(/\s/.test(c)) {
      mode = WHITESPACE
      start = total + i
      return i
    }

    isnum = /\d/.test(c)
    isoperator = /[^\w_]/.test(c)

    start = total + i
    mode = isnum ? INTEGER : isoperator ? OPERATOR : TOKEN
    return i
  }

  function whitespace() {
    if(c === '\n') ++line

    if(/[^\s]/g.test(c)) {
      token(content.join(''))
      mode = NORMAL
      return i
    }
    content.push(c)
    last = c
    return i + 1
  }

  function preprocessor() {
    if(c === '\n') ++line

    if(c === '\n' && last !== '\\') {
      token(content.join(''))
      mode = NORMAL
      return i
    }
    content.push(c)
    last = c
    return i + 1
  }

  function line_comment() {
    return preprocessor()
  }

  function block_comment() {
    if(c === '/' && last === '*') {
      content.push(c)
      token(content.join(''))
      mode = NORMAL
      return i + 1
    }

    if(c === '\n') ++line

    content.push(c)
    last = c
    return i + 1
  }

  function operator() {
    if(last === '.' && /\d/.test(c)) {
      mode = FLOAT
      return i
    }

    if(last === '/' && c === '*') {
      mode = BLOCK_COMMENT
      return i
    }

    if(last === '/' && c === '/') {
      mode = LINE_COMMENT
      return i
    }

    if(c === '.' && content.length) {
      while(determine_operator(content));
      
      mode = FLOAT
      return i
    }

    if(c === ';' || c === ')' || c === '(') {
      if(content.length) while(determine_operator(content));
      token(c)
      mode = NORMAL
      return i + 1
    }

    var is_composite_operator = content.length === 2 && c !== '='
    if(/[\w_\d\s]/.test(c) || is_composite_operator) {
      while(determine_operator(content));
      mode = NORMAL
      return i
    }

    content.push(c)
    last = c
    return i + 1
  }

  function determine_operator(buf) {
    var j = 0
      , idx

    do {
      idx = operators.indexOf(buf.slice(0, buf.length + j).join(''))
      if(idx === -1) { 
        j -= 1
        continue
      }
      
      token(operators[idx])

      start += operators[idx].length
      content = content.slice(operators[idx].length)
      return content.length
    } while(1)
  }

  function hex() {
    if(/[^a-fA-F0-9]/.test(c)) {
      token(content.join(''))
      mode = NORMAL
      return i
    }

    content.push(c)
    last = c
    return i + 1    
  }

  function integer() {
    if(c === '.') {
      content.push(c)
      mode = FLOAT
      last = c
      return i + 1
    }

    if(/[eE]/.test(c)) {
      content.push(c)
      mode = FLOAT
      last = c
      return i + 1
    }

    if(c === 'x' && content.length === 1 && content[0] === '0') {
      mode = HEX
      content.push(c)
      last = c
      return i + 1
    }

    if(/[^\d]/.test(c)) {
      token(content.join(''))
      mode = NORMAL
      return i
    }

    content.push(c)
    last = c
    return i + 1
  }

  function decimal() {
    if(c === 'f') {
      content.push(c)
      last = c
      i += 1
    }

    if(/[eE]/.test(c)) {
      content.push(c)
      last = c
      return i + 1
    }

    if(/[^\d]/.test(c)) {
      token(content.join(''))
      mode = NORMAL
      return i
    }
    content.push(c)
    last = c
    return i + 1
  }

  function readtoken() {
    if(/[^\d\w_]/.test(c)) {
      var contentstr = content.join('')
      if(literals.indexOf(contentstr) > -1) {
        mode = KEYWORD
      } else if(builtins.indexOf(contentstr) > -1) {
        mode = BUILTIN
      } else {
        mode = IDENT
      }
      token(content.join(''))
      mode = NORMAL
      return i
    }
    content.push(c)
    last = c
    return i + 1
  }
}

},{"./lib/builtins":39,"./lib/literals":40,"./lib/operators":41,"through":42}],39:[function(require,module,exports){
module.exports = [
    'gl_Position'
  , 'gl_PointSize'
  , 'gl_ClipVertex'
  , 'gl_FragCoord'
  , 'gl_FrontFacing'
  , 'gl_FragColor'
  , 'gl_FragData'
  , 'gl_FragDepth'
  , 'gl_Color'
  , 'gl_SecondaryColor'
  , 'gl_Normal'
  , 'gl_Vertex'
  , 'gl_MultiTexCoord0'
  , 'gl_MultiTexCoord1'
  , 'gl_MultiTexCoord2'
  , 'gl_MultiTexCoord3'
  , 'gl_MultiTexCoord4'
  , 'gl_MultiTexCoord5'
  , 'gl_MultiTexCoord6'
  , 'gl_MultiTexCoord7'
  , 'gl_FogCoord'
  , 'gl_MaxLights'
  , 'gl_MaxClipPlanes'
  , 'gl_MaxTextureUnits'
  , 'gl_MaxTextureCoords'
  , 'gl_MaxVertexAttribs'
  , 'gl_MaxVertexUniformComponents'
  , 'gl_MaxVaryingFloats'
  , 'gl_MaxVertexTextureImageUnits'
  , 'gl_MaxCombinedTextureImageUnits'
  , 'gl_MaxTextureImageUnits'
  , 'gl_MaxFragmentUniformComponents'
  , 'gl_MaxDrawBuffers'
  , 'gl_ModelViewMatrix'
  , 'gl_ProjectionMatrix'
  , 'gl_ModelViewProjectionMatrix'
  , 'gl_TextureMatrix'
  , 'gl_NormalMatrix'
  , 'gl_ModelViewMatrixInverse'
  , 'gl_ProjectionMatrixInverse'
  , 'gl_ModelViewProjectionMatrixInverse'
  , 'gl_TextureMatrixInverse'
  , 'gl_ModelViewMatrixTranspose'
  , 'gl_ProjectionMatrixTranspose'
  , 'gl_ModelViewProjectionMatrixTranspose'
  , 'gl_TextureMatrixTranspose'
  , 'gl_ModelViewMatrixInverseTranspose'
  , 'gl_ProjectionMatrixInverseTranspose'
  , 'gl_ModelViewProjectionMatrixInverseTranspose'
  , 'gl_TextureMatrixInverseTranspose'
  , 'gl_NormalScale'
  , 'gl_DepthRangeParameters'
  , 'gl_DepthRange'
  , 'gl_ClipPlane'
  , 'gl_PointParameters'
  , 'gl_Point'
  , 'gl_MaterialParameters'
  , 'gl_FrontMaterial'
  , 'gl_BackMaterial'
  , 'gl_LightSourceParameters'
  , 'gl_LightSource'
  , 'gl_LightModelParameters'
  , 'gl_LightModel'
  , 'gl_LightModelProducts'
  , 'gl_FrontLightModelProduct'
  , 'gl_BackLightModelProduct'
  , 'gl_LightProducts'
  , 'gl_FrontLightProduct'
  , 'gl_BackLightProduct'
  , 'gl_FogParameters'
  , 'gl_Fog'
  , 'gl_TextureEnvColor'
  , 'gl_EyePlaneS'
  , 'gl_EyePlaneT'
  , 'gl_EyePlaneR'
  , 'gl_EyePlaneQ'
  , 'gl_ObjectPlaneS'
  , 'gl_ObjectPlaneT'
  , 'gl_ObjectPlaneR'
  , 'gl_ObjectPlaneQ'
  , 'gl_FrontColor'
  , 'gl_BackColor'
  , 'gl_FrontSecondaryColor'
  , 'gl_BackSecondaryColor'
  , 'gl_TexCoord'
  , 'gl_FogFragCoord'
  , 'gl_Color'
  , 'gl_SecondaryColor'
  , 'gl_TexCoord'
  , 'gl_FogFragCoord'
  , 'gl_PointCoord'
  , 'radians'
  , 'degrees'
  , 'sin'
  , 'cos'
  , 'tan'
  , 'asin'
  , 'acos'
  , 'atan'
  , 'pow'
  , 'exp'
  , 'log'
  , 'exp2'
  , 'log2'
  , 'sqrt'
  , 'inversesqrt'
  , 'abs'
  , 'sign'
  , 'floor'
  , 'ceil'
  , 'fract'
  , 'mod'
  , 'min'
  , 'max'
  , 'clamp'
  , 'mix'
  , 'step'
  , 'smoothstep'
  , 'length'
  , 'distance'
  , 'dot'
  , 'cross'
  , 'normalize'
  , 'faceforward'
  , 'reflect'
  , 'refract'
  , 'matrixCompMult'
  , 'lessThan'
  , 'lessThanEqual'
  , 'greaterThan'
  , 'greaterThanEqual'
  , 'equal'
  , 'notEqual'
  , 'any'
  , 'all'
  , 'not'
  , 'texture2D'
  , 'texture2DProj'
  , 'texture2DLod'
  , 'texture2DProjLod'
  , 'textureCube'
  , 'textureCubeLod'
]

},{}],40:[function(require,module,exports){
module.exports = [
  // current
    'precision'
  , 'highp'
  , 'mediump'
  , 'lowp'
  , 'attribute'
  , 'const'
  , 'uniform'
  , 'varying'
  , 'break'
  , 'continue'
  , 'do'
  , 'for'
  , 'while'
  , 'if'
  , 'else'
  , 'in'
  , 'out'
  , 'inout'
  , 'float'
  , 'int'
  , 'void'
  , 'bool'
  , 'true'
  , 'false'
  , 'discard'
  , 'return'
  , 'mat2'
  , 'mat3'
  , 'mat4'
  , 'vec2'
  , 'vec3'
  , 'vec4'
  , 'ivec2'
  , 'ivec3'
  , 'ivec4'
  , 'bvec2'
  , 'bvec3'
  , 'bvec4'
  , 'sampler1D'
  , 'sampler2D'
  , 'sampler3D'
  , 'samplerCube'
  , 'sampler1DShadow'
  , 'sampler2DShadow'
  , 'struct'

  // future
  , 'asm'
  , 'class'
  , 'union'
  , 'enum'
  , 'typedef'
  , 'template'
  , 'this'
  , 'packed'
  , 'goto'
  , 'switch'
  , 'default'
  , 'inline'
  , 'noinline'
  , 'volatile'
  , 'public'
  , 'static'
  , 'extern'
  , 'external'
  , 'interface'
  , 'long'
  , 'short'
  , 'double'
  , 'half'
  , 'fixed'
  , 'unsigned'
  , 'input'
  , 'output'
  , 'hvec2'
  , 'hvec3'
  , 'hvec4'
  , 'dvec2'
  , 'dvec3'
  , 'dvec4'
  , 'fvec2'
  , 'fvec3'
  , 'fvec4'
  , 'sampler2DRect'
  , 'sampler3DRect'
  , 'sampler2DRectShadow'
  , 'sizeof'
  , 'cast'
  , 'namespace'
  , 'using'
]

},{}],41:[function(require,module,exports){
module.exports = [
    '<<='
  , '>>='
  , '++'
  , '--'
  , '<<'
  , '>>'
  , '<='
  , '>='
  , '=='
  , '!='
  , '&&'
  , '||'
  , '+='
  , '-='
  , '*='
  , '/='
  , '%='
  , '&='
  , '^='
  , '|='
  , '('
  , ')'
  , '['
  , ']'
  , '.'
  , '!'
  , '~'
  , '*'
  , '/'
  , '%'
  , '+'
  , '-'
  , '<'
  , '>'
  , '&'
  , '^'
  , '|'
  , '?'
  , ':'
  , '='
  , ','
  , ';'
  , '{'
  , '}'
]

},{}],42:[function(require,module,exports){
(function (process){
var Stream = require('stream')

// through
//
// a stream that does nothing but re-emit the input.
// useful for aggregating a series of changing but not ending streams into one stream)

exports = module.exports = through
through.through = through

//create a readable writable stream.

function through (write, end, opts) {
  write = write || function (data) { this.queue(data) }
  end = end || function () { this.queue(null) }

  var ended = false, destroyed = false, buffer = [], _ended = false
  var stream = new Stream()
  stream.readable = stream.writable = true
  stream.paused = false

//  stream.autoPause   = !(opts && opts.autoPause   === false)
  stream.autoDestroy = !(opts && opts.autoDestroy === false)

  stream.write = function (data) {
    write.call(this, data)
    return !stream.paused
  }

  function drain() {
    while(buffer.length && !stream.paused) {
      var data = buffer.shift()
      if(null === data)
        return stream.emit('end')
      else
        stream.emit('data', data)
    }
  }

  stream.queue = stream.push = function (data) {
//    console.error(ended)
    if(_ended) return stream
    if(data == null) _ended = true
    buffer.push(data)
    drain()
    return stream
  }

  //this will be registered as the first 'end' listener
  //must call destroy next tick, to make sure we're after any
  //stream piped from here.
  //this is only a problem if end is not emitted synchronously.
  //a nicer way to do this is to make sure this is the last listener for 'end'

  stream.on('end', function () {
    stream.readable = false
    if(!stream.writable && stream.autoDestroy)
      process.nextTick(function () {
        stream.destroy()
      })
  })

  function _end () {
    stream.writable = false
    end.call(stream)
    if(!stream.readable && stream.autoDestroy)
      stream.destroy()
  }

  stream.end = function (data) {
    if(ended) return
    ended = true
    if(arguments.length) stream.write(data)
    _end() // will emit or queue
    return stream
  }

  stream.destroy = function () {
    if(destroyed) return
    destroyed = true
    ended = true
    buffer.length = 0
    stream.writable = stream.readable = false
    stream.emit('close')
    return stream
  }

  stream.pause = function () {
    if(stream.paused) return
    stream.paused = true
    return stream
  }

  stream.resume = function () {
    if(stream.paused) {
      stream.paused = false
      stream.emit('resume')
    }
    drain()
    //may have become paused again,
    //as drain emits 'data'.
    if(!stream.paused)
      stream.emit('drain')
    return stream
  }
  return stream
}


}).call(this,require('_process'))
},{"_process":8,"stream":9}],43:[function(require,module,exports){
var createShader = require("gl-shader-core");
var glslExports = require("glsl-exports");

var VERTEX_SHADER = 'attribute vec2 position; void main() { gl_Position = vec4(2.0*position-1.0, 0.0, 1.0);}';
var VERTEX_TYPES = glslExports(VERTEX_SHADER);
var PROGRESS_UNIFORM = "progress";
var RESOLUTION_UNIFORM = "resolution";

var CONTEXTS = ["webgl", "experimental-webgl"];
function getWebGLContext (canvas, options) {
  if (!canvas.getContext) return;
  for (var i = 0; i < CONTEXTS.length; ++i) {
    try {
      var ctx = canvas.getContext(CONTEXTS[i], options||{});
      if (ctx) return ctx;
    } catch(e) {
    }
  }
}

function extend (obj) {
  for(var a=1; a<arguments.length; ++a) {
    var source = arguments[a];
    for (var prop in source)
      if (source[prop] !== void 0) obj[prop] = source[prop];
  }
  return obj;
}

/**
 * API:
 * GlslTransitionCore(canvas)(glslSource, options) => Object with functions.
 */

/**
 * ~~~ First Call in the API
 * GlslTransitionCore(canvas)
 * Creates a Transitions context with a canvas.
 */
function GlslTransitionCore (canvas, opts) {
  if (arguments.length !== 1 || !("getContext" in canvas))
    throw new Error("Bad arguments. usage: GlslTransitionCore(canvas)");

  var contextAttributes = extend({}, opts && opts.contextAttributes || {}, GlslTransitionCore.defaults.contextAttributes);

  // First level variables
  var gl, currentShader, transitions;
  var userContextLostWatchers = [];

  function init () {
    transitions = [];
    gl = getWebGLContext(canvas, contextAttributes);
    canvas.addEventListener("webglcontextlost", onContextLost, false);
    canvas.addEventListener("webglcontextrestored", onContextRestored, false);
  }

  function onContextLost (e) {
    e.preventDefault();
    gl = null;
    for (var i=0; i<transitions.length; ++i) {
      transitions[i].onContextLost(e);
    }
  }

  function onContextRestored (e) {
    gl = getWebGLContext(canvas, contextAttributes);
    var i;
    for (i=0; i<userContextLostWatchers.length; ++i) {
      userContextLostWatchers[i](e);
    }
    for (i=0; i<transitions.length; ++i) {
      transitions[i].onContextRestored(e);
    }
  }

  function createTexture () {
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  function syncTexture (texture, image) {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (image) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      if (typeof image === "function") {
        // This allows everything. It is a workaround to define non Image/Canvas/Video textures like using Array.
        // We may use gl-texture2d in the future but it brings more deps to the project
        image(gl);
      }
      else {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      }
    }
    else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
  }

  function loadTransitionShader (glsl, glslTypes) {
    var uniformsByName = extend({}, glslTypes.uniforms, VERTEX_TYPES.uniforms);
    var attributesByName = extend({}, glslTypes.attributes, VERTEX_TYPES.attributes);
    var name;
    var uniforms = [];
    var attributes = [];
    for (name in uniformsByName) {
      uniforms.push({ name: name, type: uniformsByName[name] });
    }
    for (name in attributesByName) {
      attributes.push({ name: name, type: attributesByName[name] });
    }
    var shader = createShader(gl, VERTEX_SHADER, glsl, uniforms, attributes);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    shader.attributes.position.pointer();
    return shader;
  }

  function draw () {
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /**
   * ~~~ Second Call in the API
   * createTransition(glslSource, [uniforms])
   * Creates a GLSL Transition for the current canvas context.
   */
  function createTransition (glsl) {
    var glslTypes = glslExports(glsl);

    // Second level variables
    var shader, textureUnits, textures;

    function load () {
      if (!gl) return;
      shader = loadTransitionShader(glsl, glslTypes);
      textureUnits = {};
      textures = {};
      var i = 0;
      for (var name in glslTypes.uniforms) {
        var t = glslTypes.uniforms[name];
        if (t === "sampler2D") {
          gl.activeTexture(gl.TEXTURE0 + i);
          textureUnits[name] = i;
          textures[name] = createTexture();
          i ++;
        }
      }
    }

    function onContextLost () {
      shader = null;
    }

    function onContextRestored () {
      load();
    }

    function syncViewport () {
      var w = canvas.width, h = canvas.height;
      gl.viewport(0, 0, w, h);
      if (currentShader) {
        currentShader.uniforms[RESOLUTION_UNIFORM] = new Float32Array([ w, h ]);
      }
      var x1 = 0, x2 = w, y1 = 0, y2 = h;
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        x1, y1,
        x2, y1,
        x1, y2,
        x1, y2,
        x2, y1,
        x2, y2
      ]), gl.STATIC_DRAW);
    }

    function setProgress (p) {
      shader.uniforms[PROGRESS_UNIFORM] = p;
    }

    function setUniform (name, value) {
      if (name in textureUnits) {
        var i = textureUnits[name];
        var texture = textures[name];
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        syncTexture(texture, value);
        shader.uniforms[name] = i;
      }
      else {
        shader.uniforms[name] = value;
      }
    }

    function reset () {
      var hasChanged = false;
      if (!shader) {
        load(); // Possibly shader was not loaded.
        hasChanged = true;
      }
      if (currentShader !== shader) {
        currentShader = shader;
        shader.bind();
        hasChanged = true;
      }
      syncViewport();
      return hasChanged;
    }

    function destroy () {
      if (currentShader === shader) {
        currentShader = null;
      }
      if (shader) {
        shader.dispose();
        shader = null;
      }
    }

    function getUniforms () {
      return extend({}, glslTypes.uniforms);
    }

    var transition = {
      getGL: function () {
        return gl;
      },
      load: function () {
        // Possibly shader was not loaded.
        if (!shader) load();
      },
      bind: function () {
        // If shader has changed, we need to bind it
        if (currentShader !== shader) {
          currentShader = shader;
          shader.bind();
        }
      },
      isCurrentTransition: function () {
        return currentShader === shader;
      },
      onContextLost: onContextLost,
      onContextRestored: onContextRestored,
      syncViewport: syncViewport,
      setProgress: setProgress,
      setUniform: setUniform,
      reset: reset,
      draw: draw,
      destroy: destroy,
      getUniforms: getUniforms
    };

    transitions.push(transition);

    return transition;
  }

  createTransition.onContextLost = function (f) {
    userContextLostWatchers.push(f);
  };

  createTransition.getGL = function () {
    return gl;
  };

  // Finally init the GlslTransitionCore context
  init();

  return createTransition;
}

GlslTransitionCore.defaults = {
  contextAttributes: { preserveDrawingBuffer: true }
};

GlslTransitionCore.isSupported = function () {
  var c = document.createElement("canvas");
  return !!getWebGLContext(c);
};

module.exports = GlslTransitionCore;

},{"gl-shader-core":31,"glsl-exports":32}],44:[function(require,module,exports){
var GlslTransitionCore = require("glsl-transition-core");
var Q = require("q");
var requestAnimationFrame = require("raf");
var now = require("performance-now");

// We may share and custom this if required
var PROGRESS_UNIFORM = "progress";
var RESOLUTION_UNIFORM = "resolution";

function extend (obj) {
  for(var a=1; a<arguments.length; ++a) {
    var source = arguments[a];
    for (var prop in source)
      if (source[prop] !== void 0) obj[prop] = source[prop];
  }
  return obj;
}

function identity (x) { return x; }

function TransitionAbortedError (message) {
  this.message = message;
  this.stack = (new Error()).stack;
}
TransitionAbortedError.prototype = new Error();
TransitionAbortedError.prototype.name = "TransitionAbortedError";

/**
 * API:
 * GlslTransition(canvas)(glslSource, options)(uniforms, duration, easing) // => Promise
 *
 * The 2 first levels of the API is a thin wrapper to GlslTransitionCore.
 */

/**
 * ~~~ First Call in the API
 * GlslTransition(canvas)
 * Creates a Transitions context with a canvas.
 */
function GlslTransition (canvas/*, opts*/) {

  var currentAnimationD;
  
  function onContextLost () {
    if (currentAnimationD) {
      currentAnimationD.reject(new TransitionAbortedError("WebGL Context Lost"));
      currentAnimationD = null;
    }
  }

  var createTransitionCore = GlslTransitionCore.apply(this, arguments);
  createTransitionCore.onContextLost(onContextLost);

  function createTransition (glsl, defaultUniforms) {
    var transitionCore = createTransitionCore.apply(this, arguments);
    var glslUniforms = transitionCore.getUniforms();
    
    if (typeof defaultUniforms !== "object") defaultUniforms = {};
    if (arguments.length < 1 || arguments.length > 2 || typeof glsl !== "string")
      throw new Error("Bad arguments. usage: T(glsl [, options])");

    for (var name in defaultUniforms) {
      if (name === RESOLUTION_UNIFORM) {
        throw new Error("The '"+name+"' uniform is reserved, you must not use it.");
      }
      if (!(name in glslUniforms)) {
        throw new Error("uniform '"+name+"': This uniform does not exist in your GLSL code.");
      }
    }

    if (!currentAnimationD) transitionCore.load();

    function animate (transitionDuration, transitionEasing, allUniforms) {
      var transitionStart = now();
      var frames = 0;
      var fromWillNeedRefresh = !(allUniforms.from instanceof window.HTMLImageElement);
      var toWillNeedRefresh = !(allUniforms.to instanceof window.HTMLImageElement);
      var d = Q.defer();
      currentAnimationD = d;
      (function render () {
        if (currentAnimationD !== d) return;
        ++ frames;
        var t = now();
        var p = (t-transitionStart)/transitionDuration;
        try {
          if (p<1) {
            requestAnimationFrame(render, canvas);
            if (fromWillNeedRefresh) transitionCore.setUniform("from", allUniforms.from);
            if (toWillNeedRefresh) transitionCore.setUniform("to", allUniforms.to);
            transitionCore.setProgress(transitionEasing(p));
            transitionCore.draw();
          }
          else {
            if (fromWillNeedRefresh) transitionCore.setUniform("from", allUniforms.from);
            if (toWillNeedRefresh) transitionCore.setUniform("to", allUniforms.to);
            transitionCore.setProgress(transitionEasing(1));
            transitionCore.draw();
            d.resolve({ startAt: transitionStart, endAt: t, elapsedTime: t-transitionStart, frames: frames }); // Resolve some meta-data of the successful transition.
            currentAnimationD = null;
          }
        }
        catch (e) {
          d.reject(e);
          currentAnimationD = null;
        }
      }());
      return d.promise;
    }

    /**
     * ~~~ Third Call in the API
     * transition(uniforms, duration, [easing])
     * Perform a transition animation with uniforms paremeters to give in the GLSL, for a given duration and a custom easing function (default is linear).
     */
    function transition (uniforms, duration, easing) {
      if (!easing) easing = identity;

      // Validate static errors: Bad arguments / missing uniforms
      if (arguments.length < 2 || arguments.length > 3 || typeof uniforms !== "object" || typeof duration !== "number" || duration <= 0 || typeof easing !== "function")
        throw new Error("Bad arguments. usage: t(uniforms, duration, easing) -- uniforms is an Object, duration an integer > 0, easing an optional function.");

      var allUniforms = extend({}, defaultUniforms, uniforms);
      allUniforms[PROGRESS_UNIFORM] = easing(0);
      var name;
      for (name in glslUniforms) {
        if (name === RESOLUTION_UNIFORM) continue;
        if (!(name in allUniforms)) {
          throw new Error("uniform '"+name+"': You must provide an initial value.");
        }
      }
      for (name in uniforms) {
        if (name === RESOLUTION_UNIFORM) {
          throw new Error("The '"+name+"' uniform is reserved, you must not use it.");
        }
        if (!(name in glslUniforms)) {
          throw new Error("uniform '"+name+"': This uniform does not exist in your GLSL code.");
        }
      }

      // Validate Runtime errors
      if (!createTransitionCore.getGL()) return Q.reject(new Error("WebGL context is null."));
      if (currentAnimationD) return Q.reject(new Error("another transition is already running."));
      try {
        transitionCore.load();
      }
      catch (e) {
        return Q.reject(e);
      }

      transitionCore.bind();

      // Set all uniforms
      for (name in allUniforms) {
        transitionCore.setUniform(name, allUniforms[name]);
      }
      transitionCore.syncViewport();

      // Perform the transition
      return animate(duration, easing, allUniforms);
    }

    transition.destroy = function () {
      if (transitionCore.isCurrentTransition() && currentAnimationD) {
        currentAnimationD.reject(new TransitionAbortedError("Transition destroyed."));
        currentAnimationD = null;
      }
      transitionCore.destroy();
    };

    transition.core = transitionCore;
    return transition;
  }

  createTransition.core = createTransitionCore;
  createTransition.abort = function () {
    if (currentAnimationD) {
      currentAnimationD.reject(new TransitionAbortedError("Transition aborted by user."));
      currentAnimationD = null;
    }
  };

  return createTransition;
}

GlslTransition.TransitionAbortedError = TransitionAbortedError;
GlslTransition.defaults = GlslTransitionCore.defaults;
GlslTransition.isSupported = GlslTransitionCore.isSupported;

// Also exposes the internal libraries to be usable in the dist version
GlslTransition.GlslTransitionCore = GlslTransitionCore;
GlslTransition.Q = Q;
GlslTransition.requestAnimationFrame = requestAnimationFrame;
GlslTransition.now = now;


module.exports = GlslTransition;

},{"glsl-transition-core":43,"performance-now":64,"q":65,"raf":67}],45:[function(require,module,exports){
var KenBurnsCore = require("kenburns-core");
var KenBurnsCanvas2D = require("kenburns-canvas2d");
var KenBurnsWebGL = require("kenburns-webgl");
var KenBurnsDOM = require("kenburns-dom");
var rectCrop = require("rect-crop");
var rectClamp = require("rect-clamp");

var Module = module.exports = {
  crop: rectCrop,
  clamp: rectClamp,
  mixin: KenBurnsCore.mixin,
  Canvas2D: KenBurnsCanvas2D,
  WebGL: KenBurnsWebGL,
  DOM: KenBurnsDOM,
  Canvas: function (canvas) {
    // Auto Detect what to use
    if (!!window.WebGLRenderingContext)
      return new KenBurnsWebGL(canvas);
    else
      return new KenBurnsCanvas2D(canvas);
  }
};

},{"kenburns-canvas2d":46,"kenburns-core":48,"kenburns-dom":50,"kenburns-webgl":61,"rect-clamp":62,"rect-crop":63}],46:[function(require,module,exports){
var KenBurnsCore = require("kenburns-core");
var drawImageNormalized = require("draw-image-normalized");

// Canvas 2D implementation

function KenBurnsCanvas2dTrait (canvas2d) {
  this.canvas = canvas2d;
  this.ctx = canvas2d.getContext("2d");
}
KenBurnsCanvas2dTrait.prototype = {
  draw: function (image, rect) {
    var viewport = [ 0, 0, this.canvas.width, this.canvas.height ];
    var ctx = this.ctx;
    ctx.fillStyle = "rgb("+this.rgb.map(function(x){ return x * 255; })+")";
    ctx.fillRect.apply(ctx, viewport);
    drawImageNormalized.apply(null, [ ctx, image ].concat(rect).concat(viewport));
  },
  getViewport: function () {
    return this.canvas;
  }
};

module.exports = KenBurnsCore.mixin(KenBurnsCanvas2dTrait);


},{"draw-image-normalized":47,"kenburns-core":48}],47:[function(require,module,exports){
module.exports = function drawImageNormalized (ctx, image, sx, sy, sw, sh, dx, dy, dw, dh) {

  if (arguments.length <= 6) {
    dx = sx;
    dy = sy;
    dw = sw;
    dh = sh;
    sx = 0;
    sy = 0;
    sw = image.width;
    sh = image.height;
  }
  if (arguments.length <= 4) {
    dw = sw;
    dh = sh;
  }

  if (sx < 0) {
    dx -= sx * dw / sw;
    dw += sx * dw / sw;
    sw += sx;
    sx = 0;
  }
  if (sy < 0) {
    dy -= sy * dh / sh;
    dh += sy * dh / sh;
    sh += sy;
    sy = 0;
  }
  if (sx + sw > image.width) {
    var x = sx + sw - image.width;
    dw *= (sw - x) / sw;
    sw = image.width;
  }
  if (sy + sh > image.height) {
    var y = sy + sh - image.height;
    dh *= (sh - y) / sh;
    sh = image.height;
  }

  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
  ctx.drawImage.apply(ctx, [image, sx, sy, sw, sh, dx, dy, dw, dh ]);
};

},{}],48:[function(require,module,exports){
var Q = require("q");
var requestAnimationFrame = require("raf");
var now = require("performance-now");
var rectClamp = require("rect-clamp");
var rectMix = require("rect-mix");

// KenBurns abstract implementation.
// abstract functions to implement:
// - a draw() function.
// - a getViewport() function. returns an object with {width,height}. (returning a canvas works)

function KenBurns () {
  this.animationDefer = null;
  this.setClamped(true);
  this.setRGB([0,0,0]); // in percentage convention
}

KenBurns.prototype = {
  // Can be overrided by implementations
  runStart: noop,
  runEnd: noop,
  destroy: noop,

  _getBound: function (cropBound, image) {
    var bnds = typeof cropBound === "function" ? cropBound(this.getViewport(), image) : cropBound;
    if (this.clamped) bnds = rectClamp(bnds, [ 0, 0, image.width, image.height ]);
    return bnds;
  },

  setClamped: function (c) {
    this.clamped = c;
    return this;
  },

  setRGB: function (rgb) {
    this.rgb = rgb;
    return this;
  },

  /**
   * Draw the image one time.
   */
  one: function (image, crop) {
    var boundCrop = this._getBound(crop, image);
    this.runStart(image, boundCrop, boundCrop, 0);
    this.draw(image, boundCrop);
    this.runEnd();
    return image;
  },

  _runValidation: function (image, startCrop, endCrop, duration, easing) {
    if (!image) invalidArgument(image, "image is required.");
    if (!duration || isNaN(duration)) invalidArgument(duration, "duration is required and must be a number.");
    if (!easing) easing = identity;
    if (typeof easing !== "function") invalidArgument(easing, "easing must be a function.");
    var fromCropBound = this._getBound(startCrop, image);
    var toCropBound = this._getBound(endCrop, image);

    var startEndCropReason = "startCrop and endCrop are required and must be a bound array or a function returning a bound array.";

    if (!(fromCropBound instanceof Array) || fromCropBound.length !== 4)
      invalidArgument(startCrop, startEndCropReason);
    if (!(toCropBound instanceof Array) || toCropBound.length !== 4)
      invalidArgument(endCrop, startEndCropReason);

    return [image,fromCropBound,toCropBound,duration,easing];
  },

  /**
   * The Ken Burns Effect will animate image from fromCropBound to toCropBound with a given duration and easing function.
   *
   * image MUST be loaded.
   */
  run: function () {
    var self = this;
    var args = self._runValidation.apply(self, arguments);
    var image = args[0];
    var fromCropBound = args[1];
    var toCropBound = args[2];
    var duration = args[3];
    var easing = args[4];

    var d = Q.defer();
    var start = now();
    self.runStart.apply(self, args);
    d.promise.then(self.runEnd.bind(self)).done();
    self.animationDefer = d;
    (function render () {
      if (self.animationDefer !== d) return;
      try {
        var p = Math.min((now() - start) / duration, 1);
        var bound = rectMix(fromCropBound, toCropBound, easing(p));
        if (self.clamped) bound = rectClamp(bound, [ 0, 0, image.width, image.height ]);
        if (p < 1) {
          requestAnimationFrame(render);
        }
        else {
          d.resolve(image);
          self.animationDefer = null;
        }
        self.draw(image, bound);
      }
      catch (e) {
        d.reject(e);
        self.animationDefer = null;
      }
    }());
    return d.promise;
  },

  onePartial: function (crop) {
    var self = this;
    return function (image) {
      return self.one(image, crop);
    };
  },
  runPartial: function (startCrop, endCrop, duration, easing) {
    var self = this;
    return function (image) {
      return self.run.call(self, image, startCrop, endCrop, duration, easing);
    };
  },

  abort: function () {
    if (this.animationDefer) {
      this.animationDefer.reject(new KenBurnsAbortedError("KenBurns aborted by user."));
      this.animationDefer = null;
    }
  }
};

function identity (x) {
  return x;
}

function noop (){}


function invalidArgument (value, reason) {
  console.error(value, "<- "+reason);
  throw new Error(reason);
}

function KenBurnsAbortedError (message) {
  this.message = message;
  this.stack = (new Error()).stack;
}
KenBurnsAbortedError.prototype = new Error();
KenBurnsAbortedError.prototype.name = "KenBurnsAbortedError";

function extend (obj) {
  var source, prop;
  for (var i = 1, length = arguments.length; i < length; i++) {
    source = arguments[i];
    for (prop in source) {
      if (source.hasOwnProperty(prop)) {
        obj[prop] = source[prop];
      }
    }
  }
  return obj;
}

KenBurns.mixin = function (Clazz) {
  function Mixin () {
    KenBurns.call(this);
    Clazz.apply(this, arguments);
  }
  Mixin.prototype = extend({}, KenBurns.prototype, Clazz.prototype);
  return Mixin;
};

module.exports = KenBurns;


},{"performance-now":64,"q":65,"raf":67,"rect-clamp":62,"rect-mix":49}],49:[function(require,module,exports){

function mix (a, b, p) {
  return a * (1-p) + b * p;
}

module.exports = function rectMix (a, b, p) {
  var bound = [];
  for (var i=0; i<4; ++i)
    bound[i] = mix(a[i], b[i], p);
  return bound;
};


},{}],50:[function(require,module,exports){
var KenBurnsCore = require("kenburns-core");
var Zanimo = require("zanimo");

function KenBurnsDOMTrait (container) {
  this.elt = container;
  // At least we need relative
  if (container.style.position !== "absolute") container.style.position = "relative";
  container.style.overflow = "hidden";
}

KenBurnsDOMTrait.prototype = {
  getViewport: function () {
    return this.elt.getBoundingClientRect();
  },
  abort: function () {
    this.reset();
  },
  _transformForRect: function (rect) {
    var viewport = this.getViewport();
    var scale = [ viewport.width / rect[2], viewport.height / rect[3] ];
    var translate = [ Math.round(-rect[0])+"px", Math.round(-rect[1])+"px" ];
    return "scale("+scale+") translate("+translate+")";
  },
  _reset: function () {
    this.elt.style.backgroundColor = "rgb("+this.rgb.map(function(c){ return 255 * c; })+")";
    this.elt.innerHTML = "";
  },
  _setImage: function (image) {
    if (image !== this.image) {
      this._reset();
      this.elt.appendChild(image);
      image.style.position = "absolute";
      image.style.top = "0";
      image.style.left = "0";
      Zanimo(image, "transform-origin", "0% 0%");
      this.image = image;
    }
    return Zanimo(image);
  },
  _positionImage: function (rect) {
    return Zanimo(this.image, "transform", this._transformForRect(rect));
  },

  runStart: function (image) {
    this._setImage(image);
  },
  draw: function (image, rect) {
    this._positionImage(rect);
  }

  /*,
  // TODO: can we use css transition with Zanimo ?

  _animateImage: function (toRect, duration, easing) {
    var cssEasing = easing && (typeof easing==="string" ? easing : easing.toCSS && easing.toCSS()) || "linear";
    return Zanimo(this.image, "transform", this._transformForRect(toRect), duration, cssEasing);
  },
  one: function (image, crop) {
    var rect = this._getBound(crop, image);
    return self._setImage(image)
      .then(function(){
        return self._positionImage(fromRect);
      });
  },
  run: function () {
    var args = this._runValidation.apply(this, arguments);
    var image = args[0];
    var fromRect = args[1];
    var toRect = args[2];
    var duration = args[3];
    var easing = args[4];
    var self = this;
    return self._setImage(image)
      .then(function(){
        return self._positionImage(fromRect);
      })
      .then(function () {
        return self._animateImage(toRect, duration, easing);
      });
  }
  */
};

module.exports = KenBurnsCore.mixin(KenBurnsDOMTrait);

},{"kenburns-core":48,"zanimo":57}],51:[function(require,module,exports){
/* MIT license */
var convert = require("color-convert"),
    string = require("color-string");

module.exports = function(cssString) {
   return new Color(cssString);
};

var Color = function(cssString) {
   this.values = {
      rgb: [0, 0, 0],
      hsl: [0, 0, 0],
      hsv: [0, 0, 0],
      cmyk: [0, 0, 0, 0],
      alpha: 1
   }

   // parse Color() argument
   if (typeof cssString == "string") {
      var vals = string.getRgba(cssString);
      if (vals) {
         this.setValues("rgb", vals);
      }
      else if(vals = string.getHsla(cssString)) {
         this.setValues("hsl", vals);
      }
   }
   else if (typeof cssString == "object") {
      var vals = cssString;
      if(vals["r"] !== undefined || vals["red"] !== undefined) {
         this.setValues("rgb", vals)
      }
      else if(vals["l"] !== undefined || vals["lightness"] !== undefined) {
         this.setValues("hsl", vals)
      }
      else if(vals["v"] !== undefined || vals["value"] !== undefined) {
         this.setValues("hsv", vals)
      }
      else if(vals["c"] !== undefined || vals["cyan"] !== undefined) {
         this.setValues("cmyk", vals)
      }
   }
}

Color.prototype = {
   rgb: function (vals) {
      return this.setSpace("rgb", arguments);
   },
   hsl: function(vals) {
      return this.setSpace("hsl", arguments);
   },
   hsv: function(vals) {
      return this.setSpace("hsv", arguments);
   },
   cmyk: function(vals) {
      return this.setSpace("cmyk", arguments);
   },

   rgbArray: function() {
      return this.values.rgb;
   },
   hslArray: function() {
      return this.values.hsl;
   },
   hsvArray: function() {
      return this.values.hsv;
   },
   cmykArray: function() {
      return this.values.cmyk;
   },
   rgbaArray: function() {
      var rgb = this.values.rgb;
      return rgb.concat([this.values.alpha]);
   },
   hslaArray: function() {
      var hsl = this.values.hsl;
      return hsl.concat([this.values.alpha]);
   },

   alpha: function(val) {
      if (val === undefined) {
         return this.values.alpha;
      }
      this.setValues("alpha", val);
      return this;
   },

   red: function(val) {
      return this.setChannel("rgb", 0, val);
   },
   green: function(val) {
      return this.setChannel("rgb", 1, val);
   },
   blue: function(val) {
      return this.setChannel("rgb", 2, val);
   },
   hue: function(val) {
      return this.setChannel("hsl", 0, val);
   },
   saturation: function(val) {
      return this.setChannel("hsl", 1, val);
   },
   lightness: function(val) {
      return this.setChannel("hsl", 2, val);
   },
   saturationv: function(val) {
      return this.setChannel("hsv", 1, val);
   },
   value: function(val) {
      return this.setChannel("hsv", 2, val);
   },
   cyan: function(val) {
      return this.setChannel("cmyk", 0, val);
   },
   magenta: function(val) {
      return this.setChannel("cmyk", 1, val);
   },
   yellow: function(val) {
      return this.setChannel("cmyk", 2, val);
   },
   black: function(val) {
      return this.setChannel("cmyk", 3, val);
   },

   hexString: function() {
      return string.hexString(this.values.rgb);
   },
   rgbString: function() {
      return string.rgbString(this.values.rgb, this.values.alpha);
   },
   rgbaString: function() {
      return string.rgbaString(this.values.rgb, this.values.alpha);
   },
   percentString: function() {
      return string.percentString(this.values.rgb, this.values.alpha);
   },
   hslString: function() {
      return string.hslString(this.values.hsl, this.values.alpha);
   },
   hslaString: function() {
      return string.hslaString(this.values.hsl, this.values.alpha);
   },
   keyword: function() {
      return string.keyword(this.values.rgb, this.values.alpha);
   },

   luminosity: function() {
      // http://www.w3.org/TR/WCAG20/#relativeluminancedef
      var rgb = this.values.rgb;
      var lum = [];
      for (var i = 0; i < rgb.length; i++) {
         var chan = rgb[i] / 255;
         lum[i] = (chan <= 0.03928) ? chan / 12.92
                  : Math.pow(((chan + 0.055) / 1.055), 2.4)
      }
      return 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
   },

   contrast: function(color2) {
      // http://www.w3.org/TR/WCAG20/#contrast-ratiodef
      var lum1 = this.luminosity();
      var lum2 = color2.luminosity();
      if (lum1 > lum2) {
         return (lum1 + 0.05) / (lum2 + 0.05)
      };
      return (lum2 + 0.05) / (lum1 + 0.05);
   },

   level: function(color2) {
     var contrastRatio = this.contrast(color2);
     return (contrastRatio >= 7.1)
       ? 'AAA'
       : (contrastRatio >= 4.5)
        ? 'AA'
        : '';
   },

   dark: function() {
      // YIQ equation from http://24ways.org/2010/calculating-color-contrast
      var rgb = this.values.rgb,
          yiq = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000;
   	return yiq < 128;
   },

   light: function() {
      return !this.dark();
   },

   negate: function() {
      var rgb = []
      for (var i = 0; i < 3; i++) {
         rgb[i] = 255 - this.values.rgb[i];
      }
      this.setValues("rgb", rgb);
      return this;
   },

   lighten: function(ratio) {
      this.values.hsl[2] += this.values.hsl[2] * ratio;
      this.setValues("hsl", this.values.hsl);
      return this;
   },

   darken: function(ratio) {
      this.values.hsl[2] -= this.values.hsl[2] * ratio;
      this.setValues("hsl", this.values.hsl);
      return this;
   },

   saturate: function(ratio) {
      this.values.hsl[1] += this.values.hsl[1] * ratio;
      this.setValues("hsl", this.values.hsl);
      return this;
   },

   desaturate: function(ratio) {
      this.values.hsl[1] -= this.values.hsl[1] * ratio;
      this.setValues("hsl", this.values.hsl);
      return this;
   },

   greyscale: function() {
      var rgb = this.values.rgb;
      // http://en.wikipedia.org/wiki/Grayscale#Converting_color_to_grayscale
      var val = rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11;
      this.setValues("rgb", [val, val, val]);
      return this;
   },

   clearer: function(ratio) {
      this.setValues("alpha", this.values.alpha - (this.values.alpha * ratio));
      return this;
   },

   opaquer: function(ratio) {
      this.setValues("alpha", this.values.alpha + (this.values.alpha * ratio));
      return this;
   },

   rotate: function(degrees) {
      var hue = this.values.hsl[0];
      hue = (hue + degrees) % 360;
      hue = hue < 0 ? 360 + hue : hue;
      this.values.hsl[0] = hue;
      this.setValues("hsl", this.values.hsl);
      return this;
   },

   mix: function(color2, weight) {
      weight = 1 - (weight == null ? 0.5 : weight);

      // algorithm from Sass's mix(). Ratio of first color in mix is
      // determined by the alphas of both colors and the weight
      var t1 = weight * 2 - 1,
          d = this.alpha() - color2.alpha();

      var weight1 = (((t1 * d == -1) ? t1 : (t1 + d) / (1 + t1 * d)) + 1) / 2;
      var weight2 = 1 - weight1;

      var rgb = this.rgbArray();
      var rgb2 = color2.rgbArray();

      for (var i = 0; i < rgb.length; i++) {
         rgb[i] = rgb[i] * weight1 + rgb2[i] * weight2;
      }
      this.setValues("rgb", rgb);

      var alpha = this.alpha() * weight + color2.alpha() * (1 - weight);
      this.setValues("alpha", alpha);

      return this;
   },

   toJSON: function() {
     return this.rgb();
   },

   clone: function() {
     return new Color(this.rgb());
   },
}


Color.prototype.getValues = function(space) {
   var vals = {};
   for (var i = 0; i < space.length; i++) {
      vals[space[i]] = this.values[space][i];
   }
   if (this.values.alpha != 1) {
      vals["a"] = this.values.alpha;
   }
   // {r: 255, g: 255, b: 255, a: 0.4}
   return vals;
}

Color.prototype.setValues = function(space, vals) {
   var spaces = {
      "rgb": ["red", "green", "blue"],
      "hsl": ["hue", "saturation", "lightness"],
      "hsv": ["hue", "saturation", "value"],
      "cmyk": ["cyan", "magenta", "yellow", "black"]
   };

   var maxes = {
      "rgb": [255, 255, 255],
      "hsl": [360, 100, 100],
      "hsv": [360, 100, 100],
      "cmyk": [100, 100, 100, 100],
   };

   var alpha = 1;
   if (space == "alpha") {
      alpha = vals;
   }
   else if (vals.length) {
      // [10, 10, 10]
      this.values[space] = vals.slice(0, space.length);
      alpha = vals[space.length];
   }
   else if (vals[space[0]] !== undefined) {
      // {r: 10, g: 10, b: 10}
      for (var i = 0; i < space.length; i++) {
        this.values[space][i] = vals[space[i]];
      }
      alpha = vals.a;
   }
   else if (vals[spaces[space][0]] !== undefined) {
      // {red: 10, green: 10, blue: 10}
      var chans = spaces[space];
      for (var i = 0; i < space.length; i++) {
        this.values[space][i] = vals[chans[i]];
      }
      alpha = vals.alpha;
   }
   this.values.alpha = Math.max(0, Math.min(1, (alpha !== undefined ? alpha : this.values.alpha) ));
   if (space == "alpha") {
      return;
   }

   // convert to all the other color spaces
   for (var sname in spaces) {
      if (sname != space) {
         this.values[sname] = convert[space][sname](this.values[space])
      }

      // cap values
      for (var i = 0; i < sname.length; i++) {
         var capped = Math.max(0, Math.min(maxes[sname][i], this.values[sname][i]));
         this.values[sname][i] = Math.round(capped);
      }
   }
   return true;
}

Color.prototype.setSpace = function(space, args) {
   var vals = args[0];
   if (vals === undefined) {
      // color.rgb()
      return this.getValues(space);
   }
   // color.rgb(10, 10, 10)
   if (typeof vals == "number") {
      vals = Array.prototype.slice.call(args);
   }
   this.setValues(space, vals);
   return this;
}

Color.prototype.setChannel = function(space, index, val) {
   if (val === undefined) {
      // color.red()
      return this.values[space][index];
   }
   // color.red(100)
   this.values[space][index] = val;
   this.setValues(space, this.values[space]);
   return this;
}

},{"color-convert":53,"color-string":54}],52:[function(require,module,exports){
/* MIT license */

module.exports = {
  rgb2hsl: rgb2hsl,
  rgb2hsv: rgb2hsv,
  rgb2cmyk: rgb2cmyk,
  rgb2keyword: rgb2keyword,
  rgb2xyz: rgb2xyz,
  rgb2lab: rgb2lab,

  hsl2rgb: hsl2rgb,
  hsl2hsv: hsl2hsv,
  hsl2cmyk: hsl2cmyk,
  hsl2keyword: hsl2keyword,

  hsv2rgb: hsv2rgb,
  hsv2hsl: hsv2hsl,
  hsv2cmyk: hsv2cmyk,
  hsv2keyword: hsv2keyword,

  cmyk2rgb: cmyk2rgb,
  cmyk2hsl: cmyk2hsl,
  cmyk2hsv: cmyk2hsv,
  cmyk2keyword: cmyk2keyword,
  
  keyword2rgb: keyword2rgb,
  keyword2hsl: keyword2hsl,
  keyword2hsv: keyword2hsv,
  keyword2cmyk: keyword2cmyk,
  
  xyz2rgb: xyz2rgb,
}


function rgb2hsl(rgb) {
  var r = rgb[0]/255,
      g = rgb[1]/255,
      b = rgb[2]/255,
      min = Math.min(r, g, b),
      max = Math.max(r, g, b),
      delta = max - min,
      h, s, l;

  if (max == min)
    h = 0;
  else if (r == max) 
    h = (g - b) / delta; 
  else if (g == max)
    h = 2 + (b - r) / delta; 
  else if (b == max)
    h = 4 + (r - g)/ delta;

  h = Math.min(h * 60, 360);

  if (h < 0)
    h += 360;

  l = (min + max) / 2;

  if (max == min)
    s = 0;
  else if (l <= 0.5)
    s = delta / (max + min);
  else
    s = delta / (2 - max - min);

  return [h, s * 100, l * 100];
}

function rgb2hsv(rgb) {
  var r = rgb[0],
      g = rgb[1],
      b = rgb[2],
      min = Math.min(r, g, b),
      max = Math.max(r, g, b),
      delta = max - min,
      h, s, v;

  if (max == 0)
    s = 0;
  else
    s = (delta/max * 1000)/10;

  if (max == min)
    h = 0;
  else if (r == max) 
    h = (g - b) / delta; 
  else if (g == max)
    h = 2 + (b - r) / delta; 
  else if (b == max)
    h = 4 + (r - g) / delta;

  h = Math.min(h * 60, 360);

  if (h < 0) 
    h += 360;

  v = ((max / 255) * 1000) / 10;

  return [h, s, v];
}

function rgb2cmyk(rgb) {
  var r = rgb[0] / 255,
      g = rgb[1] / 255,
      b = rgb[2] / 255,
      c, m, y, k;
      
  k = Math.min(1 - r, 1 - g, 1 - b);
  c = (1 - r - k) / (1 - k);
  m = (1 - g - k) / (1 - k);
  y = (1 - b - k) / (1 - k);
  return [c * 100, m * 100, y * 100, k * 100];
}

function rgb2keyword(rgb) {
  return reverseKeywords[JSON.stringify(rgb)];
}

function rgb2xyz(rgb) {
  var r = rgb[0] / 255,
      g = rgb[1] / 255,
      b = rgb[2] / 255;

  // assume sRGB
  r = r > 0.04045 ? Math.pow(((r + 0.055) / 1.055), 2.4) : (r / 12.92);
  g = g > 0.04045 ? Math.pow(((g + 0.055) / 1.055), 2.4) : (g / 12.92);
  b = b > 0.04045 ? Math.pow(((b + 0.055) / 1.055), 2.4) : (b / 12.92);
  
  var x = (r * 0.4124) + (g * 0.3576) + (b * 0.1805);
  var y = (r * 0.2126) + (g * 0.7152) + (b * 0.0722);
  var z = (r * 0.0193) + (g * 0.1192) + (b * 0.9505);

  return [x * 100, y *100, z * 100];
}

function rgb2lab(rgb) {
  var xyz = rgb2xyz(rgb),
        x = xyz[0],
        y = xyz[1],
        z = xyz[2],
        l, a, b;

  x /= 95.047;
  y /= 100;
  z /= 108.883;

  x = x > 0.008856 ? Math.pow(x, 1/3) : (7.787 * x) + (16 / 116);
  y = y > 0.008856 ? Math.pow(y, 1/3) : (7.787 * y) + (16 / 116);
  z = z > 0.008856 ? Math.pow(z, 1/3) : (7.787 * z) + (16 / 116);

  l = (116 * y) - 16;
  a = 500 * (x - y);
  b = 200 * (y - z);
  
  return [l, a, b];
}


function hsl2rgb(hsl) {
  var h = hsl[0] / 360,
      s = hsl[1] / 100,
      l = hsl[2] / 100,
      t1, t2, t3, rgb, val;

  if (s == 0) {
    val = l * 255;
    return [val, val, val];
  }

  if (l < 0.5)
    t2 = l * (1 + s);
  else
    t2 = l + s - l * s;
  t1 = 2 * l - t2;

  rgb = [0, 0, 0];
  for (var i = 0; i < 3; i++) {
    t3 = h + 1 / 3 * - (i - 1);
    t3 < 0 && t3++;
    t3 > 1 && t3--;

    if (6 * t3 < 1)
      val = t1 + (t2 - t1) * 6 * t3;
    else if (2 * t3 < 1)
      val = t2;
    else if (3 * t3 < 2)
      val = t1 + (t2 - t1) * (2 / 3 - t3) * 6;
    else
      val = t1;

    rgb[i] = val * 255;
  }
  
  return rgb;
}

function hsl2hsv(hsl) {
  var h = hsl[0],
      s = hsl[1] / 100,
      l = hsl[2] / 100,
      sv, v;
  l *= 2;
  s *= (l <= 1) ? l : 2 - l;
  v = (l + s) / 2;
  sv = (2 * s) / (l + s);
  return [h, s * 100, v * 100];
}

function hsl2cmyk(args) {
  return rgb2cmyk(hsl2rgb(args));
}

function hsl2keyword(args) {
  return rgb2keyword(hsl2rgb(args));
}


function hsv2rgb(hsv) {
  var h = hsv[0] / 60,
      s = hsv[1] / 100,
      v = hsv[2] / 100,
      hi = Math.floor(h) % 6;

  var f = h - Math.floor(h),
      p = 255 * v * (1 - s),
      q = 255 * v * (1 - (s * f)),
      t = 255 * v * (1 - (s * (1 - f))),
      v = 255 * v;

  switch(hi) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    case 5:
      return [v, p, q];
  }
}

function hsv2hsl(hsv) {
  var h = hsv[0],
      s = hsv[1] / 100,
      v = hsv[2] / 100,
      sl, l;

  l = (2 - s) * v;  
  sl = s * v;
  sl /= (l <= 1) ? l : 2 - l;
  l /= 2;
  return [h, sl * 100, l * 100];
}

function hsv2cmyk(args) {
  return rgb2cmyk(hsv2rgb(args));
}

function hsv2keyword(args) {
  return rgb2keyword(hsv2rgb(args));
}

function cmyk2rgb(cmyk) {
  var c = cmyk[0] / 100,
      m = cmyk[1] / 100,
      y = cmyk[2] / 100,
      k = cmyk[3] / 100,
      r, g, b;

  r = 1 - Math.min(1, c * (1 - k) + k);
  g = 1 - Math.min(1, m * (1 - k) + k);
  b = 1 - Math.min(1, y * (1 - k) + k);
  return [r * 255, g * 255, b * 255];
}

function cmyk2hsl(args) {
  return rgb2hsl(cmyk2rgb(args));
}

function cmyk2hsv(args) {
  return rgb2hsv(cmyk2rgb(args));
}

function cmyk2keyword(args) {
  return rgb2keyword(cmyk2rgb(args));
}


function xyz2rgb(xyz) {
  var x = xyz[0] / 100,
      y = xyz[1] / 100,
      z = xyz[2] / 100,
      r, g, b;

  r = (x * 3.2406) + (y * -1.5372) + (z * -0.4986);
  g = (x * -0.9689) + (y * 1.8758) + (z * 0.0415);
  b = (x * 0.0557) + (y * -0.2040) + (z * 1.0570);

  // assume sRGB
  r = r > 0.0031308 ? ((1.055 * Math.pow(r, 1.0 / 2.4)) - 0.055)
    : r = (r * 12.92);

  g = g > 0.0031308 ? ((1.055 * Math.pow(g, 1.0 / 2.4)) - 0.055)
    : g = (g * 12.92);
        
  b = b > 0.0031308 ? ((1.055 * Math.pow(b, 1.0 / 2.4)) - 0.055)
    : b = (b * 12.92);

  r = (r < 0) ? 0 : r;
  g = (g < 0) ? 0 : g;
  b = (b < 0) ? 0 : b;

  return [r * 255, g * 255, b * 255];
}


function keyword2rgb(keyword) {
  return cssKeywords[keyword];
}

function keyword2hsl(args) {
  return rgb2hsl(keyword2rgb(args));
}

function keyword2hsv(args) {
  return rgb2hsv(keyword2rgb(args));
}

function keyword2cmyk(args) {
  return rgb2cmyk(keyword2rgb(args));
}

var cssKeywords = {
  aliceblue:  [240,248,255],
  antiquewhite: [250,235,215],
  aqua: [0,255,255],
  aquamarine: [127,255,212],
  azure:  [240,255,255],
  beige:  [245,245,220],
  bisque: [255,228,196],
  black:  [0,0,0],
  blanchedalmond: [255,235,205],
  blue: [0,0,255],
  blueviolet: [138,43,226],
  brown:  [165,42,42],
  burlywood:  [222,184,135],
  cadetblue:  [95,158,160],
  chartreuse: [127,255,0],
  chocolate:  [210,105,30],
  coral:  [255,127,80],
  cornflowerblue: [100,149,237],
  cornsilk: [255,248,220],
  crimson:  [220,20,60],
  cyan: [0,255,255],
  darkblue: [0,0,139],
  darkcyan: [0,139,139],
  darkgoldenrod:  [184,134,11],
  darkgray: [169,169,169],
  darkgreen:  [0,100,0],
  darkgrey: [169,169,169],
  darkkhaki:  [189,183,107],
  darkmagenta:  [139,0,139],
  darkolivegreen: [85,107,47],
  darkorange: [255,140,0],
  darkorchid: [153,50,204],
  darkred:  [139,0,0],
  darksalmon: [233,150,122],
  darkseagreen: [143,188,143],
  darkslateblue:  [72,61,139],
  darkslategray:  [47,79,79],
  darkslategrey:  [47,79,79],
  darkturquoise:  [0,206,209],
  darkviolet: [148,0,211],
  deeppink: [255,20,147],
  deepskyblue:  [0,191,255],
  dimgray:  [105,105,105],
  dimgrey:  [105,105,105],
  dodgerblue: [30,144,255],
  firebrick:  [178,34,34],
  floralwhite:  [255,250,240],
  forestgreen:  [34,139,34],
  fuchsia:  [255,0,255],
  gainsboro:  [220,220,220],
  ghostwhite: [248,248,255],
  gold: [255,215,0],
  goldenrod:  [218,165,32],
  gray: [128,128,128],
  green:  [0,128,0],
  greenyellow:  [173,255,47],
  grey: [128,128,128],
  honeydew: [240,255,240],
  hotpink:  [255,105,180],
  indianred:  [205,92,92],
  indigo: [75,0,130],
  ivory:  [255,255,240],
  khaki:  [240,230,140],
  lavender: [230,230,250],
  lavenderblush:  [255,240,245],
  lawngreen:  [124,252,0],
  lemonchiffon: [255,250,205],
  lightblue:  [173,216,230],
  lightcoral: [240,128,128],
  lightcyan:  [224,255,255],
  lightgoldenrodyellow: [250,250,210],
  lightgray:  [211,211,211],
  lightgreen: [144,238,144],
  lightgrey:  [211,211,211],
  lightpink:  [255,182,193],
  lightsalmon:  [255,160,122],
  lightseagreen:  [32,178,170],
  lightskyblue: [135,206,250],
  lightslategray: [119,136,153],
  lightslategrey: [119,136,153],
  lightsteelblue: [176,196,222],
  lightyellow:  [255,255,224],
  lime: [0,255,0],
  limegreen:  [50,205,50],
  linen:  [250,240,230],
  magenta:  [255,0,255],
  maroon: [128,0,0],
  mediumaquamarine: [102,205,170],
  mediumblue: [0,0,205],
  mediumorchid: [186,85,211],
  mediumpurple: [147,112,219],
  mediumseagreen: [60,179,113],
  mediumslateblue:  [123,104,238],
  mediumspringgreen:  [0,250,154],
  mediumturquoise:  [72,209,204],
  mediumvioletred:  [199,21,133],
  midnightblue: [25,25,112],
  mintcream:  [245,255,250],
  mistyrose:  [255,228,225],
  moccasin: [255,228,181],
  navajowhite:  [255,222,173],
  navy: [0,0,128],
  oldlace:  [253,245,230],
  olive:  [128,128,0],
  olivedrab:  [107,142,35],
  orange: [255,165,0],
  orangered:  [255,69,0],
  orchid: [218,112,214],
  palegoldenrod:  [238,232,170],
  palegreen:  [152,251,152],
  paleturquoise:  [175,238,238],
  palevioletred:  [219,112,147],
  papayawhip: [255,239,213],
  peachpuff:  [255,218,185],
  peru: [205,133,63],
  pink: [255,192,203],
  plum: [221,160,221],
  powderblue: [176,224,230],
  purple: [128,0,128],
  red:  [255,0,0],
  rosybrown:  [188,143,143],
  royalblue:  [65,105,225],
  saddlebrown:  [139,69,19],
  salmon: [250,128,114],
  sandybrown: [244,164,96],
  seagreen: [46,139,87],
  seashell: [255,245,238],
  sienna: [160,82,45],
  silver: [192,192,192],
  skyblue:  [135,206,235],
  slateblue:  [106,90,205],
  slategray:  [112,128,144],
  slategrey:  [112,128,144],
  snow: [255,250,250],
  springgreen:  [0,255,127],
  steelblue:  [70,130,180],
  tan:  [210,180,140],
  teal: [0,128,128],
  thistle:  [216,191,216],
  tomato: [255,99,71],
  turquoise:  [64,224,208],
  violet: [238,130,238],
  wheat:  [245,222,179],
  white:  [255,255,255],
  whitesmoke: [245,245,245],
  yellow: [255,255,0],
  yellowgreen:  [154,205,50]
};

var reverseKeywords = {};
for (var key in cssKeywords) {
  reverseKeywords[JSON.stringify(cssKeywords[key])] = key;
}

},{}],53:[function(require,module,exports){
var conversions = require("./conversions");

var exports = {};
module.exports = exports;

for (var func in conversions) {
  // export rgb2hslRaw
  exports[func + "Raw"] =  (function(func) {
    // accept array or plain args
    return function(arg) {
      if (typeof arg == "number")
        arg = Array.prototype.slice.call(arguments);
      return conversions[func](arg);
    }
  })(func);

  var pair = /(\w+)2(\w+)/.exec(func),
      from = pair[1],
      to = pair[2];

  // export rgb2hsl and ["rgb"]["hsl"]
  exports[from] = exports[from] || {};

  exports[from][to] = exports[func] = (function(func) { 
    return function(arg) {
      if (typeof arg == "number")
        arg = Array.prototype.slice.call(arguments);
      
      var val = conversions[func](arg);
      if (typeof val == "string" || val === undefined)
        return val; // keyword

      for (var i = 0; i < val.length; i++)
        val[i] = Math.round(val[i]);
      return val;
    }
  })(func);
}
},{"./conversions":52}],54:[function(require,module,exports){
/* MIT license */
var convert = require("color-convert");

module.exports = {
   getRgba: getRgba,
   getHsla: getHsla,
   getRgb: getRgb,
   getHsl: getHsl,
   getAlpha: getAlpha,

   hexString: hexString,
   rgbString: rgbString,
   rgbaString: rgbaString,
   percentString: percentString,
   percentaString: percentaString,
   hslString: hslString,
   hslaString: hslaString,
   keyword: keyword
}

function getRgba(string) {
   if (!string) {
      return;
   }
   var abbr =  /^#([a-fA-F0-9]{3})$/,
       hex =  /^#([a-fA-F0-9]{6})$/,
       rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d\.]+)\s*)?\)$/,
       per = /^rgba?\(\s*([\d\.]+)\%\s*,\s*([\d\.]+)\%\s*,\s*([\d\.]+)\%\s*(?:,\s*([\d\.]+)\s*)?\)$/,
       keyword = /(\D+)/;

   var rgb = [0, 0, 0],
       a = 1,
       match = string.match(abbr);
   if (match) {
      match = match[1];
      for (var i = 0; i < rgb.length; i++) {
         rgb[i] = parseInt(match[i] + match[i], 16);
      }
   }
   else if (match = string.match(hex)) {
      match = match[1];
      for (var i = 0; i < rgb.length; i++) {
         rgb[i] = parseInt(match.slice(i * 2, i * 2 + 2), 16);
      }
   }
   else if (match = string.match(rgba)) {
      for (var i = 0; i < rgb.length; i++) {
         rgb[i] = parseInt(match[i + 1]);
      }
      a = parseFloat(match[4]);
   }
   else if (match = string.match(per)) {
      for (var i = 0; i < rgb.length; i++) {
         rgb[i] = Math.round(parseFloat(match[i + 1]) * 2.55);
      }
      a = parseFloat(match[4]);
   }
   else if (match = string.match(keyword)) {
      if (match[1] == "transparent") {
         return [0, 0, 0, 0];
      }
      rgb = convert.keyword2rgb(match[1]);
      if (!rgb) {
         return;
      }
   }

   for (var i = 0; i < rgb.length; i++) {
      rgb[i] = scale(rgb[i], 0, 255);
   }
   if (!a && a != 0) {
      a = 1;
   }
   else {
      a = scale(a, 0, 1);
   }
   rgb.push(a);
   return rgb;
}

function getHsla(string) {
   if (!string) {
      return;
   }
   var hsl = /^hsla?\(\s*(\d+)\s*,\s*([\d\.]+)%\s*,\s*([\d\.]+)%\s*(?:,\s*([\d\.]+)\s*)?\)/;
   var match = string.match(hsl);
   if (match) {
      var h = scale(parseInt(match[1]), 0, 360),
          s = scale(parseFloat(match[2]), 0, 100),
          l = scale(parseFloat(match[3]), 0, 100),
          a = scale(parseFloat(match[4]) || 1, 0, 1);
      return [h, s, l, a];
   }
}

function getRgb(string) {
   return getRgba(string).slice(0, 3);
}

function getHsl(string) {
   return getHsla(string).slice(0, 3);
}

function getAlpha(string) {
   var vals = getRgba(string);
   if (vals) {
      return vals[3];
   }
   else if (vals = getHsla(string)) {
      return vals[3];
   }
}

// generators
function hexString(rgb) {
   return "#" + hexDouble(rgb[0]) + hexDouble(rgb[1])
              + hexDouble(rgb[2]);
}

function rgbString(rgba, alpha) {
   if (alpha < 1 || (rgba[3] && rgba[3] < 1)) {
      return rgbaString(rgba, alpha);
   }
   return "rgb(" + rgba[0] + ", " + rgba[1] + ", " + rgba[2] + ")";
}

function rgbaString(rgba, alpha) {
   if (alpha === undefined) {
      alpha = (rgba[3] !== undefined ? rgba[3] : 1);
   }
   return "rgba(" + rgba[0] + ", " + rgba[1] + ", " + rgba[2]
           + ", " + alpha + ")";
}

function percentString(rgba, alpha) {
   if (alpha < 1 || (rgba[3] && rgba[3] < 1)) {
      return percentaString(rgba, alpha);
   }
   var r = Math.round(rgba[0]/255 * 100),
       g = Math.round(rgba[1]/255 * 100),
       b = Math.round(rgba[2]/255 * 100);

   return "rgb(" + r + "%, " + g + "%, " + b + "%)";
}

function percentaString(rgba, alpha) {
   var r = Math.round(rgba[0]/255 * 100),
       g = Math.round(rgba[1]/255 * 100),
       b = Math.round(rgba[2]/255 * 100);
   return "rgba(" + r + "%, " + g + "%, " + b + "%, " + (alpha || rgba[3] || 1) + ")";
}

function hslString(hsla, alpha) {
   if (alpha < 1 || (hsla[3] && hsla[3] < 1)) {
      return hslaString(hsla, alpha);
   }
   return "hsl(" + hsla[0] + ", " + hsla[1] + "%, " + hsla[2] + "%)";
}

function hslaString(hsla, alpha) {
   if (alpha === undefined) {
      alpha = (hsla[3] !== undefined ? hsla[3] : 1);
   }
   return "hsla(" + hsla[0] + ", " + hsla[1] + "%, " + hsla[2] + "%, "
           + alpha + ")";
}

function keyword(rgb) {
   return convert.rgb2keyword(rgb.slice(0, 3));
}

// helpers
function scale(num, min, max) {
   return Math.min(Math.max(min, num), max);
}

function hexDouble(num) {
  var str = num.toString(16).toUpperCase();
  return (str.length < 2) ? "0" + str : str;
}

},{"color-convert":53}],55:[function(require,module,exports){
/*
 * Qanimationframe.js - Promisified requestAnimationFrame with Q
 */
/*jslint newcap: true */
(function (definition) {
    if (typeof exports === "object") {
        module.exports = definition();
    } else {
        window.QanimationFrame = definition();
    }
})(function () {
  "use strict";

  // Import Q
  var Q = window.Q || require("q");

  // requestAnimationFrame polyfill
  var requestAnimationFrame = (function(){
    return window.requestAnimationFrame       ||
           window.oRequestAnimationFrame      ||
           window.msRequestAnimationFrame     ||
           window.mozRequestAnimationFrame    ||
           window.webkitRequestAnimationFrame ||
           function (callback) {
             window.setTimeout(callback, 1000 / 60);
           };
  })();

  // QanimationFrame(f: function) => promise containing the return value of f
  // ---
  //
  var QanimationFrame = function (f) {
    var d = Q.defer();
    requestAnimationFrame(function () {
      try {
        d.resolve(f());
      } catch (e) {
        d.reject(e);
      }
    });
    return d.promise;
  };

  return QanimationFrame;
});

},{"q":65}],56:[function(require,module,exports){
'use strict';

var style = document.createElement('p').style,
    prefixes = 'O ms Moz webkit'.split(' '),
    hasPrefix = /^(o|ms|moz|webkit)/,
    upper = /([A-Z])/g,
    memo = {};

function get(key){
    return (key in memo) ? memo[key] : memo[key] = prefix(key);
}

function prefix(key){
    var capitalizedKey = key.replace(/-([a-z])/g, function(s, match){
            return match.toUpperCase();
        }),
        i = prefixes.length,
        name;

    if (style[capitalizedKey] !== undefined) return capitalizedKey;

    capitalizedKey = capitalize(key);

    while (i--) {
        name = prefixes[i] + capitalizedKey;
        if (style[name] !== undefined) return name;
    }

    throw new Error('unable to prefix ' + key);
}

function capitalize(str){
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function dashedPrefix(key){
    var prefixedKey = get(key),
        upper = /([A-Z])/g;

    if (upper.test(prefixedKey)) {
        prefixedKey = (hasPrefix.test(prefixedKey) ? '-' : '') + prefixedKey.replace(upper, '-$1');
    }

    return prefixedKey.toLowerCase();
}

module.exports = get;
module.exports.dash = dashedPrefix;

},{}],57:[function(require,module,exports){
// Zanimo.js - Promise based CSS3 transitions
// (c) 2011-2014 Paul Panserrieu

'use strict';

var Q = require('q'),
    QanimationFrame = require('qanimationframe'),
    prefix = require('vendor-prefix'),
    normalizeTransformValue = require('../src/normalize-transform-value'),
    shorthand = require('../src/transition-shorthand-property'),
    transition = prefix('transition'),
    transitionend = 'WebkitTransition' in document.body.style ? 'webkitTransitionEnd' : 'transitionend',

    isDOM = function (el) {
        try {
            return el && el.nodeType;
        } catch(err) {
            return false;
        };
    },

    addTransition = function (elt, attr, value, duration, easing) {
        var currentValue = elt.style[transition];
        attr = prefix.dash(attr);
        if (currentValue) {
            elt.style[transition] = currentValue + ", " + shorthand(attr, duration, easing);
        }
        else {
            elt.style[transition] = shorthand(attr, duration, easing);
        }
        elt.style[prefix(attr)] = value;
    },

    removeTransition = function (el, attr) {
        el.style[transition] = el.style[transition]
            .split(',').filter(function(t) {
                return !t.match(attr);
            }).join(',');
    },

    applycss = function (el, attr, value) {
        return QanimationFrame(function(){
            el.style[prefix.dash(attr)] = value;
            return el;
        });
    },

    css = function (el, attr, value) {
        if(el._zanimo && el._zanimo.hasOwnProperty(attr)) {
            el._zanimo[attr].defer.reject(new Error(
                "Zanimo transition with transform=" +
                el._zanimo[attr].value +
                " stopped by transform=" + value
            ));
            el._zanimo[attr].cb();
        }
        return applycss(el, attr, value);
    },

    animate = function (el, attr, value, duration, easing) {
        var prefixed = prefix.dash(attr),
            d = Q.defer(),
            timeout,
            cb = function (clear) {
                if (timeout) { clearTimeout(timeout); timeout = null; }
                removeTransition(el, attr);
                el.removeEventListener(transitionend, cbTransitionend);
                if (clear) { delete el._zanimo[attr]; }
            },
            cbTransitionend = function (evt) {
                if(prefix(evt.propertyName) === prefix(prefixed)) {
                    cb(true);
                    d.resolve(el);
                }
            };

        el.addEventListener(transitionend, cbTransitionend);

        QanimationFrame(function () {
            addTransition(el, attr, normalizeTransformValue(value), duration, easing);
            timeout = setTimeout(function () {
                var rawVal = el.style.getPropertyValue(prefixed),
                    domVal = normalizeTransformValue(rawVal),
                    givenVal = normalizeTransformValue(value);

                cb(true);
                if (domVal === givenVal) { d.resolve(el); }
                else {
                    d.reject( new Error("Zanimo transition: with "
                        + attr + " = " + givenVal + ", DOM value=" + domVal
                    ));
                }
            }, duration + 20 );

            el._zanimo = el._zanimo || { };
            if(el._zanimo[attr]) {
                el._zanimo[attr].defer.reject(new Error(
                    "Zanimo transition with " +
                    attr + "=" + el._zanimo[attr].value +
                    " stopped by transition with " + attr + "=" + value
                ));
                el._zanimo[attr].cb();
            }
            el._zanimo[attr] = {cb: cb, value: value, defer: d};
        });

        return d.promise;
    };

/**
 * Zanimo(el | promise[el])
 * > Returns a Promise of el.
 *
 * Zanimo(el | promise[el], attr, value)
 * > Sets el.style[attr]=value and returns the promise of el.
 *
 * Zanimo(el | promise[el], attr, value, duration, [easing])
 * > Performs a transition.
 */
var Zanimo = function (el, attr, value, duration, easing) {
    var args = arguments,
        arity = arguments.length;
    if (arity === 0 || arity === 2 || arity > 5) {
        return Q.reject(new Error("Zanimo invalid arguments"));
    }
    if (Q.isPromise(el)) {
        return el.then(function (val) {
            return Zanimo.apply(this, [val].concat(Array.prototype.slice.call(args, 1)));
        });
    }
    if (!isDOM(el)) {
        return Q.reject(new Error("Zanimo require an HTMLElement, or a promise of an HTMLElement"));
    }
    if (arity === 1) {
        return Q(el);
    }
    try {
        prefix.dash(attr);
    } catch(err) {
        return Q.reject(new Error("Zanimo transition: " + attr + ' is not supported!'));
    };
    if (arity === 3) {
        return css(el, attr, value);
    }
    if(window.isNaN(parseInt(duration, 10))) {
        return Q.reject(new Error("Zanimo transition: duration must be an integer!"));
    }
    return animate(el, attr, value, duration, easing);
};

/**
 * A function wrapping `Zanimo(el, ...)` as a `f(...)(el)` for easy chaining purpose.
 */
Zanimo.f = function (attr, value, duration, easing) {
    var args = Array.prototype.slice.call(arguments);
    return function (el) {
        return Zanimo.apply(this, [el].concat(args));
    };
};

module.exports = Zanimo;

},{"../src/normalize-transform-value":59,"../src/transition-shorthand-property":60,"q":65,"qanimationframe":55,"vendor-prefix":56}],58:[function(require,module,exports){
'use strict';

var matchParenthesis = /(\(.+?\))/g,
    space = / +/g,
    emptyString = "",
    whitespace = " ",

    normalize = function (match) {
        var args = match.substr(1, match.length-2).split(","),
            rst = args.map(function (arg) {
                return parseFloat(arg.replace(space, emptyString));
            });
        return "(" + rst.join(",") + ")";
    };

module.exports = function (t) {
    return  typeof t === 'string' ? t.replace(space, whitespace).replace(matchParenthesis, normalize) : t;
};

},{}],59:[function(require,module,exports){
'use strict';

var Color = require('color'),
    matchParenthesis = /(\(.+?\))/g,
    matchColors = /(\brgba\b|\bhsl\b|\bhsla\b)(\(.+?\))/g,
    space = / +/g,
    emptyString = "",
    whitespace = " ",
    zeropixel = /^0px$/g,
    zero = "0",

    normArgs = function (match) {
        var args = match.substr(1, match.length-2).split(","),
            rst = args.map(function (arg) {
                return arg.replace(space, emptyString).replace(zeropixel, zero);
            });
        return "(" + rst.join(",") + ")";
    },

    normColors = function (match) {
        var c = Color(match);
        if (c.alpha() ) { c.alpha(Math.round(c.alpha() * 10) / 10); }
        return c.rgbString();
    },

    normalize = function (val) {
        return val.replace(space, whitespace)
            .replace(matchColors, normColors)
            .replace(matchParenthesis, normArgs);
    };

module.exports = function (val) {
    if (val === null || val === undefined) return emptyString;
    return window.isNaN(val) ? normalize(val) : val.toString();
};

},{"color":51}],60:[function(require,module,exports){
'use strict';

var prefix = require('vendor-prefix'),
    normalizeTransformValue = require('./normalize-transform-value'),
    normalizeTimingFunction = require('./normalize-timing-function'),
    transition = prefix.dash('transition'),
    el = document.createElement('div'),
    test = 'opacity 100ms linear 0s',
    normalizedTest = normalizeTransformValue(test),
    shorthand = function shorthand(v, d, t) {
        return v + " " + d + "ms " + (t || "linear");
    };

el.style[transition] = normalizedTest;

if(normalizeTransformValue(el.style[transition]) === normalizedTest) {
    shorthand = function (v, d, t) {
        return v + " " + d + "ms " + (normalizeTimingFunction(t) || "linear") + " 0s";
    };
}

module.exports = shorthand;

},{"./normalize-timing-function":58,"./normalize-transform-value":59,"vendor-prefix":56}],61:[function(require,module,exports){
var KenBurnsCore = require("kenburns-core");

// TODO use gl-shader and gl-texture2d

// WebGL implementation

var vertexShaderSource =
"uniform vec2 imgRes;"+ // image size
"uniform vec2 pos;"+ // bound position
"uniform vec2 dim;"+ // bound size
"attribute vec2 p;"+
"varying vec2 uv;"+
"void main() {"+
  "uv = pos/imgRes + ((p * vec2(1.,-1.)+1.)/2.) * (dim/imgRes);"+
  "gl_Position = vec4(p,0.,1.);"+
"}";
var fragmentShaderSource =
"#ifdef GL_ES\n"+
"precision highp float;\n"+
"#endif\n"+
"uniform sampler2D img;"+
"uniform vec3 bg;"+
"varying vec2 uv;"+
"void main() {"+
  "if(uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.)"+
    "gl_FragColor = vec4(bg, 1.0);"+
  "else "+
    "gl_FragColor = texture2D(img, uv);"+
"}";

function KenBurnsWebGLTrait (canvas) {
  this.canvas = canvas;
  var gl = this.gl = canvas.getContext("webgl");

  var program = this.program = gl.createProgram();

  var vertexShader = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vertexShader, vertexShaderSource);
  gl.compileShader(vertexShader);
  gl.attachShader(program, vertexShader);

  var fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fragmentShader, fragmentShaderSource);
  gl.compileShader(fragmentShader);
  gl.attachShader(program, fragmentShader);

  gl.linkProgram(program);
  gl.useProgram(program);

  this.positionLocation = gl.getAttribLocation(program, "p");
  this.imgResL = gl.getUniformLocation(program, "imgRes");
  this.posL = gl.getUniformLocation(program, "pos");
  this.dimL = gl.getUniformLocation(program, "dim");
  this.bgL = gl.getUniformLocation(program, "bg");
  this.buffer = gl.createBuffer();
}
KenBurnsWebGLTrait.prototype = {
  runStart: function (image) {
    var gl = this.gl;
    var canvas = this.canvas;
    gl.useProgram(this.program);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1.0, -1.0, 
        1.0, -1.0, 
        -1.0,  1.0, 
        -1.0,  1.0, 
        1.0, -1.0, 
        1.0,  1.0]), 
      gl.STATIC_DRAW);

    var positionLocation = this.positionLocation;
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.uniform2f(this.imgResL, image.width, image.height);
    gl.uniform3fv(this.bgL, this.rgb);

    var texture = this.texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  },
  runEnd: function () {
    this.gl.deleteTexture(this.texture);
  },
  draw: function (image, bound) {
    var gl = this.gl;
    gl.uniform2f(this.posL, bound[0], bound[1]);
    gl.uniform2f(this.dimL, bound[2], bound[3]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  },
  destroy: function () {
    this.gl.deleteBuffer(this.buffer);
    this.gl.deleteProgram(this.program);
  },
  getViewport: function () {
    return this.canvas;
  }
};

module.exports = KenBurnsCore.mixin(KenBurnsWebGLTrait);


},{"kenburns-core":48}],62:[function(require,module,exports){
module.exports = function rectClamp (rect, bounds) {
  var w = rect[2], h = rect[3];
  var maxWidth = bounds[2], maxHeight = bounds[3];
  var ratio = w / h;
  if (w > maxWidth) {
    w = maxWidth;
    h = ~~(w / ratio);
  }
  if (h > maxHeight) {
    h = maxHeight;
    w = ~~(h * ratio);
  }
  return [
    bounds[0] + Math.max(0, Math.min(rect[0], maxWidth-w)),
    bounds[1] + Math.max(0, Math.min(rect[1], maxHeight-h)),
    w,
    h
  ];
};


},{}],63:[function(require,module,exports){
function rectCrop (zoom, center) {
  if (!center) center = [0.5, 0.5];
  return function (viewport, dimension) {
    var viewportRatio = viewport.width / viewport.height;
    var dimensionRatio = dimension.width / dimension.height;

    var maxRatio = Math.max(viewportRatio, dimensionRatio);
    var zoomedCanvasSize = [
      (viewportRatio / maxRatio) * dimension.width * zoom,
      (dimensionRatio / maxRatio) * dimension.height * zoom
    ];

    return [
      dimension.width * center[0] - zoomedCanvasSize[0] / 2,
      dimension.height * center[1] - zoomedCanvasSize[1] / 2,
      zoomedCanvasSize[0],
      zoomedCanvasSize[1]
    ];
  };
}

rectCrop.largest = rectCrop(1);

module.exports = rectCrop;


},{}],64:[function(require,module,exports){
(function (process){
// Generated by CoffeeScript 1.7.1
(function() {
  var getNanoSeconds, hrtime, loadTime;

  if ((typeof performance !== "undefined" && performance !== null) && performance.now) {
    module.exports = function() {
      return performance.now();
    };
  } else if ((typeof process !== "undefined" && process !== null) && process.hrtime) {
    module.exports = function() {
      return (getNanoSeconds() - loadTime) / 1e6;
    };
    hrtime = process.hrtime;
    getNanoSeconds = function() {
      var hr;
      hr = hrtime();
      return hr[0] * 1e9 + hr[1];
    };
    loadTime = getNanoSeconds();
  } else if (Date.now) {
    module.exports = function() {
      return Date.now() - loadTime;
    };
    loadTime = Date.now();
  } else {
    module.exports = function() {
      return new Date().getTime() - loadTime;
    };
    loadTime = new Date().getTime();
  }

}).call(this);

}).call(this,require('_process'))
},{"_process":8}],65:[function(require,module,exports){
(function (process){
// vim:ts=4:sts=4:sw=4:
/*!
 *
 * Copyright 2009-2012 Kris Kowal under the terms of the MIT
 * license found at http://github.com/kriskowal/q/raw/master/LICENSE
 *
 * With parts by Tyler Close
 * Copyright 2007-2009 Tyler Close under the terms of the MIT X license found
 * at http://www.opensource.org/licenses/mit-license.html
 * Forked at ref_send.js version: 2009-05-11
 *
 * With parts by Mark Miller
 * Copyright (C) 2011 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

(function (definition) {
    // Turn off strict mode for this function so we can assign to global.Q
    /* jshint strict: false */

    // This file will function properly as a <script> tag, or a module
    // using CommonJS and NodeJS or RequireJS module formats.  In
    // Common/Node/RequireJS, the module exports the Q API and when
    // executed as a simple <script>, it creates a Q global instead.

    // Montage Require
    if (typeof bootstrap === "function") {
        bootstrap("promise", definition);

    // CommonJS
    } else if (typeof exports === "object") {
        module.exports = definition();

    // RequireJS
    } else if (typeof define === "function" && define.amd) {
        define(definition);

    // SES (Secure EcmaScript)
    } else if (typeof ses !== "undefined") {
        if (!ses.ok()) {
            return;
        } else {
            ses.makeQ = definition;
        }

    // <script>
    } else {
        Q = definition();
    }

})(function () {
"use strict";

var hasStacks = false;
try {
    throw new Error();
} catch (e) {
    hasStacks = !!e.stack;
}

// All code after this point will be filtered from stack traces reported
// by Q.
var qStartingLine = captureLine();
var qFileName;

// shims

// used for fallback in "allResolved"
var noop = function () {};

// Use the fastest possible means to execute a task in a future turn
// of the event loop.
var nextTick =(function () {
    // linked list of tasks (single, with head node)
    var head = {task: void 0, next: null};
    var tail = head;
    var flushing = false;
    var requestTick = void 0;
    var isNodeJS = false;

    function flush() {
        /* jshint loopfunc: true */

        while (head.next) {
            head = head.next;
            var task = head.task;
            head.task = void 0;
            var domain = head.domain;

            if (domain) {
                head.domain = void 0;
                domain.enter();
            }

            try {
                task();

            } catch (e) {
                if (isNodeJS) {
                    // In node, uncaught exceptions are considered fatal errors.
                    // Re-throw them synchronously to interrupt flushing!

                    // Ensure continuation if the uncaught exception is suppressed
                    // listening "uncaughtException" events (as domains does).
                    // Continue in next event to avoid tick recursion.
                    if (domain) {
                        domain.exit();
                    }
                    setTimeout(flush, 0);
                    if (domain) {
                        domain.enter();
                    }

                    throw e;

                } else {
                    // In browsers, uncaught exceptions are not fatal.
                    // Re-throw them asynchronously to avoid slow-downs.
                    setTimeout(function() {
                       throw e;
                    }, 0);
                }
            }

            if (domain) {
                domain.exit();
            }
        }

        flushing = false;
    }

    nextTick = function (task) {
        tail = tail.next = {
            task: task,
            domain: isNodeJS && process.domain,
            next: null
        };

        if (!flushing) {
            flushing = true;
            requestTick();
        }
    };

    if (typeof process !== "undefined" && process.nextTick) {
        // Node.js before 0.9. Note that some fake-Node environments, like the
        // Mocha test runner, introduce a `process` global without a `nextTick`.
        isNodeJS = true;

        requestTick = function () {
            process.nextTick(flush);
        };

    } else if (typeof setImmediate === "function") {
        // In IE10, Node.js 0.9+, or https://github.com/NobleJS/setImmediate
        if (typeof window !== "undefined") {
            requestTick = setImmediate.bind(window, flush);
        } else {
            requestTick = function () {
                setImmediate(flush);
            };
        }

    } else if (typeof MessageChannel !== "undefined") {
        // modern browsers
        // http://www.nonblocking.io/2011/06/windownexttick.html
        var channel = new MessageChannel();
        // At least Safari Version 6.0.5 (8536.30.1) intermittently cannot create
        // working message ports the first time a page loads.
        channel.port1.onmessage = function () {
            requestTick = requestPortTick;
            channel.port1.onmessage = flush;
            flush();
        };
        var requestPortTick = function () {
            // Opera requires us to provide a message payload, regardless of
            // whether we use it.
            channel.port2.postMessage(0);
        };
        requestTick = function () {
            setTimeout(flush, 0);
            requestPortTick();
        };

    } else {
        // old browsers
        requestTick = function () {
            setTimeout(flush, 0);
        };
    }

    return nextTick;
})();

// Attempt to make generics safe in the face of downstream
// modifications.
// There is no situation where this is necessary.
// If you need a security guarantee, these primordials need to be
// deeply frozen anyway, and if you don’t need a security guarantee,
// this is just plain paranoid.
// However, this **might** have the nice side-effect of reducing the size of
// the minified code by reducing x.call() to merely x()
// See Mark Miller’s explanation of what this does.
// http://wiki.ecmascript.org/doku.php?id=conventions:safe_meta_programming
var call = Function.call;
function uncurryThis(f) {
    return function () {
        return call.apply(f, arguments);
    };
}
// This is equivalent, but slower:
// uncurryThis = Function_bind.bind(Function_bind.call);
// http://jsperf.com/uncurrythis

var array_slice = uncurryThis(Array.prototype.slice);

var array_reduce = uncurryThis(
    Array.prototype.reduce || function (callback, basis) {
        var index = 0,
            length = this.length;
        // concerning the initial value, if one is not provided
        if (arguments.length === 1) {
            // seek to the first value in the array, accounting
            // for the possibility that is is a sparse array
            do {
                if (index in this) {
                    basis = this[index++];
                    break;
                }
                if (++index >= length) {
                    throw new TypeError();
                }
            } while (1);
        }
        // reduce
        for (; index < length; index++) {
            // account for the possibility that the array is sparse
            if (index in this) {
                basis = callback(basis, this[index], index);
            }
        }
        return basis;
    }
);

var array_indexOf = uncurryThis(
    Array.prototype.indexOf || function (value) {
        // not a very good shim, but good enough for our one use of it
        for (var i = 0; i < this.length; i++) {
            if (this[i] === value) {
                return i;
            }
        }
        return -1;
    }
);

var array_map = uncurryThis(
    Array.prototype.map || function (callback, thisp) {
        var self = this;
        var collect = [];
        array_reduce(self, function (undefined, value, index) {
            collect.push(callback.call(thisp, value, index, self));
        }, void 0);
        return collect;
    }
);

var object_create = Object.create || function (prototype) {
    function Type() { }
    Type.prototype = prototype;
    return new Type();
};

var object_hasOwnProperty = uncurryThis(Object.prototype.hasOwnProperty);

var object_keys = Object.keys || function (object) {
    var keys = [];
    for (var key in object) {
        if (object_hasOwnProperty(object, key)) {
            keys.push(key);
        }
    }
    return keys;
};

var object_toString = uncurryThis(Object.prototype.toString);

function isObject(value) {
    return value === Object(value);
}

// generator related shims

// FIXME: Remove this function once ES6 generators are in SpiderMonkey.
function isStopIteration(exception) {
    return (
        object_toString(exception) === "[object StopIteration]" ||
        exception instanceof QReturnValue
    );
}

// FIXME: Remove this helper and Q.return once ES6 generators are in
// SpiderMonkey.
var QReturnValue;
if (typeof ReturnValue !== "undefined") {
    QReturnValue = ReturnValue;
} else {
    QReturnValue = function (value) {
        this.value = value;
    };
}

// long stack traces

var STACK_JUMP_SEPARATOR = "From previous event:";

function makeStackTraceLong(error, promise) {
    // If possible, transform the error stack trace by removing Node and Q
    // cruft, then concatenating with the stack trace of `promise`. See #57.
    if (hasStacks &&
        promise.stack &&
        typeof error === "object" &&
        error !== null &&
        error.stack &&
        error.stack.indexOf(STACK_JUMP_SEPARATOR) === -1
    ) {
        var stacks = [];
        for (var p = promise; !!p; p = p.source) {
            if (p.stack) {
                stacks.unshift(p.stack);
            }
        }
        stacks.unshift(error.stack);

        var concatedStacks = stacks.join("\n" + STACK_JUMP_SEPARATOR + "\n");
        error.stack = filterStackString(concatedStacks);
    }
}

function filterStackString(stackString) {
    var lines = stackString.split("\n");
    var desiredLines = [];
    for (var i = 0; i < lines.length; ++i) {
        var line = lines[i];

        if (!isInternalFrame(line) && !isNodeFrame(line) && line) {
            desiredLines.push(line);
        }
    }
    return desiredLines.join("\n");
}

function isNodeFrame(stackLine) {
    return stackLine.indexOf("(module.js:") !== -1 ||
           stackLine.indexOf("(node.js:") !== -1;
}

function getFileNameAndLineNumber(stackLine) {
    // Named functions: "at functionName (filename:lineNumber:columnNumber)"
    // In IE10 function name can have spaces ("Anonymous function") O_o
    var attempt1 = /at .+ \((.+):(\d+):(?:\d+)\)$/.exec(stackLine);
    if (attempt1) {
        return [attempt1[1], Number(attempt1[2])];
    }

    // Anonymous functions: "at filename:lineNumber:columnNumber"
    var attempt2 = /at ([^ ]+):(\d+):(?:\d+)$/.exec(stackLine);
    if (attempt2) {
        return [attempt2[1], Number(attempt2[2])];
    }

    // Firefox style: "function@filename:lineNumber or @filename:lineNumber"
    var attempt3 = /.*@(.+):(\d+)$/.exec(stackLine);
    if (attempt3) {
        return [attempt3[1], Number(attempt3[2])];
    }
}

function isInternalFrame(stackLine) {
    var fileNameAndLineNumber = getFileNameAndLineNumber(stackLine);

    if (!fileNameAndLineNumber) {
        return false;
    }

    var fileName = fileNameAndLineNumber[0];
    var lineNumber = fileNameAndLineNumber[1];

    return fileName === qFileName &&
        lineNumber >= qStartingLine &&
        lineNumber <= qEndingLine;
}

// discover own file name and line number range for filtering stack
// traces
function captureLine() {
    if (!hasStacks) {
        return;
    }

    try {
        throw new Error();
    } catch (e) {
        var lines = e.stack.split("\n");
        var firstLine = lines[0].indexOf("@") > 0 ? lines[1] : lines[2];
        var fileNameAndLineNumber = getFileNameAndLineNumber(firstLine);
        if (!fileNameAndLineNumber) {
            return;
        }

        qFileName = fileNameAndLineNumber[0];
        return fileNameAndLineNumber[1];
    }
}

function deprecate(callback, name, alternative) {
    return function () {
        if (typeof console !== "undefined" &&
            typeof console.warn === "function") {
            console.warn(name + " is deprecated, use " + alternative +
                         " instead.", new Error("").stack);
        }
        return callback.apply(callback, arguments);
    };
}

// end of shims
// beginning of real work

/**
 * Constructs a promise for an immediate reference, passes promises through, or
 * coerces promises from different systems.
 * @param value immediate reference or promise
 */
function Q(value) {
    // If the object is already a Promise, return it directly.  This enables
    // the resolve function to both be used to created references from objects,
    // but to tolerably coerce non-promises to promises.
    if (isPromise(value)) {
        return value;
    }

    // assimilate thenables
    if (isPromiseAlike(value)) {
        return coerce(value);
    } else {
        return fulfill(value);
    }
}
Q.resolve = Q;

/**
 * Performs a task in a future turn of the event loop.
 * @param {Function} task
 */
Q.nextTick = nextTick;

/**
 * Controls whether or not long stack traces will be on
 */
Q.longStackSupport = false;

/**
 * Constructs a {promise, resolve, reject} object.
 *
 * `resolve` is a callback to invoke with a more resolved value for the
 * promise. To fulfill the promise, invoke `resolve` with any value that is
 * not a thenable. To reject the promise, invoke `resolve` with a rejected
 * thenable, or invoke `reject` with the reason directly. To resolve the
 * promise to another thenable, thus putting it in the same state, invoke
 * `resolve` with that other thenable.
 */
Q.defer = defer;
function defer() {
    // if "messages" is an "Array", that indicates that the promise has not yet
    // been resolved.  If it is "undefined", it has been resolved.  Each
    // element of the messages array is itself an array of complete arguments to
    // forward to the resolved promise.  We coerce the resolution value to a
    // promise using the `resolve` function because it handles both fully
    // non-thenable values and other thenables gracefully.
    var messages = [], progressListeners = [], resolvedPromise;

    var deferred = object_create(defer.prototype);
    var promise = object_create(Promise.prototype);

    promise.promiseDispatch = function (resolve, op, operands) {
        var args = array_slice(arguments);
        if (messages) {
            messages.push(args);
            if (op === "when" && operands[1]) { // progress operand
                progressListeners.push(operands[1]);
            }
        } else {
            nextTick(function () {
                resolvedPromise.promiseDispatch.apply(resolvedPromise, args);
            });
        }
    };

    // XXX deprecated
    promise.valueOf = function () {
        if (messages) {
            return promise;
        }
        var nearerValue = nearer(resolvedPromise);
        if (isPromise(nearerValue)) {
            resolvedPromise = nearerValue; // shorten chain
        }
        return nearerValue;
    };

    promise.inspect = function () {
        if (!resolvedPromise) {
            return { state: "pending" };
        }
        return resolvedPromise.inspect();
    };

    if (Q.longStackSupport && hasStacks) {
        try {
            throw new Error();
        } catch (e) {
            // NOTE: don't try to use `Error.captureStackTrace` or transfer the
            // accessor around; that causes memory leaks as per GH-111. Just
            // reify the stack trace as a string ASAP.
            //
            // At the same time, cut off the first line; it's always just
            // "[object Promise]\n", as per the `toString`.
            promise.stack = e.stack.substring(e.stack.indexOf("\n") + 1);
        }
    }

    // NOTE: we do the checks for `resolvedPromise` in each method, instead of
    // consolidating them into `become`, since otherwise we'd create new
    // promises with the lines `become(whatever(value))`. See e.g. GH-252.

    function become(newPromise) {
        resolvedPromise = newPromise;
        promise.source = newPromise;

        array_reduce(messages, function (undefined, message) {
            nextTick(function () {
                newPromise.promiseDispatch.apply(newPromise, message);
            });
        }, void 0);

        messages = void 0;
        progressListeners = void 0;
    }

    deferred.promise = promise;
    deferred.resolve = function (value) {
        if (resolvedPromise) {
            return;
        }

        become(Q(value));
    };

    deferred.fulfill = function (value) {
        if (resolvedPromise) {
            return;
        }

        become(fulfill(value));
    };
    deferred.reject = function (reason) {
        if (resolvedPromise) {
            return;
        }

        become(reject(reason));
    };
    deferred.notify = function (progress) {
        if (resolvedPromise) {
            return;
        }

        array_reduce(progressListeners, function (undefined, progressListener) {
            nextTick(function () {
                progressListener(progress);
            });
        }, void 0);
    };

    return deferred;
}

/**
 * Creates a Node-style callback that will resolve or reject the deferred
 * promise.
 * @returns a nodeback
 */
defer.prototype.makeNodeResolver = function () {
    var self = this;
    return function (error, value) {
        if (error) {
            self.reject(error);
        } else if (arguments.length > 2) {
            self.resolve(array_slice(arguments, 1));
        } else {
            self.resolve(value);
        }
    };
};

/**
 * @param resolver {Function} a function that returns nothing and accepts
 * the resolve, reject, and notify functions for a deferred.
 * @returns a promise that may be resolved with the given resolve and reject
 * functions, or rejected by a thrown exception in resolver
 */
Q.Promise = promise; // ES6
Q.promise = promise;
function promise(resolver) {
    if (typeof resolver !== "function") {
        throw new TypeError("resolver must be a function.");
    }
    var deferred = defer();
    try {
        resolver(deferred.resolve, deferred.reject, deferred.notify);
    } catch (reason) {
        deferred.reject(reason);
    }
    return deferred.promise;
}

promise.race = race; // ES6
promise.all = all; // ES6
promise.reject = reject; // ES6
promise.resolve = Q; // ES6

// XXX experimental.  This method is a way to denote that a local value is
// serializable and should be immediately dispatched to a remote upon request,
// instead of passing a reference.
Q.passByCopy = function (object) {
    //freeze(object);
    //passByCopies.set(object, true);
    return object;
};

Promise.prototype.passByCopy = function () {
    //freeze(object);
    //passByCopies.set(object, true);
    return this;
};

/**
 * If two promises eventually fulfill to the same value, promises that value,
 * but otherwise rejects.
 * @param x {Any*}
 * @param y {Any*}
 * @returns {Any*} a promise for x and y if they are the same, but a rejection
 * otherwise.
 *
 */
Q.join = function (x, y) {
    return Q(x).join(y);
};

Promise.prototype.join = function (that) {
    return Q([this, that]).spread(function (x, y) {
        if (x === y) {
            // TODO: "===" should be Object.is or equiv
            return x;
        } else {
            throw new Error("Can't join: not the same: " + x + " " + y);
        }
    });
};

/**
 * Returns a promise for the first of an array of promises to become fulfilled.
 * @param answers {Array[Any*]} promises to race
 * @returns {Any*} the first promise to be fulfilled
 */
Q.race = race;
function race(answerPs) {
    return promise(function(resolve, reject) {
        // Switch to this once we can assume at least ES5
        // answerPs.forEach(function(answerP) {
        //     Q(answerP).then(resolve, reject);
        // });
        // Use this in the meantime
        for (var i = 0, len = answerPs.length; i < len; i++) {
            Q(answerPs[i]).then(resolve, reject);
        }
    });
}

Promise.prototype.race = function () {
    return this.then(Q.race);
};

/**
 * Constructs a Promise with a promise descriptor object and optional fallback
 * function.  The descriptor contains methods like when(rejected), get(name),
 * set(name, value), post(name, args), and delete(name), which all
 * return either a value, a promise for a value, or a rejection.  The fallback
 * accepts the operation name, a resolver, and any further arguments that would
 * have been forwarded to the appropriate method above had a method been
 * provided with the proper name.  The API makes no guarantees about the nature
 * of the returned object, apart from that it is usable whereever promises are
 * bought and sold.
 */
Q.makePromise = Promise;
function Promise(descriptor, fallback, inspect) {
    if (fallback === void 0) {
        fallback = function (op) {
            return reject(new Error(
                "Promise does not support operation: " + op
            ));
        };
    }
    if (inspect === void 0) {
        inspect = function () {
            return {state: "unknown"};
        };
    }

    var promise = object_create(Promise.prototype);

    promise.promiseDispatch = function (resolve, op, args) {
        var result;
        try {
            if (descriptor[op]) {
                result = descriptor[op].apply(promise, args);
            } else {
                result = fallback.call(promise, op, args);
            }
        } catch (exception) {
            result = reject(exception);
        }
        if (resolve) {
            resolve(result);
        }
    };

    promise.inspect = inspect;

    // XXX deprecated `valueOf` and `exception` support
    if (inspect) {
        var inspected = inspect();
        if (inspected.state === "rejected") {
            promise.exception = inspected.reason;
        }

        promise.valueOf = function () {
            var inspected = inspect();
            if (inspected.state === "pending" ||
                inspected.state === "rejected") {
                return promise;
            }
            return inspected.value;
        };
    }

    return promise;
}

Promise.prototype.toString = function () {
    return "[object Promise]";
};

Promise.prototype.then = function (fulfilled, rejected, progressed) {
    var self = this;
    var deferred = defer();
    var done = false;   // ensure the untrusted promise makes at most a
                        // single call to one of the callbacks

    function _fulfilled(value) {
        try {
            return typeof fulfilled === "function" ? fulfilled(value) : value;
        } catch (exception) {
            return reject(exception);
        }
    }

    function _rejected(exception) {
        if (typeof rejected === "function") {
            makeStackTraceLong(exception, self);
            try {
                return rejected(exception);
            } catch (newException) {
                return reject(newException);
            }
        }
        return reject(exception);
    }

    function _progressed(value) {
        return typeof progressed === "function" ? progressed(value) : value;
    }

    nextTick(function () {
        self.promiseDispatch(function (value) {
            if (done) {
                return;
            }
            done = true;

            deferred.resolve(_fulfilled(value));
        }, "when", [function (exception) {
            if (done) {
                return;
            }
            done = true;

            deferred.resolve(_rejected(exception));
        }]);
    });

    // Progress propagator need to be attached in the current tick.
    self.promiseDispatch(void 0, "when", [void 0, function (value) {
        var newValue;
        var threw = false;
        try {
            newValue = _progressed(value);
        } catch (e) {
            threw = true;
            if (Q.onerror) {
                Q.onerror(e);
            } else {
                throw e;
            }
        }

        if (!threw) {
            deferred.notify(newValue);
        }
    }]);

    return deferred.promise;
};

/**
 * Registers an observer on a promise.
 *
 * Guarantees:
 *
 * 1. that fulfilled and rejected will be called only once.
 * 2. that either the fulfilled callback or the rejected callback will be
 *    called, but not both.
 * 3. that fulfilled and rejected will not be called in this turn.
 *
 * @param value      promise or immediate reference to observe
 * @param fulfilled  function to be called with the fulfilled value
 * @param rejected   function to be called with the rejection exception
 * @param progressed function to be called on any progress notifications
 * @return promise for the return value from the invoked callback
 */
Q.when = when;
function when(value, fulfilled, rejected, progressed) {
    return Q(value).then(fulfilled, rejected, progressed);
}

Promise.prototype.thenResolve = function (value) {
    return this.then(function () { return value; });
};

Q.thenResolve = function (promise, value) {
    return Q(promise).thenResolve(value);
};

Promise.prototype.thenReject = function (reason) {
    return this.then(function () { throw reason; });
};

Q.thenReject = function (promise, reason) {
    return Q(promise).thenReject(reason);
};

/**
 * If an object is not a promise, it is as "near" as possible.
 * If a promise is rejected, it is as "near" as possible too.
 * If it’s a fulfilled promise, the fulfillment value is nearer.
 * If it’s a deferred promise and the deferred has been resolved, the
 * resolution is "nearer".
 * @param object
 * @returns most resolved (nearest) form of the object
 */

// XXX should we re-do this?
Q.nearer = nearer;
function nearer(value) {
    if (isPromise(value)) {
        var inspected = value.inspect();
        if (inspected.state === "fulfilled") {
            return inspected.value;
        }
    }
    return value;
}

/**
 * @returns whether the given object is a promise.
 * Otherwise it is a fulfilled value.
 */
Q.isPromise = isPromise;
function isPromise(object) {
    return isObject(object) &&
        typeof object.promiseDispatch === "function" &&
        typeof object.inspect === "function";
}

Q.isPromiseAlike = isPromiseAlike;
function isPromiseAlike(object) {
    return isObject(object) && typeof object.then === "function";
}

/**
 * @returns whether the given object is a pending promise, meaning not
 * fulfilled or rejected.
 */
Q.isPending = isPending;
function isPending(object) {
    return isPromise(object) && object.inspect().state === "pending";
}

Promise.prototype.isPending = function () {
    return this.inspect().state === "pending";
};

/**
 * @returns whether the given object is a value or fulfilled
 * promise.
 */
Q.isFulfilled = isFulfilled;
function isFulfilled(object) {
    return !isPromise(object) || object.inspect().state === "fulfilled";
}

Promise.prototype.isFulfilled = function () {
    return this.inspect().state === "fulfilled";
};

/**
 * @returns whether the given object is a rejected promise.
 */
Q.isRejected = isRejected;
function isRejected(object) {
    return isPromise(object) && object.inspect().state === "rejected";
}

Promise.prototype.isRejected = function () {
    return this.inspect().state === "rejected";
};

//// BEGIN UNHANDLED REJECTION TRACKING

// This promise library consumes exceptions thrown in handlers so they can be
// handled by a subsequent promise.  The exceptions get added to this array when
// they are created, and removed when they are handled.  Note that in ES6 or
// shimmed environments, this would naturally be a `Set`.
var unhandledReasons = [];
var unhandledRejections = [];
var trackUnhandledRejections = true;

function resetUnhandledRejections() {
    unhandledReasons.length = 0;
    unhandledRejections.length = 0;

    if (!trackUnhandledRejections) {
        trackUnhandledRejections = true;
    }
}

function trackRejection(promise, reason) {
    if (!trackUnhandledRejections) {
        return;
    }

    unhandledRejections.push(promise);
    if (reason && typeof reason.stack !== "undefined") {
        unhandledReasons.push(reason.stack);
    } else {
        unhandledReasons.push("(no stack) " + reason);
    }
}

function untrackRejection(promise) {
    if (!trackUnhandledRejections) {
        return;
    }

    var at = array_indexOf(unhandledRejections, promise);
    if (at !== -1) {
        unhandledRejections.splice(at, 1);
        unhandledReasons.splice(at, 1);
    }
}

Q.resetUnhandledRejections = resetUnhandledRejections;

Q.getUnhandledReasons = function () {
    // Make a copy so that consumers can't interfere with our internal state.
    return unhandledReasons.slice();
};

Q.stopUnhandledRejectionTracking = function () {
    resetUnhandledRejections();
    trackUnhandledRejections = false;
};

resetUnhandledRejections();

//// END UNHANDLED REJECTION TRACKING

/**
 * Constructs a rejected promise.
 * @param reason value describing the failure
 */
Q.reject = reject;
function reject(reason) {
    var rejection = Promise({
        "when": function (rejected) {
            // note that the error has been handled
            if (rejected) {
                untrackRejection(this);
            }
            return rejected ? rejected(reason) : this;
        }
    }, function fallback() {
        return this;
    }, function inspect() {
        return { state: "rejected", reason: reason };
    });

    // Note that the reason has not been handled.
    trackRejection(rejection, reason);

    return rejection;
}

/**
 * Constructs a fulfilled promise for an immediate reference.
 * @param value immediate reference
 */
Q.fulfill = fulfill;
function fulfill(value) {
    return Promise({
        "when": function () {
            return value;
        },
        "get": function (name) {
            return value[name];
        },
        "set": function (name, rhs) {
            value[name] = rhs;
        },
        "delete": function (name) {
            delete value[name];
        },
        "post": function (name, args) {
            // Mark Miller proposes that post with no name should apply a
            // promised function.
            if (name === null || name === void 0) {
                return value.apply(void 0, args);
            } else {
                return value[name].apply(value, args);
            }
        },
        "apply": function (thisp, args) {
            return value.apply(thisp, args);
        },
        "keys": function () {
            return object_keys(value);
        }
    }, void 0, function inspect() {
        return { state: "fulfilled", value: value };
    });
}

/**
 * Converts thenables to Q promises.
 * @param promise thenable promise
 * @returns a Q promise
 */
function coerce(promise) {
    var deferred = defer();
    nextTick(function () {
        try {
            promise.then(deferred.resolve, deferred.reject, deferred.notify);
        } catch (exception) {
            deferred.reject(exception);
        }
    });
    return deferred.promise;
}

/**
 * Annotates an object such that it will never be
 * transferred away from this process over any promise
 * communication channel.
 * @param object
 * @returns promise a wrapping of that object that
 * additionally responds to the "isDef" message
 * without a rejection.
 */
Q.master = master;
function master(object) {
    return Promise({
        "isDef": function () {}
    }, function fallback(op, args) {
        return dispatch(object, op, args);
    }, function () {
        return Q(object).inspect();
    });
}

/**
 * Spreads the values of a promised array of arguments into the
 * fulfillment callback.
 * @param fulfilled callback that receives variadic arguments from the
 * promised array
 * @param rejected callback that receives the exception if the promise
 * is rejected.
 * @returns a promise for the return value or thrown exception of
 * either callback.
 */
Q.spread = spread;
function spread(value, fulfilled, rejected) {
    return Q(value).spread(fulfilled, rejected);
}

Promise.prototype.spread = function (fulfilled, rejected) {
    return this.all().then(function (array) {
        return fulfilled.apply(void 0, array);
    }, rejected);
};

/**
 * The async function is a decorator for generator functions, turning
 * them into asynchronous generators.  Although generators are only part
 * of the newest ECMAScript 6 drafts, this code does not cause syntax
 * errors in older engines.  This code should continue to work and will
 * in fact improve over time as the language improves.
 *
 * ES6 generators are currently part of V8 version 3.19 with the
 * --harmony-generators runtime flag enabled.  SpiderMonkey has had them
 * for longer, but under an older Python-inspired form.  This function
 * works on both kinds of generators.
 *
 * Decorates a generator function such that:
 *  - it may yield promises
 *  - execution will continue when that promise is fulfilled
 *  - the value of the yield expression will be the fulfilled value
 *  - it returns a promise for the return value (when the generator
 *    stops iterating)
 *  - the decorated function returns a promise for the return value
 *    of the generator or the first rejected promise among those
 *    yielded.
 *  - if an error is thrown in the generator, it propagates through
 *    every following yield until it is caught, or until it escapes
 *    the generator function altogether, and is translated into a
 *    rejection for the promise returned by the decorated generator.
 */
Q.async = async;
function async(makeGenerator) {
    return function () {
        // when verb is "send", arg is a value
        // when verb is "throw", arg is an exception
        function continuer(verb, arg) {
            var result;

            // Until V8 3.19 / Chromium 29 is released, SpiderMonkey is the only
            // engine that has a deployed base of browsers that support generators.
            // However, SM's generators use the Python-inspired semantics of
            // outdated ES6 drafts.  We would like to support ES6, but we'd also
            // like to make it possible to use generators in deployed browsers, so
            // we also support Python-style generators.  At some point we can remove
            // this block.

            if (typeof StopIteration === "undefined") {
                // ES6 Generators
                try {
                    result = generator[verb](arg);
                } catch (exception) {
                    return reject(exception);
                }
                if (result.done) {
                    return result.value;
                } else {
                    return when(result.value, callback, errback);
                }
            } else {
                // SpiderMonkey Generators
                // FIXME: Remove this case when SM does ES6 generators.
                try {
                    result = generator[verb](arg);
                } catch (exception) {
                    if (isStopIteration(exception)) {
                        return exception.value;
                    } else {
                        return reject(exception);
                    }
                }
                return when(result, callback, errback);
            }
        }
        var generator = makeGenerator.apply(this, arguments);
        var callback = continuer.bind(continuer, "next");
        var errback = continuer.bind(continuer, "throw");
        return callback();
    };
}

/**
 * The spawn function is a small wrapper around async that immediately
 * calls the generator and also ends the promise chain, so that any
 * unhandled errors are thrown instead of forwarded to the error
 * handler. This is useful because it's extremely common to run
 * generators at the top-level to work with libraries.
 */
Q.spawn = spawn;
function spawn(makeGenerator) {
    Q.done(Q.async(makeGenerator)());
}

// FIXME: Remove this interface once ES6 generators are in SpiderMonkey.
/**
 * Throws a ReturnValue exception to stop an asynchronous generator.
 *
 * This interface is a stop-gap measure to support generator return
 * values in older Firefox/SpiderMonkey.  In browsers that support ES6
 * generators like Chromium 29, just use "return" in your generator
 * functions.
 *
 * @param value the return value for the surrounding generator
 * @throws ReturnValue exception with the value.
 * @example
 * // ES6 style
 * Q.async(function* () {
 *      var foo = yield getFooPromise();
 *      var bar = yield getBarPromise();
 *      return foo + bar;
 * })
 * // Older SpiderMonkey style
 * Q.async(function () {
 *      var foo = yield getFooPromise();
 *      var bar = yield getBarPromise();
 *      Q.return(foo + bar);
 * })
 */
Q["return"] = _return;
function _return(value) {
    throw new QReturnValue(value);
}

/**
 * The promised function decorator ensures that any promise arguments
 * are settled and passed as values (`this` is also settled and passed
 * as a value).  It will also ensure that the result of a function is
 * always a promise.
 *
 * @example
 * var add = Q.promised(function (a, b) {
 *     return a + b;
 * });
 * add(Q(a), Q(B));
 *
 * @param {function} callback The function to decorate
 * @returns {function} a function that has been decorated.
 */
Q.promised = promised;
function promised(callback) {
    return function () {
        return spread([this, all(arguments)], function (self, args) {
            return callback.apply(self, args);
        });
    };
}

/**
 * sends a message to a value in a future turn
 * @param object* the recipient
 * @param op the name of the message operation, e.g., "when",
 * @param args further arguments to be forwarded to the operation
 * @returns result {Promise} a promise for the result of the operation
 */
Q.dispatch = dispatch;
function dispatch(object, op, args) {
    return Q(object).dispatch(op, args);
}

Promise.prototype.dispatch = function (op, args) {
    var self = this;
    var deferred = defer();
    nextTick(function () {
        self.promiseDispatch(deferred.resolve, op, args);
    });
    return deferred.promise;
};

/**
 * Gets the value of a property in a future turn.
 * @param object    promise or immediate reference for target object
 * @param name      name of property to get
 * @return promise for the property value
 */
Q.get = function (object, key) {
    return Q(object).dispatch("get", [key]);
};

Promise.prototype.get = function (key) {
    return this.dispatch("get", [key]);
};

/**
 * Sets the value of a property in a future turn.
 * @param object    promise or immediate reference for object object
 * @param name      name of property to set
 * @param value     new value of property
 * @return promise for the return value
 */
Q.set = function (object, key, value) {
    return Q(object).dispatch("set", [key, value]);
};

Promise.prototype.set = function (key, value) {
    return this.dispatch("set", [key, value]);
};

/**
 * Deletes a property in a future turn.
 * @param object    promise or immediate reference for target object
 * @param name      name of property to delete
 * @return promise for the return value
 */
Q.del = // XXX legacy
Q["delete"] = function (object, key) {
    return Q(object).dispatch("delete", [key]);
};

Promise.prototype.del = // XXX legacy
Promise.prototype["delete"] = function (key) {
    return this.dispatch("delete", [key]);
};

/**
 * Invokes a method in a future turn.
 * @param object    promise or immediate reference for target object
 * @param name      name of method to invoke
 * @param value     a value to post, typically an array of
 *                  invocation arguments for promises that
 *                  are ultimately backed with `resolve` values,
 *                  as opposed to those backed with URLs
 *                  wherein the posted value can be any
 *                  JSON serializable object.
 * @return promise for the return value
 */
// bound locally because it is used by other methods
Q.mapply = // XXX As proposed by "Redsandro"
Q.post = function (object, name, args) {
    return Q(object).dispatch("post", [name, args]);
};

Promise.prototype.mapply = // XXX As proposed by "Redsandro"
Promise.prototype.post = function (name, args) {
    return this.dispatch("post", [name, args]);
};

/**
 * Invokes a method in a future turn.
 * @param object    promise or immediate reference for target object
 * @param name      name of method to invoke
 * @param ...args   array of invocation arguments
 * @return promise for the return value
 */
Q.send = // XXX Mark Miller's proposed parlance
Q.mcall = // XXX As proposed by "Redsandro"
Q.invoke = function (object, name /*...args*/) {
    return Q(object).dispatch("post", [name, array_slice(arguments, 2)]);
};

Promise.prototype.send = // XXX Mark Miller's proposed parlance
Promise.prototype.mcall = // XXX As proposed by "Redsandro"
Promise.prototype.invoke = function (name /*...args*/) {
    return this.dispatch("post", [name, array_slice(arguments, 1)]);
};

/**
 * Applies the promised function in a future turn.
 * @param object    promise or immediate reference for target function
 * @param args      array of application arguments
 */
Q.fapply = function (object, args) {
    return Q(object).dispatch("apply", [void 0, args]);
};

Promise.prototype.fapply = function (args) {
    return this.dispatch("apply", [void 0, args]);
};

/**
 * Calls the promised function in a future turn.
 * @param object    promise or immediate reference for target function
 * @param ...args   array of application arguments
 */
Q["try"] =
Q.fcall = function (object /* ...args*/) {
    return Q(object).dispatch("apply", [void 0, array_slice(arguments, 1)]);
};

Promise.prototype.fcall = function (/*...args*/) {
    return this.dispatch("apply", [void 0, array_slice(arguments)]);
};

/**
 * Binds the promised function, transforming return values into a fulfilled
 * promise and thrown errors into a rejected one.
 * @param object    promise or immediate reference for target function
 * @param ...args   array of application arguments
 */
Q.fbind = function (object /*...args*/) {
    var promise = Q(object);
    var args = array_slice(arguments, 1);
    return function fbound() {
        return promise.dispatch("apply", [
            this,
            args.concat(array_slice(arguments))
        ]);
    };
};
Promise.prototype.fbind = function (/*...args*/) {
    var promise = this;
    var args = array_slice(arguments);
    return function fbound() {
        return promise.dispatch("apply", [
            this,
            args.concat(array_slice(arguments))
        ]);
    };
};

/**
 * Requests the names of the owned properties of a promised
 * object in a future turn.
 * @param object    promise or immediate reference for target object
 * @return promise for the keys of the eventually settled object
 */
Q.keys = function (object) {
    return Q(object).dispatch("keys", []);
};

Promise.prototype.keys = function () {
    return this.dispatch("keys", []);
};

/**
 * Turns an array of promises into a promise for an array.  If any of
 * the promises gets rejected, the whole array is rejected immediately.
 * @param {Array*} an array (or promise for an array) of values (or
 * promises for values)
 * @returns a promise for an array of the corresponding values
 */
// By Mark Miller
// http://wiki.ecmascript.org/doku.php?id=strawman:concurrency&rev=1308776521#allfulfilled
Q.all = all;
function all(promises) {
    return when(promises, function (promises) {
        var countDown = 0;
        var deferred = defer();
        array_reduce(promises, function (undefined, promise, index) {
            var snapshot;
            if (
                isPromise(promise) &&
                (snapshot = promise.inspect()).state === "fulfilled"
            ) {
                promises[index] = snapshot.value;
            } else {
                ++countDown;
                when(
                    promise,
                    function (value) {
                        promises[index] = value;
                        if (--countDown === 0) {
                            deferred.resolve(promises);
                        }
                    },
                    deferred.reject,
                    function (progress) {
                        deferred.notify({ index: index, value: progress });
                    }
                );
            }
        }, void 0);
        if (countDown === 0) {
            deferred.resolve(promises);
        }
        return deferred.promise;
    });
}

Promise.prototype.all = function () {
    return all(this);
};

/**
 * Waits for all promises to be settled, either fulfilled or
 * rejected.  This is distinct from `all` since that would stop
 * waiting at the first rejection.  The promise returned by
 * `allResolved` will never be rejected.
 * @param promises a promise for an array (or an array) of promises
 * (or values)
 * @return a promise for an array of promises
 */
Q.allResolved = deprecate(allResolved, "allResolved", "allSettled");
function allResolved(promises) {
    return when(promises, function (promises) {
        promises = array_map(promises, Q);
        return when(all(array_map(promises, function (promise) {
            return when(promise, noop, noop);
        })), function () {
            return promises;
        });
    });
}

Promise.prototype.allResolved = function () {
    return allResolved(this);
};

/**
 * @see Promise#allSettled
 */
Q.allSettled = allSettled;
function allSettled(promises) {
    return Q(promises).allSettled();
}

/**
 * Turns an array of promises into a promise for an array of their states (as
 * returned by `inspect`) when they have all settled.
 * @param {Array[Any*]} values an array (or promise for an array) of values (or
 * promises for values)
 * @returns {Array[State]} an array of states for the respective values.
 */
Promise.prototype.allSettled = function () {
    return this.then(function (promises) {
        return all(array_map(promises, function (promise) {
            promise = Q(promise);
            function regardless() {
                return promise.inspect();
            }
            return promise.then(regardless, regardless);
        }));
    });
};

/**
 * Captures the failure of a promise, giving an oportunity to recover
 * with a callback.  If the given promise is fulfilled, the returned
 * promise is fulfilled.
 * @param {Any*} promise for something
 * @param {Function} callback to fulfill the returned promise if the
 * given promise is rejected
 * @returns a promise for the return value of the callback
 */
Q.fail = // XXX legacy
Q["catch"] = function (object, rejected) {
    return Q(object).then(void 0, rejected);
};

Promise.prototype.fail = // XXX legacy
Promise.prototype["catch"] = function (rejected) {
    return this.then(void 0, rejected);
};

/**
 * Attaches a listener that can respond to progress notifications from a
 * promise's originating deferred. This listener receives the exact arguments
 * passed to ``deferred.notify``.
 * @param {Any*} promise for something
 * @param {Function} callback to receive any progress notifications
 * @returns the given promise, unchanged
 */
Q.progress = progress;
function progress(object, progressed) {
    return Q(object).then(void 0, void 0, progressed);
}

Promise.prototype.progress = function (progressed) {
    return this.then(void 0, void 0, progressed);
};

/**
 * Provides an opportunity to observe the settling of a promise,
 * regardless of whether the promise is fulfilled or rejected.  Forwards
 * the resolution to the returned promise when the callback is done.
 * The callback can return a promise to defer completion.
 * @param {Any*} promise
 * @param {Function} callback to observe the resolution of the given
 * promise, takes no arguments.
 * @returns a promise for the resolution of the given promise when
 * ``fin`` is done.
 */
Q.fin = // XXX legacy
Q["finally"] = function (object, callback) {
    return Q(object)["finally"](callback);
};

Promise.prototype.fin = // XXX legacy
Promise.prototype["finally"] = function (callback) {
    callback = Q(callback);
    return this.then(function (value) {
        return callback.fcall().then(function () {
            return value;
        });
    }, function (reason) {
        // TODO attempt to recycle the rejection with "this".
        return callback.fcall().then(function () {
            throw reason;
        });
    });
};

/**
 * Terminates a chain of promises, forcing rejections to be
 * thrown as exceptions.
 * @param {Any*} promise at the end of a chain of promises
 * @returns nothing
 */
Q.done = function (object, fulfilled, rejected, progress) {
    return Q(object).done(fulfilled, rejected, progress);
};

Promise.prototype.done = function (fulfilled, rejected, progress) {
    var onUnhandledError = function (error) {
        // forward to a future turn so that ``when``
        // does not catch it and turn it into a rejection.
        nextTick(function () {
            makeStackTraceLong(error, promise);
            if (Q.onerror) {
                Q.onerror(error);
            } else {
                throw error;
            }
        });
    };

    // Avoid unnecessary `nextTick`ing via an unnecessary `when`.
    var promise = fulfilled || rejected || progress ?
        this.then(fulfilled, rejected, progress) :
        this;

    if (typeof process === "object" && process && process.domain) {
        onUnhandledError = process.domain.bind(onUnhandledError);
    }

    promise.then(void 0, onUnhandledError);
};

/**
 * Causes a promise to be rejected if it does not get fulfilled before
 * some milliseconds time out.
 * @param {Any*} promise
 * @param {Number} milliseconds timeout
 * @param {String} custom error message (optional)
 * @returns a promise for the resolution of the given promise if it is
 * fulfilled before the timeout, otherwise rejected.
 */
Q.timeout = function (object, ms, message) {
    return Q(object).timeout(ms, message);
};

Promise.prototype.timeout = function (ms, message) {
    var deferred = defer();
    var timeoutId = setTimeout(function () {
        deferred.reject(new Error(message || "Timed out after " + ms + " ms"));
    }, ms);

    this.then(function (value) {
        clearTimeout(timeoutId);
        deferred.resolve(value);
    }, function (exception) {
        clearTimeout(timeoutId);
        deferred.reject(exception);
    }, deferred.notify);

    return deferred.promise;
};

/**
 * Returns a promise for the given value (or promised value), some
 * milliseconds after it resolved. Passes rejections immediately.
 * @param {Any*} promise
 * @param {Number} milliseconds
 * @returns a promise for the resolution of the given promise after milliseconds
 * time has elapsed since the resolution of the given promise.
 * If the given promise rejects, that is passed immediately.
 */
Q.delay = function (object, timeout) {
    if (timeout === void 0) {
        timeout = object;
        object = void 0;
    }
    return Q(object).delay(timeout);
};

Promise.prototype.delay = function (timeout) {
    return this.then(function (value) {
        var deferred = defer();
        setTimeout(function () {
            deferred.resolve(value);
        }, timeout);
        return deferred.promise;
    });
};

/**
 * Passes a continuation to a Node function, which is called with the given
 * arguments provided as an array, and returns a promise.
 *
 *      Q.nfapply(FS.readFile, [__filename])
 *      .then(function (content) {
 *      })
 *
 */
Q.nfapply = function (callback, args) {
    return Q(callback).nfapply(args);
};

Promise.prototype.nfapply = function (args) {
    var deferred = defer();
    var nodeArgs = array_slice(args);
    nodeArgs.push(deferred.makeNodeResolver());
    this.fapply(nodeArgs).fail(deferred.reject);
    return deferred.promise;
};

/**
 * Passes a continuation to a Node function, which is called with the given
 * arguments provided individually, and returns a promise.
 * @example
 * Q.nfcall(FS.readFile, __filename)
 * .then(function (content) {
 * })
 *
 */
Q.nfcall = function (callback /*...args*/) {
    var args = array_slice(arguments, 1);
    return Q(callback).nfapply(args);
};

Promise.prototype.nfcall = function (/*...args*/) {
    var nodeArgs = array_slice(arguments);
    var deferred = defer();
    nodeArgs.push(deferred.makeNodeResolver());
    this.fapply(nodeArgs).fail(deferred.reject);
    return deferred.promise;
};

/**
 * Wraps a NodeJS continuation passing function and returns an equivalent
 * version that returns a promise.
 * @example
 * Q.nfbind(FS.readFile, __filename)("utf-8")
 * .then(console.log)
 * .done()
 */
Q.nfbind =
Q.denodeify = function (callback /*...args*/) {
    var baseArgs = array_slice(arguments, 1);
    return function () {
        var nodeArgs = baseArgs.concat(array_slice(arguments));
        var deferred = defer();
        nodeArgs.push(deferred.makeNodeResolver());
        Q(callback).fapply(nodeArgs).fail(deferred.reject);
        return deferred.promise;
    };
};

Promise.prototype.nfbind =
Promise.prototype.denodeify = function (/*...args*/) {
    var args = array_slice(arguments);
    args.unshift(this);
    return Q.denodeify.apply(void 0, args);
};

Q.nbind = function (callback, thisp /*...args*/) {
    var baseArgs = array_slice(arguments, 2);
    return function () {
        var nodeArgs = baseArgs.concat(array_slice(arguments));
        var deferred = defer();
        nodeArgs.push(deferred.makeNodeResolver());
        function bound() {
            return callback.apply(thisp, arguments);
        }
        Q(bound).fapply(nodeArgs).fail(deferred.reject);
        return deferred.promise;
    };
};

Promise.prototype.nbind = function (/*thisp, ...args*/) {
    var args = array_slice(arguments, 0);
    args.unshift(this);
    return Q.nbind.apply(void 0, args);
};

/**
 * Calls a method of a Node-style object that accepts a Node-style
 * callback with a given array of arguments, plus a provided callback.
 * @param object an object that has the named method
 * @param {String} name name of the method of object
 * @param {Array} args arguments to pass to the method; the callback
 * will be provided by Q and appended to these arguments.
 * @returns a promise for the value or error
 */
Q.nmapply = // XXX As proposed by "Redsandro"
Q.npost = function (object, name, args) {
    return Q(object).npost(name, args);
};

Promise.prototype.nmapply = // XXX As proposed by "Redsandro"
Promise.prototype.npost = function (name, args) {
    var nodeArgs = array_slice(args || []);
    var deferred = defer();
    nodeArgs.push(deferred.makeNodeResolver());
    this.dispatch("post", [name, nodeArgs]).fail(deferred.reject);
    return deferred.promise;
};

/**
 * Calls a method of a Node-style object that accepts a Node-style
 * callback, forwarding the given variadic arguments, plus a provided
 * callback argument.
 * @param object an object that has the named method
 * @param {String} name name of the method of object
 * @param ...args arguments to pass to the method; the callback will
 * be provided by Q and appended to these arguments.
 * @returns a promise for the value or error
 */
Q.nsend = // XXX Based on Mark Miller's proposed "send"
Q.nmcall = // XXX Based on "Redsandro's" proposal
Q.ninvoke = function (object, name /*...args*/) {
    var nodeArgs = array_slice(arguments, 2);
    var deferred = defer();
    nodeArgs.push(deferred.makeNodeResolver());
    Q(object).dispatch("post", [name, nodeArgs]).fail(deferred.reject);
    return deferred.promise;
};

Promise.prototype.nsend = // XXX Based on Mark Miller's proposed "send"
Promise.prototype.nmcall = // XXX Based on "Redsandro's" proposal
Promise.prototype.ninvoke = function (name /*...args*/) {
    var nodeArgs = array_slice(arguments, 1);
    var deferred = defer();
    nodeArgs.push(deferred.makeNodeResolver());
    this.dispatch("post", [name, nodeArgs]).fail(deferred.reject);
    return deferred.promise;
};

/**
 * If a function would like to support both Node continuation-passing-style and
 * promise-returning-style, it can end its internal promise chain with
 * `nodeify(nodeback)`, forwarding the optional nodeback argument.  If the user
 * elects to use a nodeback, the result will be sent there.  If they do not
 * pass a nodeback, they will receive the result promise.
 * @param object a result (or a promise for a result)
 * @param {Function} nodeback a Node.js-style callback
 * @returns either the promise or nothing
 */
Q.nodeify = nodeify;
function nodeify(object, nodeback) {
    return Q(object).nodeify(nodeback);
}

Promise.prototype.nodeify = function (nodeback) {
    if (nodeback) {
        this.then(function (value) {
            nextTick(function () {
                nodeback(null, value);
            });
        }, function (error) {
            nextTick(function () {
                nodeback(error);
            });
        });
    } else {
        return this;
    }
};

// All code before this point will be filtered from stack traces.
var qEndingLine = captureLine();

return Q;

});

}).call(this,require('_process'))
},{"_process":8}],66:[function(require,module,exports){
/*
 * Qimage - Simple Promise Image Loader based on Q
 */
(function (definition) {
    if (typeof exports === "object") {
        module.exports = definition(require("q"));
    } else {
        window.Qimage = definition(window.Q);
    }
})(function (Q) {

  // QImage
  // ===
  // *Creates an Image Loader.*
  //
  // Parameters
  // ---
  // `url` **(string)**: load an Image with its URL
  // `options` **(object)**: configuration object
  //
  // Result
  // ---
  // Returns a **(Promise of Image)**
  //
  var Qimage = function (url, options) {
    options = options || {};
    if (!Qimage.Image) {
      throw new Error("You must define Qimage.Image if not in window context.");
    }
    var img = new Qimage.Image();
    if (options.crossOrigin) {
      img.crossOrigin = options.crossOrigin;
    }
    var d = Q.defer();
    img.onload = function () {
      d.resolve(img);
    };
    img.onabort = function (e) {
      d.reject(e);
    };
    img.onerror = function (e) {
      d.reject(e);
    };
    img.src = url;
    return d.promise;
  };

  if (typeof window !== "undefined") {
    Qimage.Image = window.Image;
  }

  Qimage.anonymously = function (url) {
    return Qimage(url, { crossOrigin: "Anonymous" });
  };

  return Qimage;

});



},{"q":65}],67:[function(require,module,exports){
var now = require('performance-now')
  , global = typeof window === 'undefined' ? {} : window
  , vendors = ['moz', 'webkit']
  , suffix = 'AnimationFrame'
  , raf = global['request' + suffix]
  , caf = global['cancel' + suffix] || global['cancelRequest' + suffix]
  , isNative = true

for(var i = 0; i < vendors.length && !raf; i++) {
  raf = global[vendors[i] + 'Request' + suffix]
  caf = global[vendors[i] + 'Cancel' + suffix]
      || global[vendors[i] + 'CancelRequest' + suffix]
}

// Some versions of FF have rAF but not cAF
if(!raf || !caf) {
  isNative = false

  var last = 0
    , id = 0
    , queue = []
    , frameDuration = 1000 / 60

  raf = function(callback) {
    if(queue.length === 0) {
      var _now = now()
        , next = Math.max(0, frameDuration - (_now - last))
      last = next + _now
      setTimeout(function() {
        var cp = queue.slice(0)
        // Clear queue here to prevent
        // callbacks from appending listeners
        // to the current frame's queue
        queue.length = 0
        for(var i = 0; i < cp.length; i++) {
          if(!cp[i].cancelled) {
            try{
              cp[i].callback(last)
            } catch(e) {
              setTimeout(function() { throw e }, 0)
            }
          }
        }
      }, Math.round(next))
    }
    queue.push({
      handle: ++id,
      callback: callback,
      cancelled: false
    })
    return id
  }

  caf = function(handle) {
    for(var i = 0; i < queue.length; i++) {
      if(queue[i].handle === handle) {
        queue[i].cancelled = true
      }
    }
  }
}

module.exports = function(fn) {
  // Wrap in a new function to prevent
  // `cancel` potentially being assigned
  // to the native rAF function
  if(!isNative) {
    return raf.call(global, fn)
  }
  return raf.call(global, function() {
    try{
      fn.apply(this, arguments)
    } catch(e) {
      setTimeout(function() { throw e }, 0)
    }
  })
}
module.exports.cancel = function() {
  caf.apply(global, arguments)
}

},{"performance-now":68}],68:[function(require,module,exports){
(function (process){
// Generated by CoffeeScript 1.6.3
(function() {
  var getNanoSeconds, hrtime, loadTime;

  if ((typeof performance !== "undefined" && performance !== null) && performance.now) {
    module.exports = function() {
      return performance.now();
    };
  } else if ((typeof process !== "undefined" && process !== null) && process.hrtime) {
    module.exports = function() {
      return (getNanoSeconds() - loadTime) / 1e6;
    };
    hrtime = process.hrtime;
    getNanoSeconds = function() {
      var hr;
      hr = hrtime();
      return hr[0] * 1e9 + hr[1];
    };
    loadTime = getNanoSeconds();
  } else if (Date.now) {
    module.exports = function() {
      return Date.now() - loadTime;
    };
    loadTime = Date.now();
  } else {
    module.exports = function() {
      return new Date().getTime() - loadTime;
    };
    loadTime = new Date().getTime();
  }

}).call(this);

/*
//@ sourceMappingURL=performance-now.map
*/

}).call(this,require('_process'))
},{"_process":8}],69:[function(require,module,exports){
var Q = require("q");
var Qimage = require("qimage");
var GlslTransition = require("glsl-transition");
var BezierEasing = require("bezier-easing");
var KenBurns = require("kenburns");

function defaultFindTransitionByName (name, GlslTransitions) {
  for (var i=0; i<GlslTransitions.length; ++i) {
    if (GlslTransitions[i].name.toLowerCase() === name.toLowerCase()) {
      return GlslTransitions[i];
    }
  }
}

// Module?
function extend (obj) {
  var source, prop;
  for (var i = 1, length = arguments.length; i < length; i++) {
    source = arguments[i];
    for (prop in source) {
      if (source.hasOwnProperty(prop)) {
        obj[prop] = source[prop];
      }
    }
  }
  return obj;
}

function Viewer (params) {
  var self = this;
  if (!params) throw new Error("params are required");
  ["container", "data"].forEach(function (attr) {
    if (!(attr in params))
      throw new Error("params."+attr+" is required.");
  });
  
  // Initial states
  self.cursor = 0;
  for (var attr in params) {
    self[attr] = params[attr];
  }
  if (self.GlslTransitions) {
    self.findTransitionByName = function (name) {
      return defaultFindTransitionByName(name, self.GlslTransitions);
    };
  }

  self._initDOM();

  var T = GlslTransition(self.canvasT);
  self.kenBurns = self.canvases.map(function (c) {
    return new KenBurns.Canvas2D(c); // Currently using Canvas2D because waiting a fix on Chrome
  });
  self.curKen = 0;

  self.images = {};
  self.data.timeline.forEach(function (item) {
    var url = item.image;
    self.images[url] = Qimage.anonymously(url);
  }, self);

  self.transitions = {};
  self.data.timeline.forEach(function (item) {
    var name = item.transitionNext && item.transitionNext.name;
    if (name && !(name in self.transitions)) {
      var transitionObject = self.findTransitionByName(name);
      if (transitionObject) {
        self.transitions[name] = {
          t: T(transitionObject.glsl),
          uniforms: transitionObject.uniforms
        };
      }
    }
  }, self);
}

Viewer.prototype = {

  start: function () {
    var self = this;
    var data = this.data;
    var item = data.timeline[0];
    this._switchCanvas(this.canvases[this.curKen]);
    return this._prepareNext();
  },

/////////////////////////////////////////////////////////////////

  _initDOM: function () {
    var elt = this.container;
    var dim = elt.getBoundingClientRect();
    function createCanvas () {
      var c = document.createElement("canvas");
      c.width = dim.width;
      c.height = dim.height;
      return c;
    }
    this.canvasT = createCanvas();
    this.canvases = [ createCanvas(), createCanvas() ];
  },

  _switchCanvas: function (c) {
    var elt = this.container;
    var child = elt.children[0];
    if (child) elt.removeChild(child);
    elt.appendChild(c);
  },

  _endReached: function () {
    // TODO event
  },
  _performSingleImage: function (item) {
    var self = this;
    var cur = self.curKen;
    self.curKen = cur ? 0 : 1;
    return this.images[item.image]
      .then(function (img) {
        var from = KenBurns.crop.largest;
        var to = KenBurns.crop.largest;
        if (item.kenburns) {
          if (item.kenburns.from) from = KenBurns.crop.apply(KenBurns, item.kenburns.from);
          if (item.kenburns.to) to = KenBurns.crop.apply(KenBurns, item.kenburns.to);
        }
        var duration = item.duration;
        var durationBeforeTransition = duration - (item.transitionNext && item.transitionNext.duration || 0) / 2;
        var easing = BezierEasing.apply(null, item.kenburns.easing || [0, 0, 1, 1]);
        return Q.race([
          self.kenBurns[cur].run(img, from, to, duration, easing),
          Q.delay(durationBeforeTransition)
        ]);
      });
  },

  _prepareNext: function () {
    // Current implementation is a bit crazy and I'm sure we can clarify it.

    var self = this;
    var data = this.data;
    var from = this.cursor;
    var endReached = from+1 === data.timeline.length;
    var to = endReached ? 0 : from + 1;
    this.cursor = to;

    var fromItem = data.timeline[from];
    var toItem = data.timeline[to];

    var cur = self.curKen;
    var oth = cur ? 0 : 1;
    var fromCanvas = self.canvases[cur];
    var toCanvas = self.canvases[oth];

    // first, perform the current image.
    var chain = this._performSingleImage(fromItem);

    // optionally, chain a glsl transition
    var transitionNext = fromItem.transitionNext;
    if (transitionNext) {
      var transition = this.transitions[transitionNext.name];
      var transitionDuration = transitionNext.duration || 1000;
      var transitionEasing = BezierEasing.apply(null, transitionNext.easing || [0, 0, 1, 1]);
      chain = chain
        .thenResolve(Q.all([
          this.images[fromItem.image],
          this.images[toItem.image]
        ]))
        .spread(function (fromImage, toImage) {
          var transitionUniforms = extend({ from: fromCanvas, to: toCanvas }, transition.uniforms || {}, transitionNext.uniforms || {});
          self._switchCanvas(self.canvasT);
          return Q.all([
            transition.t(transitionUniforms, transitionDuration, transitionEasing).then(function () {
              self._switchCanvas(toCanvas);
            }),
            self._prepareNext()
          ]);
        });
    }

    if (endReached && !data.loop)
      chain = chain.then(this._endReached.bind(this));

    return chain;
  }
};

module.exports = Viewer;

},{"bezier-easing":26,"glsl-transition":44,"kenburns":45,"q":65,"qimage":66}],70:[function(require,module,exports){
module.exports = require("./transitions.min.json");

},{"./transitions.min.json":71}],71:[function(require,module,exports){
module.exports=[{"id":"f86f72429821b148d0ce","name":"pow distortion","owner":"yongxu","uniforms":{},"html_url":"https://gist.github.com/f86f72429821b148d0ce","created_at":"2014-08-24T22:51:44Z","updated_at":"2014-10-10T02:56:37Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;void main(){vec2 p=gl_FragCoord.xy/resolution.xy;vec4 t1=texture2D(from,vec2(pow(p.x,1.-progress),pow(p.y,1.-progress)));vec4 t2=texture2D(to,vec2(pow(p.x,progress),pow(p.y,progress)));gl_FragColor=mix(t1,t2,progress);}"},{"id":"d1f891c5585fc40b55ea","name":"Star Wipe","owner":"MemoryStomp","uniforms":{},"html_url":"https://gist.github.com/d1f891c5585fc40b55ea","created_at":"2014-07-01T06:58:45Z","updated_at":"2014-10-10T02:52:13Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;vec2 circlePoint(float ang){ang+=6.28318*0.15;return vec2(cos(ang),sin(ang));}float cross2d(vec2 a,vec2 b){return (a.x*b.y-a.y*b.x);}float star(vec2 p,float size){if(size<=0.0){return 0.0;}p/=size;vec2 p0=circlePoint(0.0);vec2 p1=circlePoint(6.28318*1.0/5.0);vec2 p2=circlePoint(6.28318*2.0/5.0);vec2 p3=circlePoint(6.28318*3.0/5.0);vec2 p4=circlePoint(6.28318*4.0/5.0);float s0=(cross2d(p1-p0,p-p0));float s1=(cross2d(p2-p1,p-p1));float s2=(cross2d(p3-p2,p-p2));float s3=(cross2d(p4-p3,p-p3));float s4=(cross2d(p0-p4,p-p4));float s5=min(min(min(s0,s1),min(s2,s3)),s4);float s=max(1.0-sign(s0*s1*s2*s3*s4)+sign(s5),0.0);s=sign(2.6-length(p))*s;return max(s,0.0);}void main(){vec2 p=(gl_FragCoord.xy/resolution.xy);vec2 o=p*2.0-1.0;float t=progress*1.4;float c1=star(o,t);float c2=star(o,t-0.1);float border=max(c1-c2,0.0);gl_FragColor=mix(texture2D(from,p),texture2D(to,p),c1)+vec4(border,border,border,0.0);}"},{"id":"5a4d1fb6711076d17e2e","name":"morph","owner":"paniq","uniforms":{},"html_url":"https://gist.github.com/5a4d1fb6711076d17e2e","created_at":"2014-07-01T04:52:25Z","updated_at":"2014-10-10T02:55:14Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;const float strength=0.1;void main(){vec2 p=gl_FragCoord.xy/resolution.xy;vec4 ca=texture2D(from,p);vec4 cb=texture2D(to,p);vec2 oa=(((ca.rg+ca.b)*0.5)*2.0-1.0);vec2 ob=(((cb.rg+cb.b)*0.5)*2.0-1.0);vec2 oc=mix(oa,ob,0.5)*strength;float w0=progress;float w1=1.0-w0;gl_FragColor=mix(texture2D(from,p+oc*w0),texture2D(to,p-oc*w1),progress);}"},{"id":"00973cee8e0353c73305","name":"LumaWipe","owner":"rectalogic","uniforms":{"lumaTex":"conical-asym.png","invertLuma":true,"softness":0.25},"html_url":"https://gist.github.com/00973cee8e0353c73305","created_at":"2014-06-17T02:11:27Z","updated_at":"2014-10-10T02:58:34Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;uniform sampler2D lumaTex;uniform bool invertLuma;uniform float softness;void main(){vec2 p=gl_FragCoord.xy/resolution.xy;float luma=texture2D(lumaTex,p).x;if(invertLuma) luma=1.0-luma;vec4 fromColor=texture2D(from,p);vec4 toColor=texture2D(to,p);float time=mix(0.0,1.0+softness,progress);if(luma<=time-softness) gl_FragColor=toColor;else if(luma>=time) gl_FragColor=fromColor;else{float alpha=(time-luma)/softness;gl_FragColor=mix(fromColor,toColor,alpha);}}"},{"id":"0141a38779af3a652c22","name":"simple luma","owner":"gre","uniforms":{"luma":"spiral-1.png"},"html_url":"https://gist.github.com/0141a38779af3a652c22","created_at":"2014-06-13T08:16:10Z","updated_at":"2014-10-10T02:58:50Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;uniform sampler2D luma;void main(){vec2 p=gl_FragCoord.xy/resolution.xy;gl_FragColor=mix(texture2D(from,p),texture2D(to,p),step(texture2D(luma,p).r,progress));}"},{"id":"ee15128c2b87d0e74dee","name":"cube","owner":"gre","uniforms":{"persp":0.7,"unzoom":0.3,"reflection":0.4,"floating":3.0},"html_url":"https://gist.github.com/ee15128c2b87d0e74dee","created_at":"2014-06-12T17:13:17Z","updated_at":"2014-10-10T02:53:02Z","stars":1.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;uniform float persp;uniform float unzoom;uniform float reflection;uniform float floating;vec2 project(vec2 p){return p*vec2(1.0,-1.2)+vec2(0.0,-floating/100.);}bool inBounds(vec2 p){return all(lessThan(vec2(0.0),p))&&all(lessThan(p,vec2(1.0)));}vec4 bgColor(vec2 p,vec2 pfr,vec2 pto){vec4 c=vec4(0.0,0.0,0.0,1.0);pfr=project(pfr);if(inBounds(pfr)){c+=mix(vec4(0.0),texture2D(from,pfr),reflection*mix(1.0,0.0,pfr.y));}pto=project(pto);if(inBounds(pto)){c+=mix(vec4(0.0),texture2D(to,pto),reflection*mix(1.0,0.0,pto.y));}return c;}vec2 xskew(vec2 p,float persp,float center){float x=mix(p.x,1.0-p.x,center);return ((vec2(x,(p.y-0.5*(1.0-persp)*x)/(1.0+(persp-1.0)*x))-vec2(0.5-distance(center,0.5),0.0))*vec2(0.5/distance(center,0.5)*(center<0.5?1.0:-1.0),1.0)+vec2(center<0.5?0.0:1.0,0.0));}void main(){vec2 op=gl_FragCoord.xy/resolution.xy;float uz=unzoom*2.0*(0.5-distance(0.5,progress));vec2 p=-uz*0.5+(1.0+uz)*op;vec2 fromP=xskew((p-vec2(progress,0.0))/vec2(1.0-progress,1.0),1.0-mix(progress,0.0,persp),0.0);vec2 toP=xskew(p/vec2(progress,1.0),mix(pow(progress,2.0),1.0,persp),1.0);if(inBounds(fromP)){gl_FragColor=texture2D(from,fromP);}else if(inBounds(toP)){gl_FragColor=texture2D(to,toP);}else{gl_FragColor=bgColor(op,fromP,toP);}}"},{"id":"9b99fc01fd5705008a5b","name":"Glitch Memories","owner":"niseh","uniforms":{},"html_url":"https://gist.github.com/9b99fc01fd5705008a5b","created_at":"2014-05-29T19:32:52Z","updated_at":"2014-10-10T02:59:23Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;void glitch_memories(sampler2D pic){vec2 p=gl_FragCoord.xy/resolution.xy;vec2 block=floor(gl_FragCoord.xy/vec2(16));vec2 uv_noise=block/vec2(64);uv_noise+=floor(vec2(progress)*vec2(1200.0,3500.0))/vec2(64);float block_thresh=pow(fract(progress*1200.0),2.0)*0.2;float line_thresh=pow(fract(progress*2200.0),3.0)*0.7;vec2 red=p,green=p,blue=p,o=p;vec2 dist=(fract(uv_noise)-0.5)*0.3;red+=dist*0.1;green+=dist*0.2;blue+=dist*0.125;gl_FragColor.r=texture2D(pic,red).r;gl_FragColor.g=texture2D(pic,green).g;gl_FragColor.b=texture2D(pic,blue).b;gl_FragColor.a=1.0;}void main(void){float smoothed=smoothstep(0.,1.,progress);if((smoothed<0.4&&smoothed>0.1)){glitch_memories(from);}else if((smoothed>0.6&&smoothed<0.9)){glitch_memories(to);}else{vec2 p=gl_FragCoord.xy/resolution.xy;gl_FragColor=mix(texture2D(from,p),texture2D(to,p),progress);}}"},{"id":"fe67b3b5149738069537","name":"potleaf","owner":"Flexi23","uniforms":{},"html_url":"https://gist.github.com/fe67b3b5149738069537","created_at":"2014-05-28T09:58:30Z","updated_at":"2014-10-10T02:58:27Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;void main(){vec2 uv=gl_FragCoord.xy/resolution.xy;vec2 leaf_uv=(uv-vec2(0.5))/10./pow(progress,3.5);leaf_uv.y+=0.35;float r=0.18;float o=atan(leaf_uv.y,leaf_uv.x);gl_FragColor=mix(texture2D(from,uv),texture2D(to,uv),1.-step(1.-length(leaf_uv)+r*(1.+sin(o))*(1.+0.9*cos(8.*o))*(1.+0.1*cos(24.*o))*(0.9+0.05*cos(200.*o)),1.));}"},{"id":"b86b90161503a0023231","name":"CrossZoom","owner":"rectalogic","uniforms":{"strength":0.4},"html_url":"https://gist.github.com/b86b90161503a0023231","created_at":"2014-05-25T01:24:39Z","updated_at":"2014-10-10T02:59:39Z","stars":1.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;uniform float strength;const float PI=3.141592653589793;float Linear_ease(in float begin,in float change,in float duration,in float time){return change*time/duration+begin;}float Exponential_easeInOut(in float begin,in float change,in float duration,in float time){if(time==0.0) return begin;else if(time==duration) return begin+change;time=time/(duration/2.0);if(time<1.0) return change/2.0*pow(2.0,10.0*(time-1.0))+begin;return change/2.0*(-pow(2.0,-10.0*(time-1.0))+2.0)+begin;}float Sinusoidal_easeInOut(in float begin,in float change,in float duration,in float time){return -change/2.0*(cos(PI*time/duration)-1.0)+begin;}float random(in vec3 scale,in float seed){return fract(sin(dot(gl_FragCoord.xyz+seed,scale))*43758.5453+seed);}vec3 crossFade(in vec2 uv,in float dissolve){return mix(texture2D(from,uv).rgb,texture2D(to,uv).rgb,dissolve);}void main(){vec2 texCoord=gl_FragCoord.xy/resolution.xy;vec2 center=vec2(Linear_ease(0.25,0.5,1.0,progress),0.5);float dissolve=Exponential_easeInOut(0.0,1.0,1.0,progress);float strength=Sinusoidal_easeInOut(0.0,strength,0.5,progress);vec3 color=vec3(0.0);float total=0.0;vec2 toCenter=center-texCoord;float offset=random(vec3(12.9898,78.233,151.7182),0.0);for(float t=0.0;t<=40.0;t++){float percent=(t+offset)/40.0;float weight=4.0*(percent-percent*percent);color+=crossFade(texCoord+toCenter*percent*strength,dissolve)*weight;total+=weight;}gl_FragColor=vec4(color/total,1.0);}"},{"id":"ce9279de351984f0ad27","name":"Slide","owner":"rectalogic","uniforms":{"translateX":1.0,"translateY":0.0},"html_url":"https://gist.github.com/ce9279de351984f0ad27","created_at":"2014-05-25T01:13:20Z","updated_at":"2014-10-10T02:59:07Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;uniform float translateX;uniform float translateY;void main(){vec2 texCoord=gl_FragCoord.xy/resolution.xy;float x=progress*translateX;float y=progress*translateY;if(x>=0.0&&y>=0.0){if(texCoord.x>=x&&texCoord.y>=y){gl_FragColor=texture2D(from,texCoord-vec2(x,y));}else{vec2 uv;if(x>0.0) uv=vec2(x-1.0,y);else if(y>0.0) uv=vec2(x,y-1.0);gl_FragColor=texture2D(to,texCoord-uv);}}else if(x<=0.0&&y<=0.0){if(texCoord.x<=(1.0+x)&&texCoord.y<=(1.0+y)) gl_FragColor=texture2D(from,texCoord-vec2(x,y));else{vec2 uv;if(x<0.0) uv=vec2(x+1.0,y);else if(y<0.0) uv=vec2(x,y+1.0);gl_FragColor=texture2D(to,texCoord-uv);}}else gl_FragColor=vec4(0.0);}"},{"id":"154a99fbe5300fb5c279","name":"pinwheel","owner":"mrspeaker","uniforms":{},"html_url":"https://gist.github.com/154a99fbe5300fb5c279","created_at":"2014-05-23T21:56:59Z","updated_at":"2014-10-10T02:55:16Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;void main(){vec2 p=gl_FragCoord.xy/resolution.xy;float circPos=atan(p.y-0.5,p.x-0.5)+progress;float modPos=mod(circPos,3.1415/4.);float signed=sign(progress-modPos);float smoothed=smoothstep(0.,1.,signed);if(smoothed>0.5){gl_FragColor=texture2D(to,p);}else{gl_FragColor=texture2D(from,p);}}"},{"id":"e54a807cdb66c8b16a34","name":"Kaleidoscope","owner":"nwoeanhinnogaehr","uniforms":{"speed":1.0,"angle":2.0,"power":2.0},"html_url":"https://gist.github.com/e54a807cdb66c8b16a34","created_at":"2014-05-23T19:02:46Z","updated_at":"2014-10-10T02:55:55Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;uniform float speed;uniform float angle;uniform float power;void main(){vec2 p=gl_FragCoord.xy/resolution.xy;vec2 q=p;float t=pow(progress,power)*speed;p=p-0.5;for(int i=0;i<7;i++){p=vec2(sin(t)*p.x+cos(t)*p.y,sin(t)*p.y-cos(t)*p.x);t+=angle;p=abs(mod(p,2.0)-1.0);}abs(mod(p,1.0));gl_FragColor=mix(mix(texture2D(from,q),texture2D(to,q),progress),mix(texture2D(from,p),texture2D(to,p),progress),1.0-2.0*abs(progress-0.5));}"},{"id":"408045772d255df97520","name":"SimpleFlip","owner":"nwoeanhinnogaehr","uniforms":{},"html_url":"https://gist.github.com/408045772d255df97520","created_at":"2014-05-23T18:42:58Z","updated_at":"2014-10-10T02:55:57Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;void main(){vec2 p=gl_FragCoord.xy/resolution.xy;vec2 q=p;p.x=(p.x-0.5)/abs(progress-0.5)*0.5+0.5;vec4 a=texture2D(from,p);vec4 b=texture2D(to,p);gl_FragColor=vec4(mix(a,b,step(0.5,progress)).rgb*step(abs(q.x-0.5),abs(progress-0.5)),1.0);}"},{"id":"a070cbd69e2535e757f1","name":"DoomScreenTransition","owner":"zeh","uniforms":{"barWidth":10.0,"noise":0.2,"amplitude":2.0,"frequency":1.0},"html_url":"https://gist.github.com/a070cbd69e2535e757f1","created_at":"2014-05-23T18:00:18Z","updated_at":"2014-10-10T02:51:50Z","stars":1.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;uniform int barWidth;uniform float amplitude;uniform float noise;uniform float frequency;float rand(int num){return fract(mod(float(num)*67123.313,12.0)*sin(float(num)*10.3)*cos(float(num)));}float wave(int num){float fn=float(num)*frequency*0.1*float(barWidth);return cos(fn*0.5)*cos(fn*0.13)*sin((fn+10.0)*0.3)/2.0+0.5;}float pos(int num){return noise==0.0?wave(num):mix(wave(num),rand(num),noise);}void main(){int bar=int(gl_FragCoord.x)/barWidth;float scale=1.0+pos(bar)*amplitude;float phase=progress*scale;float posY=gl_FragCoord.y/resolution.y;vec2 p;vec4 c;if(phase+posY<1.0){p=vec2(gl_FragCoord.x,gl_FragCoord.y+mix(0.0,resolution.y,phase))/resolution.xy;c=texture2D(from,p);}else{p=gl_FragCoord.xy/resolution.xy;c=texture2D(to,p);}gl_FragColor=c;}"},{"id":"a830822b23e846e25d2d","name":"DreamyZoom","owner":"zeh","uniforms":{"rotation":6.0,"scale":1.2},"html_url":"https://gist.github.com/a830822b23e846e25d2d","created_at":"2014-05-23T15:27:25Z","updated_at":"2014-10-10T02:54:41Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\n\n#define DEG2RAD 0.03926990816987241548078304229099 // 1/180*PI\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;uniform float rotation;uniform float scale;void main(){float phase=progress<0.5?progress*2.0:(progress-0.5)*2.0;float angleOffset=progress<0.5?mix(0.0,rotation*DEG2RAD,phase):mix(-rotation*DEG2RAD,0.0,phase);float newScale=progress<0.5?mix(1.0,scale,phase):mix(scale,1.0,phase);vec2 center=vec2(0,0);float maxRes=max(resolution.x,resolution.y);float resX=resolution.x/maxRes*0.5;float resY=resolution.y/maxRes*0.5;vec2 p=(gl_FragCoord.xy/maxRes-vec2(resX,resY))/newScale;float angle=atan(p.y,p.x)+angleOffset;float dist=distance(center,p);p.x=cos(angle)*dist+resX;p.y=sin(angle)*dist+resY;vec4 c=progress<0.5?texture2D(from,p):texture2D(to,p);gl_FragColor=c+(progress<0.5?mix(0.0,1.0,phase):mix(1.0,0.0,phase));}"},{"id":"b6720916aa3f035949bc","name":"squareswipe","owner":"gre","uniforms":{"squares":[10.0,10.0],"direction":[1.0,-0.5],"smoothness":1.6},"html_url":"https://gist.github.com/b6720916aa3f035949bc","created_at":"2014-05-23T12:09:38Z","updated_at":"2014-10-10T02:56:51Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;uniform ivec2 squares;uniform vec2 direction;uniform float smoothness;const vec2 center=vec2(0.5,0.5);void main(){vec2 p=gl_FragCoord.xy/resolution.xy;vec2 v=normalize(direction);if(v!=vec2(0.0)) v/=abs(v.x)+abs(v.y);float d=v.x*center.x+v.y*center.y;float offset=smoothness;float pr=smoothstep(-offset,0.0,v.x*p.x+v.y*p.y-(d-0.5+progress*(1.+offset)));vec2 squarep=fract(p*vec2(squares));vec2 squaremin=vec2(pr/2.0);vec2 squaremax=vec2(1.0-pr/2.0);float a=all(lessThan(squaremin,squarep))&&all(lessThan(squarep,squaremax))?1.0:0.0;gl_FragColor=mix(texture2D(from,p),texture2D(to,p),a);}"},{"id":"169781bb76f310e2bfde","name":"TilesWaveBottomLeftToTopRight","owner":"numb3r23","uniforms":{},"html_url":"https://gist.github.com/169781bb76f310e2bfde","created_at":"2014-05-21T22:50:48Z","updated_at":"2014-10-10T02:52:51Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;const vec2 tileSize=vec2(64,64);const float checkerDistance=0.015;const bool flipX=true;const bool flipY=false;const bool preTileSingleColor=false;const bool postTileSingleColor=false;vec2 tile2Global(vec2 tex,vec2 tileNum,bool tileSingleColor){vec2 perTile=tileSize/resolution.xy;return tileNum*perTile+(tileSingleColor?vec2(0):tex*perTile);}void main(void){vec2 uv=gl_FragCoord.xy/resolution.xy;vec4 fragColor=vec4(1,1,0,1);vec2 posInTile=mod(vec2(gl_FragCoord),tileSize);vec2 tileNum=floor(vec2(gl_FragCoord)/tileSize);int num=int(tileNum.x);vec2 totalTiles=ceil(resolution.xy/tileSize);float countTiles=totalTiles.x*totalTiles.y;vec2 perTile=ceil(tileSize/resolution.xy);float offset=0.0;offset=(tileNum.y+tileNum.x*perTile.y)/(sqrt(countTiles)*2.0);float timeOffset=(progress-offset)*countTiles;timeOffset=clamp(timeOffset,0.0,0.5);float sinTime=1.0-abs(cos(fract(timeOffset)*3.1415926));fragColor.rg=uv;fragColor.b=sinTime;vec2 texC=posInTile/tileSize;if(sinTime<=0.5){if(flipX){if((texC.x<sinTime)||(texC.x>1.0-sinTime)){discard;}if(texC.x<0.5){texC.x=(texC.x-sinTime)*0.5/(0.5-sinTime);}else{texC.x=(texC.x-0.5)*0.5/(0.5-sinTime)+0.5;}}if(flipY){if((texC.y<sinTime)||(texC.y>1.0-sinTime)){discard;}if(texC.y<0.5){texC.y=(texC.y-sinTime)*0.5/(0.5-sinTime);}else{texC.y=(texC.y-0.5)*0.5/(0.5-sinTime)+0.5;}}fragColor=texture2D(from,tile2Global(texC,tileNum,preTileSingleColor));}else{if(flipX){if((texC.x>sinTime)||(texC.x<1.0-sinTime)){discard;}if(texC.x<0.5){texC.x=(texC.x-sinTime)*0.5/(0.5-sinTime);}else{texC.x=(texC.x-0.5)*0.5/(0.5-sinTime)+0.5;}texC.x=1.0-texC.x;}if(flipY){if((texC.y>sinTime)||(texC.y<1.0-sinTime)){discard;}if(texC.y<0.5){texC.y=(texC.y-sinTime)*0.5/(0.5-sinTime);}else{texC.y=(texC.y-0.5)*0.5/(0.5-sinTime)+0.5;}texC.y=1.0-texC.y;}fragColor.rgb=texture2D(to,tile2Global(texC,tileNum,postTileSingleColor)).rgb;}gl_FragColor=fragColor;}"},{"id":"5ebd3442a208861c7a8a","name":"TilesScanline","owner":"numb3r23","uniforms":{},"html_url":"https://gist.github.com/5ebd3442a208861c7a8a","created_at":"2014-05-21T22:49:22Z","updated_at":"2014-10-10T02:57:19Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;const vec2 tileSize=vec2(64,64);const float checkerDistance=0.015;const bool flipX=true;const bool flipY=false;const bool preTileSingleColor=false;const bool postTileSingleColor=false;vec2 tile2Global(vec2 tex,vec2 tileNum,bool tileSingleColor){vec2 perTile=tileSize/resolution.xy;return tileNum*perTile+(tileSingleColor?vec2(0):tex*perTile);}void main(void){vec2 uv=gl_FragCoord.xy/resolution.xy;vec4 fragColor=vec4(1,1,0,1);vec2 posInTile=mod(vec2(gl_FragCoord),tileSize);vec2 tileNum=floor(vec2(gl_FragCoord)/tileSize);int num=int(tileNum.x);vec2 totalTiles=ceil(resolution.xy/tileSize);float countTiles=totalTiles.x*totalTiles.y;vec2 perTile=ceil(tileSize/resolution.xy);float offset=0.0;offset=(tileNum.x+tileNum.y*totalTiles.x)/countTiles;float timeOffset=(progress-offset)*countTiles;timeOffset=clamp(timeOffset,0.0,0.5);float sinTime=1.0-abs(cos(fract(timeOffset)*3.1415926));fragColor.rg=uv;fragColor.b=sinTime;vec2 texC=posInTile/tileSize;if(sinTime<=0.5){if(flipX){if((texC.x<sinTime)||(texC.x>1.0-sinTime)){discard;}if(texC.x<0.5){texC.x=(texC.x-sinTime)*0.5/(0.5-sinTime);}else{texC.x=(texC.x-0.5)*0.5/(0.5-sinTime)+0.5;}}if(flipY){if((texC.y<sinTime)||(texC.y>1.0-sinTime)){discard;}if(texC.y<0.5){texC.y=(texC.y-sinTime)*0.5/(0.5-sinTime);}else{texC.y=(texC.y-0.5)*0.5/(0.5-sinTime)+0.5;}}fragColor=texture2D(from,tile2Global(texC,tileNum,preTileSingleColor));}else{if(flipX){if((texC.x>sinTime)||(texC.x<1.0-sinTime)){discard;}if(texC.x<0.5){texC.x=(texC.x-sinTime)*0.5/(0.5-sinTime);}else{texC.x=(texC.x-0.5)*0.5/(0.5-sinTime)+0.5;}texC.x=1.0-texC.x;}if(flipY){if((texC.y>sinTime)||(texC.y<1.0-sinTime)){discard;}if(texC.y<0.5){texC.y=(texC.y-sinTime)*0.5/(0.5-sinTime);}else{texC.y=(texC.y-0.5)*0.5/(0.5-sinTime)+0.5;}texC.y=1.0-texC.y;}fragColor.rgb=texture2D(to,tile2Global(texC,tileNum,postTileSingleColor)).rgb;}gl_FragColor=fragColor;}"},{"id":"9e86d2712e123542758b","name":"Dreamy","owner":"mikolalysenko","uniforms":{},"html_url":"https://gist.github.com/9e86d2712e123542758b","created_at":"2014-05-21T14:55:01Z","updated_at":"2014-10-10T02:56:21Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;vec2 offset(float progress,float x,float theta){float phase=progress*progress+progress+theta;float shifty=0.03*progress*cos(10.0*(progress+x));return vec2(0,shifty);}void main(){vec2 p=gl_FragCoord.xy/resolution.xy;gl_FragColor=mix(texture2D(from,p+offset(progress,p.x,0.0)),texture2D(to,p+offset(1.0-progress,p.x,3.14)),progress);}"},{"id":"21d2fdd24c706952dc8c","name":"AdvancedMosaic","owner":"corporateshark","uniforms":{},"html_url":"https://gist.github.com/21d2fdd24c706952dc8c","created_at":"2014-05-21T14:45:52Z","updated_at":"2014-10-10T02:59:00Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;void main(void){vec2 p=gl_FragCoord.xy/resolution.xy;float T=progress;float S0=1.0;float S1=50.0;float S2=1.0;float Half=0.5;float PixelSize=(T<Half)?mix(S0,S1,T/Half):mix(S1,S2,(T-Half)/Half);vec2 D=PixelSize/resolution.xy;vec2 UV=(p+vec2(-0.5))/D;vec2 Coord=clamp(D*(ceil(UV+vec2(-0.5)))+vec2(0.5),vec2(0.0),vec2(1.0));vec4 C0=texture2D(from,Coord);vec4 C1=texture2D(to,Coord);gl_FragColor=mix(C0,C1,T);}"},{"id":"cacfedb8cca0f5ce3f7c","name":"Swirl","owner":"corporateshark","uniforms":{},"html_url":"https://gist.github.com/cacfedb8cca0f5ce3f7c","created_at":"2014-05-21T14:43:04Z","updated_at":"2014-10-10T02:57:52Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;void main(void){float Radius=1.0;float T=progress;vec2 UV=gl_FragCoord.xy/resolution.xy;UV-=vec2(0.5,0.5);float Dist=length(UV);if(Dist<Radius){float Percent=(Radius-Dist)/Radius;float A=(T<=0.5)?mix(0.0,1.0,T/0.5):mix(1.0,0.0,(T-0.5)/0.5);float Theta=Percent*Percent*A*8.0*3.14159;float S=sin(Theta);float C=cos(Theta);UV=vec2(dot(UV,vec2(C,-S)),dot(UV,vec2(S,C)));}UV+=vec2(0.5,0.5);vec4 C0=texture2D(from,UV);vec4 C1=texture2D(to,UV);gl_FragColor=mix(C0,C1,T);}"},{"id":"b9f8e5675c647e615419","name":"DefocusBlur","owner":"corporateshark","uniforms":{},"html_url":"https://gist.github.com/b9f8e5675c647e615419","created_at":"2014-05-21T10:12:14Z","updated_at":"2014-10-10T02:55:49Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform float progress;uniform vec2 resolution;uniform sampler2D from;uniform sampler2D to;void main(void){vec2 p=gl_FragCoord.xy/resolution.xy;float T=progress;float S0=1.0;float S1=50.0;float S2=1.0;float Half=0.5;float PixelSize=(T<Half)?mix(S0,S1,T/Half):mix(S1,S2,(T-Half)/Half);vec2 D=PixelSize/resolution.xy;vec2 UV=(gl_FragCoord.xy/resolution.xy);const int NumTaps=12;vec2 Disk[NumTaps];Disk[0]=vec2(-.326,-.406);Disk[1]=vec2(-.840,-.074);Disk[2]=vec2(-.696,.457);Disk[3]=vec2(-.203,.621);Disk[4]=vec2(.962,-.195);Disk[5]=vec2(.473,-.480);Disk[6]=vec2(.519,.767);Disk[7]=vec2(.185,-.893);Disk[8]=vec2(.507,.064);Disk[9]=vec2(.896,.412);Disk[10]=vec2(-.322,-.933);Disk[11]=vec2(-.792,-.598);vec4 C0=texture2D(from,UV);vec4 C1=texture2D(to,UV);for(int i=0;i!=NumTaps;i++){C0+=texture2D(from,Disk[i]*D+UV);C1+=texture2D(to,Disk[i]*D+UV);}C0/=float(NumTaps+1);C1/=float(NumTaps+1);gl_FragColor=mix(C0,C1,T);}"},{"id":"2a5fa2f77c883dd661f9","name":"colourDistance","owner":"P-Seebauer","uniforms":{"interpolationPower":5.0},"html_url":"https://gist.github.com/2a5fa2f77c883dd661f9","created_at":"2014-05-21T07:10:21Z","updated_at":"2014-10-10T02:51:32Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;uniform float interpolationPower;void main(){vec2 p=gl_FragCoord.xy/resolution.xy;vec4 fTex=texture2D(from,p);vec4 tTex=texture2D(to,p);gl_FragColor=mix(distance(fTex,tTex)>progress?fTex:tTex,tTex,pow(progress,interpolationPower));}"},{"id":"b93818de23d4511fde10","name":"Dissolve","owner":"nwoeanhinnogaehr","uniforms":{"blocksize":1.0},"html_url":"https://gist.github.com/b93818de23d4511fde10","created_at":"2014-05-20T23:40:57Z","updated_at":"2014-10-10T02:53:59Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;uniform float blocksize;float rand(vec2 co){return fract(sin(dot(co,vec2(12.9898,78.233)))*43758.5453);}void main(){vec2 p=gl_FragCoord.xy/resolution.xy;gl_FragColor=mix(texture2D(from,p),texture2D(to,p),step(rand(floor(gl_FragCoord.xy/blocksize)),progress));}"},{"id":"b185145363d65751009b","name":"HSVfade","owner":"nwoeanhinnogaehr","uniforms":{},"html_url":"https://gist.github.com/b185145363d65751009b","created_at":"2014-05-20T23:21:27Z","updated_at":"2014-10-10T02:58:26Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;vec3 hsv2rgb(vec3 c){const vec4 K=vec4(1.0,2.0/3.0,1.0/3.0,3.0);vec3 p=abs(fract(c.xxx+K.xyz)*6.0-K.www);return c.z*mix(K.xxx,clamp(p-K.xxx,0.0,1.0),c.y);}vec3 rgb2hsv(vec3 c){const vec4 K=vec4(0.0,-1.0/3.0,2.0/3.0,-1.0);vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));float d=q.x-min(q.w,q.y);return vec3(abs(q.z+(q.w-q.y)/(6.0*d+0.001)),d/(q.x+0.001),q.x);}void main(){vec2 p=gl_FragCoord.xy/resolution.xy;vec3 a=rgb2hsv(texture2D(from,p).rgb);vec3 b=rgb2hsv(texture2D(to,p).rgb);vec3 m=mix(a,b,progress);gl_FragColor=vec4(hsv2rgb(m),1.0);}"},{"id":"f6fc39f4cfcbb97f96a6","name":"Fold","owner":"nwoeanhinnogaehr","uniforms":{},"html_url":"https://gist.github.com/f6fc39f4cfcbb97f96a6","created_at":"2014-05-20T23:14:23Z","updated_at":"2014-10-10T02:57:19Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;void main(){vec2 p=gl_FragCoord.xy/resolution.xy;vec4 a=texture2D(from,(p-vec2(progress,0.0))/vec2(1.0-progress,1.0));vec4 b=texture2D(to,p/vec2(progress,1.0));gl_FragColor=mix(a,b,step(p.x,progress));}"},{"id":"80c2d40cac3f98453176","name":"linearblur","owner":"gre","uniforms":{"intensity":0.1},"html_url":"https://gist.github.com/80c2d40cac3f98453176","created_at":"2014-05-20T22:02:35Z","updated_at":"2014-10-10T02:56:23Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;uniform float intensity;const int PASSES=8;void main(){vec2 p=gl_FragCoord.xy/resolution.xy;vec4 c1=vec4(0.0),c2=vec4(0.0);float disp=intensity*(0.5-distance(0.5,progress));for(int xi=0;xi<PASSES;++xi){float x=float(xi)/float(PASSES)-0.5;for(int yi=0;yi<PASSES;++yi){float y=float(yi)/float(PASSES)-0.5;vec2 v=vec2(x,y);float d=disp;c1+=texture2D(from,p+d*v);c2+=texture2D(to,p+d*v);}}c1/=float(PASSES*PASSES);c2/=float(PASSES*PASSES);gl_FragColor=mix(c1,c2,progress);}"},{"id":"c528607361d90a072e98","name":"pixelize","owner":"benraziel","uniforms":{},"html_url":"https://gist.github.com/c528607361d90a072e98","created_at":"2014-05-20T19:32:42Z","updated_at":"2014-10-10T02:56:50Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;float rand(vec2 co){return fract(sin(dot(co.xy,vec2(12.9898,78.233)))*43758.5453);}void main(){float revProgress=(1.0-progress);float distFromEdges=min(progress,revProgress);float squareSize=(50.0*distFromEdges)+1.0;vec2 p=(floor((gl_FragCoord.xy+squareSize*0.5)/squareSize)*squareSize)/resolution.xy;vec4 fromColor=texture2D(from,p);vec4 toColor=texture2D(to,p);gl_FragColor=mix(fromColor,toColor,progress);}"},{"id":"abd06f4d23ab2ff4ed7a","name":"random_squares","owner":"benraziel","uniforms":{},"html_url":"https://gist.github.com/abd06f4d23ab2ff4ed7a","created_at":"2014-05-20T19:07:25Z","updated_at":"2014-10-10T02:52:20Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;float rand(vec2 co){return fract(sin(dot(co.xy,vec2(12.9898,78.233)))*43758.5453);}void main(){float revProgress=(1.0-progress);float distFromEdges=min(progress,revProgress);vec2 p=gl_FragCoord.xy/resolution.xy;vec4 fromColor=texture2D(from,p);vec4 toColor=texture2D(to,p);float squareSize=20.0;float flickerSpeed=60.0;vec2 seed=floor(gl_FragCoord.xy/squareSize)*floor(distFromEdges*flickerSpeed);gl_FragColor=mix(fromColor,toColor,progress)+rand(seed)*distFromEdges*0.5;}"},{"id":"791d0f058ae6a83e0c15","name":"PolkaDotsCurtain","owner":"bobylito","uniforms":{"center":[1.0,1.0],"dots":20.0},"html_url":"https://gist.github.com/791d0f058ae6a83e0c15","created_at":"2014-05-20T16:55:46Z","updated_at":"2014-10-10T02:59:26Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;const float SQRT_2=1.414213562373;uniform float dots;uniform vec2 center;void main(){vec2 p=gl_FragCoord.xy/resolution.xy;float x=progress/2.0;bool nextImage=distance(fract(p*dots),vec2(0.5,0.5))<(2.0*x/distance(p,center));if(nextImage) gl_FragColor=texture2D(to,p);else gl_FragColor=texture2D(from,p);}"},{"id":"166e496a19a4fdbf1aae","name":"PageCurl","owner":"corporateshark","uniforms":{},"html_url":"https://gist.github.com/166e496a19a4fdbf1aae","created_at":"2014-05-20T12:37:15Z","updated_at":"2014-10-10T02:56:45Z","stars":1.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;const float MIN_AMOUNT=-0.16;const float MAX_AMOUNT=1.3;float amount=progress*(MAX_AMOUNT-MIN_AMOUNT)+MIN_AMOUNT;const float PI=3.141592653589793;const float scale=512.0;const float sharpness=3.0;float cylinderCenter=amount;float cylinderAngle=2.0*PI*amount;const float cylinderRadius=1.0/PI/2.0;vec3 hitPoint(float hitAngle,float yc,vec3 point,mat3 rrotation){float hitPoint=hitAngle/(2.0*PI);point.y=hitPoint;return rrotation*point;}vec4 antiAlias(vec4 color1,vec4 color2,float distanc){distanc*=scale;if(distanc<0.0) return color2;if(distanc>2.0) return color1;float dd=pow(1.0-distanc/2.0,sharpness);return ((color2-color1)*dd)+color1;}float distanceToEdge(vec3 point){float dx=abs(point.x>0.5?1.0-point.x:point.x);float dy=abs(point.y>0.5?1.0-point.y:point.y);if(point.x<0.0) dx=-point.x;if(point.x>1.0) dx=point.x-1.0;if(point.y<0.0) dy=-point.y;if(point.y>1.0) dy=point.y-1.0;if((point.x<0.0||point.x>1.0)&&(point.y<0.0||point.y>1.0)) return sqrt(dx*dx+dy*dy);return min(dx,dy);}vec4 seeThrough(float yc,vec2 p,mat3 rotation,mat3 rrotation){float hitAngle=PI-(acos(yc/cylinderRadius)-cylinderAngle);vec3 point=hitPoint(hitAngle,yc,rotation*vec3(p,1.0),rrotation);if(yc<=0.0&&(point.x<0.0||point.y<0.0||point.x>1.0||point.y>1.0)){vec2 texCoord=gl_FragCoord.xy/resolution.xy;return texture2D(to,texCoord);}if(yc>0.0) return texture2D(from,p);vec4 color=texture2D(from,point.xy);vec4 tcolor=vec4(0.0);return antiAlias(color,tcolor,distanceToEdge(point));}vec4 seeThroughWithShadow(float yc,vec2 p,vec3 point,mat3 rotation,mat3 rrotation){float shadow=distanceToEdge(point)*30.0;shadow=(1.0-shadow)/3.0;if(shadow<0.0) shadow=0.0;else shadow*=amount;vec4 shadowColor=seeThrough(yc,p,rotation,rrotation);shadowColor.r-=shadow;shadowColor.g-=shadow;shadowColor.b-=shadow;return shadowColor;}vec4 backside(float yc,vec3 point){vec4 color=texture2D(from,point.xy);float gray=(color.r+color.b+color.g)/15.0;gray+=(8.0/10.0)*(pow(1.0-abs(yc/cylinderRadius),2.0/10.0)/2.0+(5.0/10.0));color.rgb=vec3(gray);return color;}vec4 behindSurface(float yc,vec3 point,mat3 rrotation){float shado=(1.0-((-cylinderRadius-yc)/amount*7.0))/6.0;shado*=1.0-abs(point.x-0.5);yc=(-cylinderRadius-cylinderRadius-yc);float hitAngle=(acos(yc/cylinderRadius)+cylinderAngle)-PI;point=hitPoint(hitAngle,yc,point,rrotation);if(yc<0.0&&point.x>=0.0&&point.y>=0.0&&point.x<=1.0&&point.y<=1.0&&(hitAngle<PI||amount>0.5)){shado=1.0-(sqrt(pow(point.x-0.5,2.0)+pow(point.y-0.5,2.0))/(71.0/100.0));shado*=pow(-yc/cylinderRadius,3.0);shado*=0.5;}else{shado=0.0;}vec2 texCoord=gl_FragCoord.xy/resolution.xy;return vec4(texture2D(to,texCoord).rgb-shado,1.0);}void main(){vec2 texCoord=gl_FragCoord.xy/resolution.xy;const float angle=30.0*PI/180.0;float c=cos(-angle);float s=sin(-angle);mat3 rotation=mat3(c,s,0,-s,c,0,0.12,0.258,1);c=cos(angle);s=sin(angle);mat3 rrotation=mat3(c,s,0,-s,c,0,0.15,-0.5,1);vec3 point=rotation*vec3(texCoord,1.0);float yc=point.y-cylinderCenter;if(yc<-cylinderRadius){gl_FragColor=behindSurface(yc,point,rrotation);return;}if(yc>cylinderRadius){gl_FragColor=texture2D(from,texCoord);return;}float hitAngle=(acos(yc/cylinderRadius)+cylinderAngle)-PI;float hitAngleMod=mod(hitAngle,2.0*PI);if((hitAngleMod>PI&&amount<0.5)||(hitAngleMod>PI/2.0&&amount<0.0)){gl_FragColor=seeThrough(yc,texCoord,rotation,rrotation);return;}point=hitPoint(hitAngle,yc,point,rrotation);if(point.x<0.0||point.y<0.0||point.x>1.0||point.y>1.0){gl_FragColor=seeThroughWithShadow(yc,texCoord,point,rotation,rrotation);return;}vec4 color=backside(yc,point);vec4 otherColor;if(yc<0.0){float shado=1.0-(sqrt(pow(point.x-0.5,2.0)+pow(point.y-0.5,2.0))/0.71);shado*=pow(-yc/cylinderRadius,3.0);shado*=0.5;otherColor=vec4(0.0,0.0,0.0,shado);}else{otherColor=texture2D(from,texCoord);}color=antiAlias(color,otherColor,cylinderRadius-abs(yc));vec4 cl=seeThroughWithShadow(yc,texCoord,point,rotation,rrotation);float dist=distanceToEdge(point);gl_FragColor=antiAlias(color,cl,dist);}"},{"id":"06450f79cab706705bf9","name":"Polka_dots","owner":"bobylito","uniforms":{"dots":5.0},"html_url":"https://gist.github.com/06450f79cab706705bf9","created_at":"2014-05-20T12:09:38Z","updated_at":"2014-10-10T02:55:51Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;uniform float dots;void main(){vec2 p=gl_FragCoord.xy/resolution.xy;float x=progress;bool nextImage=distance(fract(p*dots),vec2(0.5,0.5))<x;if(nextImage) gl_FragColor=texture2D(to,p);else gl_FragColor=texture2D(from,p);}"},{"id":"3da654388c3f3cd031c0","name":"burn","owner":"gre","uniforms":{"color":[0.9,0.4,0.2]},"html_url":"https://gist.github.com/3da654388c3f3cd031c0","created_at":"2014-05-20T09:06:02Z","updated_at":"2014-10-10T02:55:57Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;uniform vec3 color;void main(){vec2 p=gl_FragCoord.xy/resolution.xy;gl_FragColor=mix(texture2D(from,p)+vec4(progress*color,1.0),texture2D(to,p)+vec4((1.0-progress)*color,1.0),progress);}"},{"id":"e5f807b5dffb09fc7527","name":"FinalGaussianNoise","owner":"mandubian","uniforms":{},"html_url":"https://gist.github.com/e5f807b5dffb09fc7527","created_at":"2014-05-19T21:34:07Z","updated_at":"2014-10-10T02:59:05Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;float Rand(vec2 v){return fract(sin(dot(v.xy,vec2(12.9898,78.233)))*43758.5453);}float Gaussian(float p,float center,float c){return 0.75*exp(-pow((p-center)/c,2.));}void main(){vec2 p=gl_FragCoord.xy/resolution.xy;float c=cos(Gaussian(progress*(1.+Gaussian(progress*Rand(p),0.5,0.5)),0.5,0.25));vec2 d=p*c;gl_FragColor=mix(texture2D(from,d),texture2D(to,d),progress);}"},{"id":"130bb7b7affedbda9df5","name":"Mosaic","owner":"Xaychru","uniforms":{"endx":0.0,"endy":-1.0},"html_url":"https://gist.github.com/130bb7b7affedbda9df5","created_at":"2014-05-19T16:51:58Z","updated_at":"2014-10-10T02:56:21Z","stars":1.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\n\n#define PI 3.14159265358979323\n\n#define POW2(X) X*X\n\n#define POW3(X) X*X*X\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;uniform int endx;uniform int endy;float Rand(vec2 v){return fract(sin(dot(v.xy,vec2(12.9898,78.233)))*43758.5453);}vec2 Rotate(vec2 v,float a){mat2 rm=mat2(cos(a),-sin(a),sin(a),cos(a));return rm*v;}float CosInterpolation(float x){return -cos(x*PI)/2.+.5;}void main(){vec2 p=gl_FragCoord.xy/resolution.xy-.5;vec2 rp=p;float rpr=(progress*2.-1.);float z=-(rpr*rpr*2.)+3.;float az=abs(z);rp*=az;rp+=mix(vec2(.5,.5),vec2(float(endx)+.5,float(endy)+.5),POW2(CosInterpolation(progress)));vec2 mrp=mod(rp,1.);vec2 crp=rp;bool onEnd=int(floor(crp.x))==endx&&int(floor(crp.y))==endy;if(!onEnd){float ang=float(int(Rand(floor(crp))*4.))*.5*PI;mrp=vec2(.5)+Rotate(mrp-vec2(.5),ang);}if(onEnd||Rand(floor(crp))>.5){gl_FragColor=texture2D(to,mrp);}else{gl_FragColor=texture2D(from,mrp);}}"},{"id":"ce1d48f0ce00bb379750","name":"Radial","owner":"Xaychru","uniforms":{},"html_url":"https://gist.github.com/ce1d48f0ce00bb379750","created_at":"2014-05-19T15:18:28Z","updated_at":"2014-10-10T02:59:34Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\n\n#define PI 3.141592653589\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;void main(){vec2 p=gl_FragCoord.xy/resolution.xy;vec2 rp=p*2.-1.;float a=atan(rp.y,rp.x);float pa=progress*PI*2.5-PI*1.25;vec4 fromc=texture2D(from,p);vec4 toc=texture2D(to,p);if(a>pa){gl_FragColor=mix(toc,fromc,smoothstep(0.,1.,(a-pa)));}else{gl_FragColor=toc;}}"},{"id":"c3bc914de09227713787","name":"ButterflyWaveScrawler","owner":"mandubian","uniforms":{"amplitude":1.0,"waves":30.0,"colorSeparation":0.3},"html_url":"https://gist.github.com/c3bc914de09227713787","created_at":"2014-05-19T11:48:15Z","updated_at":"2014-10-10T02:59:15Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;uniform float amplitude;uniform float waves;uniform float colorSeparation;float PI=3.14159265358979323846264;float compute(vec2 p,float progress,vec2 center){vec2 o=p*sin(progress*amplitude)-center;vec2 h=vec2(1.,0.);float theta=acos(dot(o,h))*waves;return (exp(cos(theta))-2.*cos(4.*theta)+pow(sin((2.*theta-PI)/24.),5.))/10.;}void main(){vec2 p=gl_FragCoord.xy/resolution.xy;float inv=1.-progress;vec2 dir=p-vec2(.5);float dist=length(dir);float disp=compute(p,progress,vec2(0.5,0.5));vec4 texTo=texture2D(to,p+inv*disp);vec4 texFrom=vec4(texture2D(from,p+progress*disp*(1.0-colorSeparation)).r,texture2D(from,p+progress*disp).g,texture2D(from,p+progress*disp*(1.0+colorSeparation)).b,1.0);gl_FragColor=texTo*progress+texFrom*inv;}"},{"id":"4268c81d39bd4ca00ae2","name":"CrazyParametricFun","owner":"mandubian","uniforms":{"a":4.0,"b":1.0,"amplitude":120.0,"smoothness":0.1},"html_url":"https://gist.github.com/4268c81d39bd4ca00ae2","created_at":"2014-05-19T08:04:52Z","updated_at":"2014-10-10T02:56:15Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;uniform float a;uniform float b;uniform float amplitude;uniform float smoothness;void main(){vec2 p=gl_FragCoord.xy/resolution.xy;vec2 dir=p-vec2(.5);float dist=length(dir);float x=(a-b)*cos(progress)+b*cos(progress*((a/b)-1.));float y=(a-b)*sin(progress)-b*sin(progress*((a/b)-1.));vec2 offset=dir*vec2(sin(progress*dist*amplitude*x),sin(progress*dist*amplitude*y))/smoothness;gl_FragColor=mix(texture2D(from,p+offset),texture2D(to,p),smoothstep(0.2,1.0,progress));}"},{"id":"2bcfb59096fcaed82355","name":"powerdisformation","owner":"gre","uniforms":{"power":3.0,"powerDest":true},"html_url":"https://gist.github.com/2bcfb59096fcaed82355","created_at":"2014-05-17T10:58:29Z","updated_at":"2014-10-10T02:59:31Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from,to;uniform float progress;uniform vec2 resolution;uniform float power;uniform bool powerDest;void main(){vec2 p=gl_FragCoord.xy/resolution.xy;vec2 p2=mix(p,vec2(pow(p.x,power),pow(p.y,power)),(powerDest?0.5:1.0)-distance(progress,powerDest?0.5:1.0));gl_FragColor=mix(texture2D(from,p2),texture2D(to,powerDest?p2:p),progress);}"},{"id":"2a3f2e907e1c0a152e60","name":"swap","owner":"gre","uniforms":{"reflection":0.4,"perspective":0.2,"depth":3.0},"html_url":"https://gist.github.com/2a3f2e907e1c0a152e60","created_at":"2014-05-16T13:59:07Z","updated_at":"2014-10-10T02:54:46Z","stars":1.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from;uniform sampler2D to;uniform float progress;uniform vec2 resolution;uniform float reflection;uniform float perspective;uniform float depth;const vec4 black=vec4(0.0,0.0,0.0,1.0);const vec2 boundMin=vec2(0.0,0.0);const vec2 boundMax=vec2(1.0,1.0);bool inBounds(vec2 p){return all(lessThan(boundMin,p))&&all(lessThan(p,boundMax));}vec2 project(vec2 p){return p*vec2(1.0,-1.2)+vec2(0.0,-0.02);}vec4 bgColor(vec2 p,vec2 pfr,vec2 pto){vec4 c=black;pfr=project(pfr);if(inBounds(pfr)){c+=mix(black,texture2D(from,pfr),reflection*mix(1.0,0.0,pfr.y));}pto=project(pto);if(inBounds(pto)){c+=mix(black,texture2D(to,pto),reflection*mix(1.0,0.0,pto.y));}return c;}void main(){vec2 p=gl_FragCoord.xy/resolution.xy;vec2 pfr,pto=vec2(-1.);float size=mix(1.0,depth,progress);float persp=perspective*progress;pfr=(p+vec2(-0.0,-0.5))*vec2(size/(1.0-perspective*progress),size/(1.0-size*persp*p.x))+vec2(0.0,0.5);size=mix(1.0,depth,1.-progress);persp=perspective*(1.-progress);pto=(p+vec2(-1.0,-0.5))*vec2(size/(1.0-perspective*(1.0-progress)),size/(1.0-size*persp*(0.5-p.x)))+vec2(1.0,0.5);bool fromOver=progress<0.5;if(fromOver){if(inBounds(pfr)){gl_FragColor=texture2D(from,pfr);}else if(inBounds(pto)){gl_FragColor=texture2D(to,pto);}else{gl_FragColor=bgColor(p,pfr,pto);}}else{if(inBounds(pto)){gl_FragColor=texture2D(to,pto);}else if(inBounds(pfr)){gl_FragColor=texture2D(from,pfr);}else{gl_FragColor=bgColor(p,pfr,pto);}}}"},{"id":"94ffa2725b65aa8b9979","name":"ripple","owner":"gre","uniforms":{"amplitude":100.0,"speed":50.0},"html_url":"https://gist.github.com/94ffa2725b65aa8b9979","created_at":"2014-05-16T13:58:42Z","updated_at":"2014-10-10T02:53:21Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from;uniform sampler2D to;uniform float progress;uniform vec2 resolution;uniform float amplitude;uniform float speed;void main(){vec2 p=gl_FragCoord.xy/resolution.xy;vec2 dir=p-vec2(.5);float dist=length(dir);vec2 offset=dir*(sin(progress*dist*amplitude-progress*speed)+.5)/30.;gl_FragColor=mix(texture2D(from,p+offset),texture2D(to,p),smoothstep(0.2,1.0,progress));}"},{"id":"99bced7d9b5311fd166e","name":"flash","owner":"gre","uniforms":{"flashPhase":0.3,"flashIntensity":3.0,"flashZoomEffect":0.5},"html_url":"https://gist.github.com/99bced7d9b5311fd166e","created_at":"2014-05-16T13:58:17Z","updated_at":"2014-10-10T02:53:01Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from;uniform sampler2D to;uniform float progress;uniform vec2 resolution;uniform float flashPhase;uniform float flashIntensity;uniform float flashZoomEffect;const vec3 flashColor=vec3(1.0,0.8,0.3);const float flashVelocity=3.0;void main(){vec2 p=gl_FragCoord.xy/resolution.xy;vec4 fc=texture2D(from,p);vec4 tc=texture2D(to,p);float intensity=mix(1.0,2.0*distance(p,vec2(0.5,0.5)),flashZoomEffect)*flashIntensity*pow(smoothstep(flashPhase,0.0,distance(0.5,progress)),flashVelocity);vec4 c=mix(texture2D(from,p),texture2D(to,p),smoothstep(0.5*(1.0-flashPhase),0.5*(1.0+flashPhase),progress));c+=intensity*vec4(flashColor,1.0);gl_FragColor=c;}"},{"id":"81c6f2e6fce88f9075d2","name":"flyeye","owner":"gre","uniforms":{"size":0.04,"zoom":30.0,"colorSeparation":0.3},"html_url":"https://gist.github.com/81c6f2e6fce88f9075d2","created_at":"2014-05-16T13:56:53Z","updated_at":"2014-10-10T02:56:18Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from;uniform sampler2D to;uniform float progress;uniform vec2 resolution;uniform float size;uniform float zoom;uniform float colorSeparation;void main(){vec2 p=gl_FragCoord.xy/resolution.xy;float inv=1.-progress;vec2 disp=size*vec2(cos(zoom*p.x),sin(zoom*p.y));vec4 texTo=texture2D(to,p+inv*disp);vec4 texFrom=vec4(texture2D(from,p+progress*disp*(1.0-colorSeparation)).r,texture2D(from,p+progress*disp).g,texture2D(from,p+progress*disp*(1.0+colorSeparation)).b,1.0);gl_FragColor=texTo*progress+texFrom*inv;}"},{"id":"979934722820b5e715fa","name":"doorway","owner":"gre","uniforms":{"reflection":0.4,"perspective":0.4,"depth":3.0},"html_url":"https://gist.github.com/979934722820b5e715fa","created_at":"2014-05-16T13:54:38Z","updated_at":"2014-10-10T02:51:28Z","stars":1.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from;uniform sampler2D to;uniform float progress;uniform vec2 resolution;uniform float reflection;uniform float perspective;uniform float depth;const vec4 black=vec4(0.0,0.0,0.0,1.0);const vec2 boundMin=vec2(0.0,0.0);const vec2 boundMax=vec2(1.0,1.0);bool inBounds(vec2 p){return all(lessThan(boundMin,p))&&all(lessThan(p,boundMax));}vec2 project(vec2 p){return p*vec2(1.0,-1.2)+vec2(0.0,-0.02);}vec4 bgColor(vec2 p,vec2 pto){vec4 c=black;pto=project(pto);if(inBounds(pto)){c+=mix(black,texture2D(to,pto),reflection*mix(1.0,0.0,pto.y));}return c;}void main(){vec2 p=gl_FragCoord.xy/resolution.xy;vec2 pfr=vec2(-1.),pto=vec2(-1.);float middleSlit=2.0*abs(p.x-0.5)-progress;if(middleSlit>0.0){pfr=p+(p.x>0.5?-1.0:1.0)*vec2(0.5*progress,0.0);float d=1.0/(1.0+perspective*progress*(1.0-middleSlit));pfr.y-=d/2.;pfr.y*=d;pfr.y+=d/2.;}float size=mix(1.0,depth,1.-progress);pto=(p+vec2(-0.5,-0.5))*vec2(size,size)+vec2(0.5,0.5);if(inBounds(pfr)){gl_FragColor=texture2D(from,pfr);}else if(inBounds(pto)){gl_FragColor=texture2D(to,pto);}else{gl_FragColor=bgColor(p,pto);}}"},{"id":"731fcad4f8956866f34a","name":"randomsquares","owner":"gre","uniforms":{"size":[10.0,10.0],"smoothness":0.5},"html_url":"https://gist.github.com/731fcad4f8956866f34a","created_at":"2014-05-16T13:52:46Z","updated_at":"2014-10-10T02:58:06Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from;uniform sampler2D to;uniform float progress;uniform vec2 resolution;uniform ivec2 size;uniform float smoothness;float rand(vec2 co){return fract(sin(dot(co.xy,vec2(12.9898,78.233)))*43758.5453);}void main(){vec2 p=gl_FragCoord.xy/resolution.xy;float r=rand(floor(vec2(size)*p));float m=smoothstep(0.0,-smoothness,r-(progress*(1.0+smoothness)));gl_FragColor=mix(texture2D(from,p),texture2D(to,p),m);}"},{"id":"df8797fd112e8e429064","name":"squeeze","owner":"gre","uniforms":{"colorSeparation":0.02},"html_url":"https://gist.github.com/df8797fd112e8e429064","created_at":"2014-05-16T13:51:39Z","updated_at":"2014-10-10T02:54:07Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from;uniform sampler2D to;uniform float progress;uniform vec2 resolution;uniform float colorSeparation;float progressY(float y){return 0.5+(y-0.5)/(1.0-progress);}void main(){vec2 p=gl_FragCoord.xy/resolution.xy;float y=progressY(p.y);if(y<0.0||y>1.0){gl_FragColor=texture2D(to,p);}else{vec2 fp=vec2(p.x,y);vec3 c=vec3(texture2D(from,fp-progress*vec2(0.0,colorSeparation)).r,texture2D(from,fp).g,texture2D(from,fp+progress*vec2(0.0,colorSeparation)).b);gl_FragColor=vec4(c,1.0);}}"},{"id":"90000743fedc953f11a4","name":"directionalwipe","owner":"gre","uniforms":{"direction":[1.0,-1.0],"smoothness":0.5},"html_url":"https://gist.github.com/90000743fedc953f11a4","created_at":"2014-05-16T13:50:51Z","updated_at":"2014-10-10T02:57:11Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from;uniform sampler2D to;uniform float progress;uniform vec2 resolution;uniform vec2 direction;uniform float smoothness;const vec2 center=vec2(0.5,0.5);void main(){vec2 p=gl_FragCoord.xy/resolution.xy;vec2 v=normalize(direction);v/=abs(v.x)+abs(v.y);float d=v.x*center.x+v.y*center.y;float m=smoothstep(-smoothness,0.0,v.x*p.x+v.y*p.y-(d-0.5+progress*(1.+smoothness)));gl_FragColor=mix(texture2D(to,p),texture2D(from,p),m);}"},{"id":"7de3f4b9482d2b0bf7bb","name":"wind","owner":"gre","uniforms":{"size":0.2},"html_url":"https://gist.github.com/7de3f4b9482d2b0bf7bb","created_at":"2014-05-16T13:49:36Z","updated_at":"2014-10-10T02:56:22Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from;uniform sampler2D to;uniform float progress;uniform vec2 resolution;uniform float size;float rand(vec2 co){return fract(sin(dot(co.xy,vec2(12.9898,78.233)))*43758.5453);}void main(){vec2 p=gl_FragCoord.xy/resolution.xy;float r=rand(vec2(0,p.y));float m=smoothstep(0.0,-size,p.x*(1.0-size)+size*r-(progress*(1.0+size)));gl_FragColor=mix(texture2D(from,p),texture2D(to,p),m);}"},{"id":"d9f8b4df19584f1f0474","name":"fadegrayscale","owner":"gre","uniforms":{"grayPhase":0.3},"html_url":"https://gist.github.com/d9f8b4df19584f1f0474","created_at":"2014-05-16T13:49:13Z","updated_at":"2014-10-10T02:53:18Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from;uniform sampler2D to;uniform float progress;uniform vec2 resolution;uniform float grayPhase;vec3 grayscale(vec3 color){return vec3(0.2126*color.r+0.7152*color.g+0.0722*color.b);}void main(){vec2 p=gl_FragCoord.xy/resolution.xy;vec4 fc=texture2D(from,p);vec4 tc=texture2D(to,p);gl_FragColor=mix(mix(vec4(grayscale(fc.rgb),1.0),texture2D(from,p),smoothstep(1.0-grayPhase,0.0,progress)),mix(vec4(grayscale(tc.rgb),1.0),texture2D(to,p),smoothstep(grayPhase,1.0,progress)),progress);}"},{"id":"206b96128ad6085f9911","name":"dispersionblur","owner":"gre","uniforms":{"size":0.6},"html_url":"https://gist.github.com/206b96128ad6085f9911","created_at":"2014-05-16T13:47:09Z","updated_at":"2014-10-10T02:57:34Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\n\n#define QUALITY 32\nuniform sampler2D from;uniform sampler2D to;uniform float progress;uniform vec2 resolution;uniform float size;const float GOLDEN_ANGLE=2.399963229728653;vec4 blur(sampler2D t,vec2 c,float radius){vec4 sum=vec4(0.0);float q=float(QUALITY);for(int i=0;i<QUALITY;++i){float fi=float(i);float a=fi*GOLDEN_ANGLE;float r=sqrt(fi/q)*radius;vec2 p=c+r*vec2(cos(a),sin(a));sum+=texture2D(t,p);}return sum/q;}void main(){vec2 p=gl_FragCoord.xy/resolution.xy;float inv=1.-progress;gl_FragColor=inv*blur(from,p,progress*size)+progress*blur(to,p,inv*size);}"},{"id":"d71472a550601b96d69d","name":"heartwipe","owner":"gre","uniforms":{},"html_url":"https://gist.github.com/d71472a550601b96d69d","created_at":"2014-05-16T13:46:31Z","updated_at":"2014-10-10T02:55:55Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from;uniform sampler2D to;uniform float progress;uniform vec2 resolution;bool inHeart(vec2 p,vec2 center,float size){if(size==0.0) return false;vec2 o=(p-center)/(1.6*size);return pow(o.x*o.x+o.y*o.y-0.3,3.0)<o.x*o.x*pow(o.y,3.0);}void main(){vec2 p=gl_FragCoord.xy/resolution.xy;float m=inHeart(p,vec2(0.5,0.4),progress)?1.0:0.0;gl_FragColor=mix(texture2D(from,p),texture2D(to,p),m);}"},{"id":"f24651a01bf574e90122","name":"fadecolor","owner":"gre","uniforms":{"color":[0.0,0.0,0.0],"colorPhase":0.4},"html_url":"https://gist.github.com/f24651a01bf574e90122","created_at":"2014-05-16T13:45:46Z","updated_at":"2014-10-10T02:53:57Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from;uniform sampler2D to;uniform float progress;uniform vec2 resolution;uniform vec3 color;uniform float colorPhase;void main(){vec2 p=gl_FragCoord.xy/resolution.xy;gl_FragColor=mix(mix(vec4(color,1.0),texture2D(from,p),smoothstep(1.0-colorPhase,0.0,progress)),mix(vec4(color,1.0),texture2D(to,p),smoothstep(colorPhase,1.0,progress)),progress);}"},{"id":"35e8c18557995c77278e","name":"circleopen","owner":"gre","uniforms":{"smoothness":0.3,"opening":true},"html_url":"https://gist.github.com/35e8c18557995c77278e","created_at":"2014-05-16T13:40:51Z","updated_at":"2014-10-10T02:58:28Z","stars":0.0,"glsl":"\n#ifdef GL_ES\nprecision highp float;\n#endif\nuniform sampler2D from;uniform sampler2D to;uniform float progress;uniform vec2 resolution;uniform float smoothness;uniform bool opening;const vec2 center=vec2(0.5,0.5);const float SQRT_2=1.414213562373;void main(){vec2 p=gl_FragCoord.xy/resolution.xy;float x=opening?progress:1.-progress;float m=smoothstep(-smoothness,0.0,SQRT_2*distance(center,p)-x*(1.+smoothness));gl_FragColor=mix(texture2D(from,p),texture2D(to,p),opening?1.-m:m);}"}]
},{}]},{},[25]);
