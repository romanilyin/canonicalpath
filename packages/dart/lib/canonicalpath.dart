library canonicalpath_dart;

import 'dart:convert';

class CanonicalPathError implements Exception {
  final String code;
  final String message;

  const CanonicalPathError(this.code, this.message);

  @override
  String toString() => '$code: $message';
}

String errorCode(Object error) {
  if (error is CanonicalPathError) return error.code;
  return 'ERR_INVALID_PATH';
}

String normalize(String raw, [Map<String, dynamic>? options]) {
  final opts = options ?? const <String, dynamic>{};
  if (_optionBool(opts, 'trimOuterWhitespace', false)) raw = raw.trim();
  if (raw.isEmpty) throw _pathError('ERR_EMPTY_PATH', 'path is empty');
  if (_hasNul(raw)) throw _pathError('ERR_NUL_BYTE', 'path contains NUL');

  var value = raw;
  if (_hasUriScheme(value) ||
      _option(opts, 'sourceHost') == 'vscode-file-uri') {
    value = _parseFileUri(value, opts);
  }
  if (_hasNul(value)) throw _pathError('ERR_NUL_BYTE', 'path contains NUL');
  if (!_optionBool(_nested(opts, 'windows'), 'preserveExtendedLength', false)) {
    value = _unwrapWindowsExtendedPrefix(value);
  }
  value = value.replaceAll('\\', '/');

  final targetProfile = _option(opts, 'targetProfile');
  if (targetProfile != 'posix')
    value = _mapWslDrive(value, _nested(opts, 'wsl'));
  if (_isUriWindowsDrivePath(value)) value = value.substring(1);

  if (_isDriveRelative(value)) {
    throw _pathError(
      'ERR_DRIVE_RELATIVE_PATH',
      'Windows drive-relative paths are not canonical',
    );
  }
  if (_hasDriveRoot(value)) value = value[0].toLowerCase() + value.substring(1);

  final windows = _nested(opts, 'windows');
  if (_optionBool(windows, 'rejectADS', false) && _hasWindowsAds(value)) {
    throw _pathError(
      'ERR_ALTERNATE_DATA_STREAM',
      'Windows alternate data stream is not allowed',
    );
  }
  if (_optionBool(windows, 'rejectDeviceNames', false) &&
      _hasReservedDeviceName(value)) {
    throw _pathError(
      'ERR_RESERVED_DEVICE_NAME',
      'Windows reserved device name is not allowed',
    );
  }

  final cleaned = _cleanCanonical(value);
  _validateTargetProfile(cleaned, targetProfile);
  return cleaned;
}

String relative(String root, String target) {
  final rootParts = _canonicalParts(root);
  final targetParts = _canonicalParts(target);
  if (rootParts.prefix != targetParts.prefix ||
      targetParts.parts.length < rootParts.parts.length) {
    throw _pathError('ERR_OUTSIDE_ROOT', 'target is outside root');
  }
  for (var index = 0; index < rootParts.parts.length; index++) {
    if (rootParts.parts[index] != targetParts.parts[index]) {
      throw _pathError('ERR_OUTSIDE_ROOT', 'target is outside root');
    }
  }
  if (targetParts.parts.length == rootParts.parts.length) return '.';
  return targetParts.parts.sublist(rootParts.parts.length).join('/');
}

String join(String root, String relativePath) {
  final cleanRelative = normalizeRelative(relativePath);
  if (_hasNul(root)) throw _pathError('ERR_NUL_BYTE', 'root contains NUL');
  if (cleanRelative == '.') return root;
  if (root == '/' || root.endsWith('/')) return root + cleanRelative;
  return '$root/$cleanRelative';
}

String joinParts(List<String> parts) {
  var result = '';
  for (final part in parts) {
    if (part.isEmpty) continue;
    result = result.isEmpty ? part : join(result, part);
  }
  if (result.isEmpty)
    throw _pathError('ERR_EMPTY_PATH', 'join parts are empty');
  return result;
}

String normalizeRelative(String raw) {
  if (raw.isEmpty) throw _pathError('ERR_EMPTY_PATH', 'relative path is empty');
  if (raw == '.') return '.';
  if (_hasNul(raw))
    throw _pathError('ERR_NUL_BYTE', 'relative path contains NUL');
  if (_isAbsolutePathLike(raw)) {
    throw _pathError('ERR_ABSOLUTE_PATH', 'relative path must not be absolute');
  }
  if (_isDriveRelative(raw)) {
    throw _pathError(
      'ERR_DRIVE_RELATIVE_PATH',
      'drive-relative path is not allowed',
    );
  }
  if (raw.contains('\\')) {
    throw _pathError(
      'ERR_INVALID_PATH',
      'relative path must use slash separators',
    );
  }

  final parts = <String>[];
  for (final part in raw.split('/')) {
    if (part.isEmpty || part == '.') continue;
    if (part == '..') {
      if (parts.isEmpty)
        throw _pathError('ERR_OUTSIDE_ROOT', 'relative path escapes root');
      parts.removeLast();
      continue;
    }
    parts.add(part);
  }
  if (parts.isEmpty)
    throw _pathError('ERR_EMPTY_PATH', 'relative path is empty after cleaning');
  return parts.join('/');
}

bool isEqual(String left, String right, [Map<String, dynamic>? options]) {
  return normalize(left, options) == normalize(right, options);
}

String toWin32(String canonical) {
  if (_hasNul(canonical)) throw _pathError('ERR_NUL_BYTE', 'path contains NUL');
  if (_hasDriveRoot(canonical)) {
    return '${canonical[0].toUpperCase()}:\\${canonical.substring(3).replaceAll('/', '\\')}';
  }
  if (canonical.startsWith('//'))
    return '\\\\${canonical.substring(2).replaceAll('/', '\\')}';
  return canonical.replaceAll('/', '\\');
}

String toWSL(String canonical, [Map<String, dynamic>? options]) {
  final opts = options ?? const <String, dynamic>{};
  if (_hasNul(canonical)) throw _pathError('ERR_NUL_BYTE', 'path contains NUL');
  if (!_hasDriveRoot(canonical)) return canonical;
  final mountRoot = _rstripSlashes(
    (_option(opts, 'mountRoot') ?? '/mnt').toString(),
  );
  var result = '$mountRoot/${canonical[0].toLowerCase()}';
  final rest = canonical.substring(3);
  if (rest.isNotEmpty) result += '/$rest';
  return result;
}

String toPOSIX(String canonical) {
  if (_hasNul(canonical)) throw _pathError('ERR_NUL_BYTE', 'path contains NUL');
  if (_hasDriveRoot(canonical)) {
    throw _pathError(
      'ERR_INVALID_PATH',
      'win32 drive paths require an explicit host mapping such as to_wsl',
    );
  }
  if (canonical.contains('\\')) {
    throw _pathError(
      'ERR_INVALID_PATH',
      'canonical paths must use slash separators',
    );
  }
  return canonical;
}

String sanitizeComponent(String name, String profile) {
  if (name.isEmpty)
    throw _pathError('ERR_INVALID_COMPONENT', 'component is empty');
  if (_hasNul(name)) throw _pathError('ERR_NUL_BYTE', 'component contains NUL');
  var value = name
      .replaceAll(RegExp(r'[\\/:\t\n\r]+'), '-')
      .replaceAll(RegExp(r'^[ ._-]+|[ ._-]+$'), '');
  if (value.isEmpty) value = 'component';
  if (profile == 'win32') value = _escapeReservedWin32Component(value);
  return value;
}

String encodeComponent(String name, String profile) =>
    sanitizeComponent(name, profile);

String encodeGitRef(String raw) {
  if (raw.isEmpty)
    throw _pathError('ERR_INVALID_COMPONENT', 'git ref is empty');
  if (_hasNul(raw)) throw _pathError('ERR_NUL_BYTE', 'git ref contains NUL');
  final slug = raw
      .replaceAll(RegExp(r'[^A-Za-z0-9._-]+'), '-')
      .replaceAll(RegExp(r'^[._-]+|[._-]+$'), '');
  final safeSlug = slug.isEmpty ? 'ref' : slug;
  return '$safeSlug--${_sha256Hex(utf8.encode(raw)).substring(0, 12)}';
}

CanonicalPathError _pathError(String code, String message) =>
    CanonicalPathError(code, message);

Object? _option(
  Map<String, dynamic> options,
  String key, [
  Object? defaultValue,
]) {
  return options.containsKey(key) ? options[key] : defaultValue;
}

bool _optionBool(Map<String, dynamic> options, String key, bool defaultValue) {
  final value = _option(options, key);
  return value is bool ? value : defaultValue;
}

Map<String, dynamic> _nested(Map<String, dynamic> options, String key) {
  final value = options[key];
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return Map<String, dynamic>.from(value);
  return const <String, dynamic>{};
}

bool _hasNul(String value) => value.contains('\x00');

bool _isAsciiLetter(String value) {
  if (value.length != 1) return false;
  final code = value.codeUnitAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

bool _hasDriveRoot(String value) {
  return value.length >= 3 &&
      _isAsciiLetter(value[0]) &&
      value[1] == ':' &&
      value[2] == '/';
}

bool _isDriveRelative(String value) {
  return value.length >= 2 &&
      _isAsciiLetter(value[0]) &&
      value[1] == ':' &&
      (value.length == 2 || value[2] != '/');
}

bool _isUriWindowsDrivePath(String value) {
  return value.length >= 4 &&
      value[0] == '/' &&
      _isAsciiLetter(value[1]) &&
      value[2] == ':' &&
      value[3] == '/';
}

bool _isAbsolutePathLike(String value) {
  return value.startsWith('/') ||
      value.startsWith('\\\\') ||
      _hasDriveRoot(value.replaceAll('\\', '/'));
}

bool _hasUriScheme(String value) {
  final index = value.indexOf('://');
  if (index <= 0) return false;
  return RegExp(
    r'^[A-Za-z][A-Za-z0-9+.-]*$',
  ).hasMatch(value.substring(0, index));
}

String _unwrapWindowsExtendedPrefix(String value) {
  if (value.startsWith('\\\\?\\UNC\\'))
    return '\\\\${value.substring('\\\\?\\UNC\\'.length)}';
  if (value.startsWith('\\\\?\\')) return value.substring('\\\\?\\'.length);
  return value;
}

String _percentDecode(String value) {
  final bytes = <int>[];
  var index = 0;
  while (index < value.length) {
    final char = value[index];
    if (char != '%') {
      bytes.addAll(utf8.encode(char));
      index += 1;
      continue;
    }
    if (index + 2 >= value.length) {
      throw _pathError(
        'ERR_INVALID_PERCENT_ENCODING',
        'URI percent encoding is invalid',
      );
    }
    final pair = value.substring(index + 1, index + 3);
    if (!RegExp(r'^[0-9A-Fa-f]{2}$').hasMatch(pair)) {
      throw _pathError(
        'ERR_INVALID_PERCENT_ENCODING',
        'URI percent encoding is invalid',
      );
    }
    bytes.add(int.parse(pair, radix: 16));
    index += 3;
  }
  try {
    return utf8.decode(bytes);
  } on FormatException catch (_) {
    throw _pathError(
      'ERR_INVALID_PERCENT_ENCODING',
      'URI percent encoding is invalid',
    );
  }
}

bool _hasEncodedSeparator(String value) =>
    RegExp(r'%(?:2[fF]|5[cC])').hasMatch(value);

String _parseHierarchicalUriPath(
  String raw,
  String prefix,
  Map<String, dynamic> options,
) {
  final uri = _nested(options, 'uri');
  if (_optionBool(uri, 'rejectEncodedSlash', true) &&
      _hasEncodedSeparator(raw)) {
    throw _pathError(
      'ERR_ENCODED_SEPARATOR',
      'URI contains an encoded path separator',
    );
  }

  final rest = raw.substring(prefix.length);
  final slash = rest.indexOf('/');
  if (slash < 0) throw _pathError('ERR_INVALID_URI', 'URI path is empty');
  final decodedAuthority = _percentDecode(rest.substring(0, slash));
  final decodedPath = _percentDecode(rest.substring(slash));
  if (decodedPath.isEmpty)
    throw _pathError('ERR_INVALID_URI', 'URI path is empty');
  if (prefix == 'file://' &&
      decodedAuthority.isNotEmpty &&
      decodedAuthority.toLowerCase() != 'localhost') {
    return '//$decodedAuthority$decodedPath';
  }
  return decodedPath;
}

String _parseFileUri(String uri, Map<String, dynamic> options) {
  if (_hasNul(uri)) throw _pathError('ERR_NUL_BYTE', 'URI contains NUL');
  final uriOptions = _nested(options, 'uri');
  if (uri.startsWith('file://')) {
    if (!_optionBool(uriOptions, 'allowFileUri', false)) {
      throw _pathError('ERR_UNSUPPORTED_URI_SCHEME', 'file URI is not allowed');
    }
    return _parseHierarchicalUriPath(uri, 'file://', options);
  }
  if (uri.startsWith('vscode-file://')) {
    if (!_optionBool(uriOptions, 'allowVSCodeFileUri', false)) {
      throw _pathError(
        'ERR_UNSUPPORTED_URI_SCHEME',
        'vscode-file URI is not allowed',
      );
    }
    return _parseHierarchicalUriPath(uri, 'vscode-file://', options);
  }
  if (_hasUriScheme(uri))
    throw _pathError('ERR_UNSUPPORTED_URI_SCHEME', 'unsupported URI scheme');
  return uri;
}

String _mapWslDrive(String value, Map<String, dynamic> options) {
  if (!_optionBool(options, 'enabled', false)) return value;
  final mountRoot = _rstripSlashes(
    (_option(options, 'mountRoot') ?? '/mnt').toString(),
  );
  final prefix = '$mountRoot/';
  if (!value.startsWith(prefix)) return value;
  final rest = value.substring(prefix.length);
  if (rest.isEmpty || !_isAsciiLetter(rest[0])) return value;
  if (rest.length > 1 && rest[1] != '/') return value;
  if (rest.length == 1) return '${rest[0].toLowerCase()}:/';
  return '${rest[0].toLowerCase()}:/${rest.substring(2)}';
}

String _rstripSlashes(String value) => value.replaceAll(RegExp(r'/+$'), '');

_Root _splitRoot(String value) {
  if (_hasDriveRoot(value))
    return _Root(value.substring(0, 3), value.substring(3));
  if (value.startsWith('//')) {
    final rest = value.substring(2);
    final first = rest.indexOf('/');
    if (first <= 0)
      throw _pathError(
        'ERR_INVALID_PATH',
        'UNC path requires server and share',
      );
    final server = rest.substring(0, first);
    final afterFirst = rest.substring(first + 1);
    final second = afterFirst.indexOf('/');
    final share = second >= 0 ? afterFirst.substring(0, second) : afterFirst;
    final tail = second >= 0 ? afterFirst.substring(second + 1) : '';
    if (share.isEmpty)
      throw _pathError(
        'ERR_INVALID_PATH',
        'UNC path requires server and share',
      );
    return _Root('//$server/$share', tail);
  }
  if (value.startsWith('/')) return _Root('/', value.substring(1));
  return _Root('', value);
}

String _cleanCanonical(String value) {
  if (value.isEmpty) throw _pathError('ERR_EMPTY_PATH', 'path is empty');
  final root = _splitRoot(value);
  final parts = <String>[];
  for (final part in root.rest.split('/')) {
    if (part.isEmpty || part == '.') continue;
    if (part == '..') {
      if (parts.isNotEmpty) {
        parts.removeLast();
        continue;
      }
      if (root.prefix.isNotEmpty) continue;
      throw _pathError(
        'ERR_INVALID_PATH',
        'relative path escapes above its root',
      );
    }
    parts.add(part);
  }

  final joined = parts.join('/');
  if (root.prefix.isEmpty) return joined.isEmpty ? '.' : joined;
  if (root.prefix == '/') return joined.isEmpty ? '/' : '/$joined';
  if (root.prefix.endsWith('/'))
    return joined.isEmpty ? root.prefix : '${root.prefix}$joined';
  return joined.isEmpty ? root.prefix : '${root.prefix}/$joined';
}

void _validateTargetProfile(String value, Object? targetProfile) {
  if (targetProfile == null || targetProfile == 'portable') return;
  if (targetProfile == 'posix') {
    if (_hasDriveRoot(value) || value.startsWith('//')) {
      throw _pathError(
        'ERR_INVALID_PATH',
        'targetProfile posix does not allow Windows drive or UNC roots',
      );
    }
    return;
  }
  if (targetProfile == 'win32-drive') {
    if (value.startsWith('/')) {
      throw _pathError(
        'ERR_INVALID_PATH',
        'targetProfile win32-drive does not allow POSIX or UNC roots',
      );
    }
    return;
  }
  throw _pathError('ERR_INVALID_PATH', 'unsupported targetProfile');
}

_CanonicalParts _canonicalParts(String value) {
  if (_hasNul(value)) throw _pathError('ERR_NUL_BYTE', 'path contains NUL');
  final root = _splitRoot(value);
  if (root.prefix.isEmpty)
    throw _pathError('ERR_INVALID_PATH', 'path must be canonical absolute');
  final parts = root.rest.split('/').where((part) => part.isNotEmpty).toList();
  if (parts.any((part) => part == '.' || part == '..')) {
    throw _pathError('ERR_INVALID_PATH', 'path is not lexically cleaned');
  }
  return _CanonicalParts(root.prefix, parts);
}

bool _hasWindowsAds(String value) {
  var start = _hasDriveRoot(value) ? 3 : 0;
  if (value.startsWith('//')) {
    try {
      start = _splitRoot(value).prefix.length;
    } on CanonicalPathError catch (_) {
      start = 0;
    }
  }
  return value.substring(start).contains(':');
}

bool _hasReservedDeviceName(String value) {
  String rest;
  try {
    rest = _splitRoot(value).rest;
  } on CanonicalPathError catch (_) {
    return false;
  }
  for (final part in rest.split('/')) {
    if (part.isEmpty || part == '.' || part == '..') continue;
    final base = part.split(RegExp(r'[.:]')).first.toUpperCase();
    if (_isReservedDeviceBase(base)) return true;
  }
  return false;
}

bool _isReservedDeviceBase(String base) {
  final upper = base.toUpperCase();
  if (upper == 'CON' || upper == 'PRN' || upper == 'AUX' || upper == 'NUL')
    return true;
  return RegExp(r'^(COM|LPT)[1-9]$').hasMatch(upper);
}

String _escapeReservedWin32Component(String value) {
  final dot = value.indexOf('.');
  final base = dot >= 0 ? value.substring(0, dot) : value;
  final suffix = dot >= 0 ? value.substring(dot) : '';
  if (_isReservedDeviceBase(base)) return '$base-$suffix';
  return value;
}

String _sha256Hex(List<int> input) {
  final digest = _sha256(input);
  return digest.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join();
}

List<int> _sha256(List<int> input) {
  const mask = 0xffffffff;
  const k = <int>[
    0x428a2f98,
    0x71374491,
    0xb5c0fbcf,
    0xe9b5dba5,
    0x3956c25b,
    0x59f111f1,
    0x923f82a4,
    0xab1c5ed5,
    0xd807aa98,
    0x12835b01,
    0x243185be,
    0x550c7dc3,
    0x72be5d74,
    0x80deb1fe,
    0x9bdc06a7,
    0xc19bf174,
    0xe49b69c1,
    0xefbe4786,
    0x0fc19dc6,
    0x240ca1cc,
    0x2de92c6f,
    0x4a7484aa,
    0x5cb0a9dc,
    0x76f988da,
    0x983e5152,
    0xa831c66d,
    0xb00327c8,
    0xbf597fc7,
    0xc6e00bf3,
    0xd5a79147,
    0x06ca6351,
    0x14292967,
    0x27b70a85,
    0x2e1b2138,
    0x4d2c6dfc,
    0x53380d13,
    0x650a7354,
    0x766a0abb,
    0x81c2c92e,
    0x92722c85,
    0xa2bfe8a1,
    0xa81a664b,
    0xc24b8b70,
    0xc76c51a3,
    0xd192e819,
    0xd6990624,
    0xf40e3585,
    0x106aa070,
    0x19a4c116,
    0x1e376c08,
    0x2748774c,
    0x34b0bcb5,
    0x391c0cb3,
    0x4ed8aa4a,
    0x5b9cca4f,
    0x682e6ff3,
    0x748f82ee,
    0x78a5636f,
    0x84c87814,
    0x8cc70208,
    0x90befffa,
    0xa4506ceb,
    0xbef9a3f7,
    0xc67178f2,
  ];

  var h0 = 0x6a09e667;
  var h1 = 0xbb67ae85;
  var h2 = 0x3c6ef372;
  var h3 = 0xa54ff53a;
  var h4 = 0x510e527f;
  var h5 = 0x9b05688c;
  var h6 = 0x1f83d9ab;
  var h7 = 0x5be0cd19;

  final message = List<int>.from(input);
  final bitLength = message.length * 8;
  message.add(0x80);
  while ((message.length % 64) != 56) {
    message.add(0);
  }
  for (var shift = 56; shift >= 0; shift -= 8) {
    message.add((bitLength >> shift) & 0xff);
  }

  for (var offset = 0; offset < message.length; offset += 64) {
    final w = List<int>.filled(64, 0);
    for (var index = 0; index < 16; index++) {
      final base = offset + index * 4;
      w[index] =
          ((message[base] << 24) |
              (message[base + 1] << 16) |
              (message[base + 2] << 8) |
              message[base + 3]) &
          mask;
    }
    for (var index = 16; index < 64; index++) {
      final s0 =
          _rotr(w[index - 15], 7) ^
          _rotr(w[index - 15], 18) ^
          (w[index - 15] >> 3);
      final s1 =
          _rotr(w[index - 2], 17) ^
          _rotr(w[index - 2], 19) ^
          (w[index - 2] >> 10);
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) & mask;
    }

    var a = h0;
    var b = h1;
    var c = h2;
    var d = h3;
    var e = h4;
    var f = h5;
    var g = h6;
    var h = h7;

    for (var index = 0; index < 64; index++) {
      final s1 = _rotr(e, 6) ^ _rotr(e, 11) ^ _rotr(e, 25);
      final ch = (e & f) ^ ((~e) & g);
      final temp1 = (h + s1 + ch + k[index] + w[index]) & mask;
      final s0 = _rotr(a, 2) ^ _rotr(a, 13) ^ _rotr(a, 22);
      final maj = (a & b) ^ (a & c) ^ (b & c);
      final temp2 = (s0 + maj) & mask;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) & mask;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) & mask;
    }

    h0 = (h0 + a) & mask;
    h1 = (h1 + b) & mask;
    h2 = (h2 + c) & mask;
    h3 = (h3 + d) & mask;
    h4 = (h4 + e) & mask;
    h5 = (h5 + f) & mask;
    h6 = (h6 + g) & mask;
    h7 = (h7 + h) & mask;
  }

  final words = [h0, h1, h2, h3, h4, h5, h6, h7];
  final output = <int>[];
  for (final word in words) {
    output.addAll([
      (word >> 24) & 0xff,
      (word >> 16) & 0xff,
      (word >> 8) & 0xff,
      word & 0xff,
    ]);
  }
  return output;
}

int _rotr(int value, int bits) =>
    ((value >> bits) | (value << (32 - bits))) & 0xffffffff;

class _Root {
  final String prefix;
  final String rest;

  const _Root(this.prefix, this.rest);
}

class _CanonicalParts {
  final String prefix;
  final List<String> parts;

  const _CanonicalParts(this.prefix, this.parts);
}
