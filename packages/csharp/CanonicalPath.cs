using System.Security.Cryptography;
using System.Text;

namespace CanonicalPath;

public sealed class CanonicalPathException : ArgumentException
{
    public CanonicalPathException(string code, string message)
        : base(message)
    {
        Code = code;
    }

    public string Code { get; }
}

public sealed class CanonicalPathNormalizeOptions
{
    public string? SourceHost { get; set; }
    public string? TargetProfile { get; set; }
    public CanonicalPathWSLOptions? WSL { get; set; }
    public CanonicalPathURIOptions? URI { get; set; }
    public CanonicalPathWindowsOptions? Windows { get; set; }
    public bool TrimOuterWhitespace { get; set; }
}

public sealed class CanonicalPathWSLOptions
{
    public bool Enabled { get; set; }
    public string? MountRoot { get; set; }
}

public sealed class CanonicalPathURIOptions
{
    public bool AllowFileUri { get; set; }
    public bool AllowVSCodeFileUri { get; set; }
    public bool? RejectEncodedSlash { get; set; }
}

public sealed class CanonicalPathWindowsOptions
{
    public bool PreserveExtendedLength { get; set; }
    public bool RejectDeviceNames { get; set; }
    public bool RejectADS { get; set; }
}

public static class CanonicalPath
{
    public static string Normalize(string raw)
    {
        return Normalize(raw, null);
    }

    public static string Normalize(string raw, CanonicalPathNormalizeOptions? options)
    {
        if (options != null && options.TrimOuterWhitespace && raw != null) raw = raw.Trim();
        if (string.IsNullOrEmpty(raw)) throw PathError("ERR_EMPTY_PATH", "path is empty");
        if (raw.IndexOf('\0') >= 0) throw PathError("ERR_NUL_BYTE", "path contains NUL");

        string value = raw;
        if (HasUriScheme(value) || OptionSourceHost(options) == "vscode-file-uri") value = ParseFileUri(value, options);
        if (!PreserveExtendedLength(options)) value = UnwrapWindowsExtendedPrefix(value);
        value = value.Replace('\\', '/');

        if (OptionTargetProfile(options) != "posix")
        {
            string? mapped = MapWSLDrive(value, options?.WSL);
            if (mapped != null) value = mapped;
        }

        if (IsUriWindowsDrivePath(value)) value = value.Substring(1);
        if (IsDriveRelative(value)) throw PathError("ERR_DRIVE_RELATIVE_PATH", "Windows drive-relative paths are not canonical");
        if (HasDriveRoot(value)) value = char.ToLowerInvariant(value[0]) + value.Substring(1);

        if (RejectADS(options) && HasWindowsADS(value)) throw PathError("ERR_ALTERNATE_DATA_STREAM", "Windows alternate data stream is not allowed");
        if (RejectDeviceNames(options) && HasReservedDeviceName(value)) throw PathError("ERR_RESERVED_DEVICE_NAME", "Windows reserved device name is not allowed");

        string cleaned;
        try
        {
            cleaned = CleanCanonical(value);
        }
        catch (ArgumentException ex)
        {
            if (Contains(ex.Message, "NUL")) throw PathError("ERR_NUL_BYTE", ex.Message);
            if (Contains(ex.Message, "empty")) throw PathError("ERR_EMPTY_PATH", ex.Message);
            throw PathError("ERR_INVALID_PATH", ex.Message);
        }

        ValidateTargetProfile(cleaned, OptionTargetProfile(options));
        return cleaned;
    }

    public static string Relative(string root, string target)
    {
        try
        {
            return RelativeCanonical(root, target);
        }
        catch (ArgumentException ex)
        {
            if (Contains(ex.Message, "outside")) throw PathError("ERR_OUTSIDE_ROOT", ex.Message);
            if (Contains(ex.Message, "NUL")) throw PathError("ERR_NUL_BYTE", ex.Message);
            if (Contains(ex.Message, "empty")) throw PathError("ERR_EMPTY_PATH", ex.Message);
            throw PathError("ERR_INVALID_PATH", ex.Message);
        }
    }

    public static string Join(string root, string relative)
    {
        string cleanRelative = NormalizeRelativePath(relative);
        if (root == null || root.IndexOf('\0') >= 0) throw PathError("ERR_NUL_BYTE", "root contains NUL");
        if (cleanRelative == ".") return root;
        if (root == "/" || root.EndsWith("/", StringComparison.Ordinal)) return root + cleanRelative;
        return root + "/" + cleanRelative;
    }

    public static string Join(params string[] parts)
    {
        if (parts == null || parts.Length == 0) throw new ArgumentException("At least one path part is required.", nameof(parts));
        string value = parts[0];
        for (int i = 1; i < parts.Length; i++) value = value.TrimEnd('/') + "/" + parts[i].TrimStart('/', '\\');
        return CleanCanonical(value);
    }

    public static bool IsEqual(string left, string right, CanonicalPathNormalizeOptions? options = null)
    {
        return string.Equals(Normalize(left, options), Normalize(right, options), StringComparison.Ordinal);
    }

    public static string ToWin32(string canonical)
    {
        if (canonical == null || canonical.IndexOf('\0') >= 0) throw PathError("ERR_NUL_BYTE", "path contains NUL");
        if (HasDriveRoot(canonical)) return char.ToUpperInvariant(canonical[0]) + ":\\" + canonical.Substring(3).Replace('/', '\\');
        if (canonical.StartsWith("//", StringComparison.Ordinal)) return "\\\\" + canonical.Substring(2).Replace('/', '\\');
        return canonical.Replace('/', '\\');
    }

    public static string ToWSL(string canonical, CanonicalPathWSLOptions? options = null)
    {
        if (canonical == null || canonical.IndexOf('\0') >= 0) throw PathError("ERR_NUL_BYTE", "path contains NUL");
        if (!HasDriveRoot(canonical)) return canonical;
        string mountRoot = string.IsNullOrEmpty(options?.MountRoot) ? "/mnt" : options.MountRoot;
        mountRoot = mountRoot.TrimEnd('/');
        string drive = char.ToLowerInvariant(canonical[0]).ToString();
        string rest = canonical.Substring(3);
        if (rest.Length == 0) return mountRoot + "/" + drive;
        return mountRoot + "/" + drive + "/" + rest;
    }

    public static string ToPOSIX(string canonical)
    {
        if (canonical == null || canonical.IndexOf('\0') >= 0) throw PathError("ERR_NUL_BYTE", "path contains NUL");
        if (HasDriveRoot(canonical)) throw PathError("ERR_INVALID_PATH", "win32 drive paths require an explicit host mapping such as toWSL");
        if (canonical.IndexOf('\\') >= 0) throw PathError("ERR_INVALID_PATH", "canonical paths must use slash separators");
        return canonical;
    }

    public static string SanitizeComponent(string name, string profile)
    {
        if (string.IsNullOrEmpty(name)) throw PathError("ERR_INVALID_COMPONENT", "component is empty");
        if (name.IndexOf('\0') >= 0) throw PathError("ERR_NUL_BYTE", "component contains NUL");
        string value = ReplaceUnsafeComponentChars(name).Trim(' ', '.', '_', '-');
        if (value.Length == 0) value = "component";
        if (profile == "win32") value = EscapeReservedWin32Component(value);
        return value;
    }

    public static string EncodeComponent(string name, string profile)
    {
        return SanitizeComponent(name, profile);
    }

    public static string EncodeGitRef(string raw)
    {
        if (string.IsNullOrEmpty(raw)) throw PathError("ERR_INVALID_COMPONENT", "git ref is empty");
        if (raw.IndexOf('\0') >= 0) throw PathError("ERR_NUL_BYTE", "git ref contains NUL");
        string slug = SlugGitRef(raw).Trim('.', '_', '-');
        if (slug.Length == 0) slug = "ref";
        return slug + "--" + ShortSha256(raw, 12);
    }

    private static string CleanCanonical(string raw)
    {
        if (string.IsNullOrEmpty(raw)) throw new ArgumentException("Path must not be empty.", nameof(raw));
        if (raw.IndexOf('\0') >= 0) throw new ArgumentException("Path must not contain NUL.", nameof(raw));

        string value = raw.Replace('\\', '/');
        if (IsUriWindowsDrivePath(value)) value = value.Substring(1);
        if (IsDriveRelative(value)) throw new ArgumentException("Windows drive-relative paths are not canonical.", nameof(raw));
        if (HasDriveRoot(value)) value = char.ToLowerInvariant(value[0]) + value.Substring(1);

        SplitRoot(value, out string prefix, out string rest);

        List<string> parts = new();
        string[] rawParts = rest.Split('/');
        for (int i = 0; i < rawParts.Length; i++)
        {
            string part = rawParts[i];
            if (part.Length == 0 || part == ".") continue;
            if (part == "..")
            {
                if (parts.Count > 0)
                {
                    parts.RemoveAt(parts.Count - 1);
                    continue;
                }

                if (prefix.Length != 0) continue;
                throw new ArgumentException("Relative path escapes above its root.", nameof(raw));
            }

            parts.Add(part);
        }

        string joined = string.Join("/", parts);
        if (prefix.Length == 0) return joined.Length == 0 ? "." : joined;
        if (prefix == "/") return joined.Length == 0 ? "/" : "/" + joined;
        if (prefix.EndsWith("/", StringComparison.Ordinal)) return joined.Length == 0 ? prefix : prefix + joined;
        return joined.Length == 0 ? prefix : prefix + "/" + joined;
    }

    private static string RelativeCanonical(string root, string target)
    {
        SplitRoot(CleanCanonical(root), out string rootPrefix, out string rootRest);
        SplitRoot(CleanCanonical(target), out string targetPrefix, out string targetRest);
        if (!string.Equals(rootPrefix, targetPrefix, StringComparison.Ordinal)) throw new ArgumentException("Target is outside project root.");

        string[] rootParts = SplitNonEmpty(rootRest);
        string[] targetParts = SplitNonEmpty(targetRest);
        if (targetParts.Length < rootParts.Length) throw new ArgumentException("Target is outside project root.");
        for (int i = 0; i < rootParts.Length; i++)
        {
            if (!string.Equals(rootParts[i], targetParts[i], StringComparison.Ordinal)) throw new ArgumentException("Target is outside project root.");
        }

        if (targetParts.Length == rootParts.Length) return ".";

        string[] rel = new string[targetParts.Length - rootParts.Length];
        Array.Copy(targetParts, rootParts.Length, rel, 0, rel.Length);
        return string.Join("/", rel);
    }

    private static string NormalizeRelativePath(string raw)
    {
        if (raw == null || raw.Length == 0) throw PathError("ERR_EMPTY_PATH", "relative path is empty");
        if (raw == ".") return ".";
        if (raw.IndexOf('\0') >= 0) throw PathError("ERR_NUL_BYTE", "relative path contains NUL");
        if (IsAbsolutePathLike(raw)) throw PathError("ERR_ABSOLUTE_PATH", "relative path must not be absolute");
        if (IsDriveRelative(raw)) throw PathError("ERR_DRIVE_RELATIVE_PATH", "drive-relative path is not allowed");
        if (raw.IndexOf('\\') >= 0) throw PathError("ERR_INVALID_PATH", "relative path must use slash separators");

        List<string> parts = new();
        string[] rawParts = raw.Split('/');
        for (int i = 0; i < rawParts.Length; i++)
        {
            string part = rawParts[i];
            if (part.Length == 0 || part == ".") continue;
            if (part == "..")
            {
                if (parts.Count == 0) throw PathError("ERR_OUTSIDE_ROOT", "relative path escapes root");
                parts.RemoveAt(parts.Count - 1);
                continue;
            }

            parts.Add(part);
        }

        if (parts.Count == 0) throw PathError("ERR_EMPTY_PATH", "relative path is empty after cleaning");
        return string.Join("/", parts);
    }

    private static string ParseFileUri(string uri, CanonicalPathNormalizeOptions? options)
    {
        if (uri.IndexOf('\0') >= 0) throw PathError("ERR_NUL_BYTE", "URI contains NUL");
        if (uri.StartsWith("file://", StringComparison.Ordinal))
        {
            if (options?.URI == null || !options.URI.AllowFileUri) throw PathError("ERR_UNSUPPORTED_URI_SCHEME", "file URI is not allowed");
            return ParseHierarchicalURIPath(uri, "file://", options);
        }

        if (uri.StartsWith("vscode-file://", StringComparison.Ordinal))
        {
            if (options?.URI == null || !options.URI.AllowVSCodeFileUri) throw PathError("ERR_UNSUPPORTED_URI_SCHEME", "vscode-file URI is not allowed");
            return ParseHierarchicalURIPath(uri, "vscode-file://", options);
        }

        if (HasUriScheme(uri)) throw PathError("ERR_UNSUPPORTED_URI_SCHEME", "unsupported URI scheme");
        return uri;
    }

    private static string ParseHierarchicalURIPath(string raw, string prefix, CanonicalPathNormalizeOptions? options)
    {
        bool rejectEncodedSlash = options?.URI == null || options.URI.RejectEncodedSlash != false;
        if (rejectEncodedSlash && HasEncodedSeparator(raw)) throw PathError("ERR_ENCODED_SEPARATOR", "URI contains an encoded path separator");

        string rest = raw.Substring(prefix.Length);
        int slash = rest.IndexOf('/');
        if (slash < 0) throw PathError("ERR_INVALID_URI", "URI path is empty");
        string authority = rest.Substring(0, slash);
        string pathPart = rest.Substring(slash);
        try
        {
            ValidatePercentEncoding(pathPart);
            ValidatePercentEncoding(authority);
            string decoded = Uri.UnescapeDataString(pathPart);
            string decodedAuthority = Uri.UnescapeDataString(authority);
            if (decoded.Length == 0) throw PathError("ERR_INVALID_URI", "URI path is empty");
            if (prefix == "file://" && decodedAuthority.Length != 0 && !string.Equals(decodedAuthority, "localhost", StringComparison.OrdinalIgnoreCase))
            {
                return "//" + decodedAuthority + decoded;
            }

            return decoded;
        }
        catch (CanonicalPathException)
        {
            throw;
        }
        catch
        {
            throw PathError("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is invalid");
        }
    }

    private static void ValidatePercentEncoding(string value)
    {
        for (int i = 0; i < value.Length; i++)
        {
            if (value[i] != '%') continue;
            if (i + 2 >= value.Length || !IsHex(value[i + 1]) || !IsHex(value[i + 2])) throw PathError("ERR_INVALID_PERCENT_ENCODING", "URI percent encoding is invalid");
            i += 2;
        }
    }

    private static bool HasEncodedSeparator(string value)
    {
        for (int i = 0; i + 2 < value.Length; i++)
        {
            if (value[i] != '%') continue;
            char high = char.ToLowerInvariant(value[i + 1]);
            char low = char.ToLowerInvariant(value[i + 2]);
            if ((high == '2' && low == 'f') || (high == '5' && low == 'c')) return true;
        }

        return false;
    }

    private static string UnwrapWindowsExtendedPrefix(string value)
    {
        if (value.StartsWith("\\\\?\\UNC\\", StringComparison.Ordinal)) return "\\\\" + value.Substring("\\\\?\\UNC\\".Length);
        if (value.StartsWith("\\\\?\\", StringComparison.Ordinal)) return value.Substring("\\\\?\\".Length);
        return value;
    }

    private static string? MapWSLDrive(string value, CanonicalPathWSLOptions? options)
    {
        if (options == null || !options.Enabled) return null;
        string mountRoot = string.IsNullOrEmpty(options.MountRoot) ? "/mnt" : options.MountRoot;
        mountRoot = mountRoot.TrimEnd('/');
        string prefix = mountRoot + "/";
        if (!value.StartsWith(prefix, StringComparison.Ordinal)) return null;

        string rest = value.Substring(prefix.Length);
        if (rest.Length < 1 || !IsAsciiLetter(rest[0])) return null;
        if (rest.Length > 1 && rest[1] != '/') return null;
        string drive = char.ToLowerInvariant(rest[0]).ToString();
        if (rest.Length == 1) return drive + ":/";
        return drive + ":/" + rest.Substring(2);
    }

    private static void ValidateTargetProfile(string value, string? targetProfile)
    {
        if (string.IsNullOrEmpty(targetProfile) || targetProfile == "portable") return;
        if (targetProfile == "posix")
        {
            if (HasDriveRoot(value) || value.StartsWith("//", StringComparison.Ordinal)) throw PathError("ERR_INVALID_PATH", "targetProfile posix does not allow Windows drive or UNC roots");
            return;
        }

        if (targetProfile == "win32-drive")
        {
            if (value.StartsWith("/", StringComparison.Ordinal)) throw PathError("ERR_INVALID_PATH", "targetProfile win32-drive does not allow POSIX or UNC roots");
            return;
        }

        throw PathError("ERR_INVALID_PATH", "unsupported targetProfile");
    }

    private static bool HasWindowsADS(string value)
    {
        int start = 0;
        if (HasDriveRoot(value)) start = 3;
        else if (value.StartsWith("//", StringComparison.Ordinal))
        {
            string[] parts = value.Substring(2).Split('/');
            if (parts.Length >= 2) start = ("//" + parts[0] + "/" + parts[1]).Length;
        }

        return value.Substring(start).IndexOf(':') >= 0;
    }

    private static bool HasReservedDeviceName(string value)
    {
        if (!TrySplitRootRest(value, out string rest)) return false;
        string[] parts = rest.Split('/');
        for (int i = 0; i < parts.Length; i++)
        {
            string part = parts[i];
            if (part.Length == 0 || part == "." || part == "..") continue;
            string baseName = SplitComponentBase(part).ToUpperInvariant();
            if (IsReservedDeviceBase(baseName)) return true;
        }

        return false;
    }

    private static bool TrySplitRootRest(string value, out string rest)
    {
        if (HasDriveRoot(value))
        {
            rest = value.Substring(3);
            return true;
        }

        if (value.StartsWith("//", StringComparison.Ordinal))
        {
            string[] parts = value.Substring(2).Split('/');
            if (parts.Length < 2 || parts[0].Length == 0 || parts[1].Length == 0)
            {
                rest = string.Empty;
                return false;
            }

            rest = string.Join("/", Subarray(parts, 2));
            return true;
        }

        if (value.StartsWith("/", StringComparison.Ordinal))
        {
            rest = value.Substring(1);
            return true;
        }

        rest = value;
        return true;
    }

    private static void SplitRoot(string value, out string prefix, out string rest)
    {
        if (HasDriveRoot(value))
        {
            prefix = value.Substring(0, 3);
            rest = value.Substring(3);
            return;
        }

        if (value.StartsWith("//", StringComparison.Ordinal))
        {
            string[] parts = value.Substring(2).Split('/');
            if (parts.Length < 2 || parts[0].Length == 0 || parts[1].Length == 0) throw new ArgumentException("UNC path requires server and share.");
            prefix = "//" + parts[0] + "/" + parts[1];
            rest = string.Join("/", Subarray(parts, 2));
            return;
        }

        if (value.StartsWith("/", StringComparison.Ordinal))
        {
            prefix = "/";
            rest = value.Substring(1);
            return;
        }

        prefix = string.Empty;
        rest = value;
    }

    private static string SplitComponentBase(string value)
    {
        int dot = value.IndexOf('.');
        int colon = value.IndexOf(':');
        int end = value.Length;
        if (dot >= 0 && dot < end) end = dot;
        if (colon >= 0 && colon < end) end = colon;
        return value.Substring(0, end);
    }

    private static string ReplaceUnsafeComponentChars(string input)
    {
        StringBuilder builder = new(input.Length);
        bool previousUnsafe = false;
        for (int i = 0; i < input.Length; i++)
        {
            char ch = input[i];
            if (ch == '/' || ch == '\\' || ch == ':' || ch == '\t' || ch == '\n' || ch == '\r')
            {
                if (!previousUnsafe) builder.Append('-');
                previousUnsafe = true;
            }
            else
            {
                builder.Append(ch);
                previousUnsafe = false;
            }
        }

        return builder.ToString();
    }

    private static string EscapeReservedWin32Component(string value)
    {
        int dot = value.IndexOf('.');
        string baseName = dot >= 0 ? value.Substring(0, dot) : value;
        string suffix = dot >= 0 ? value.Substring(dot) : string.Empty;
        if (IsReservedDeviceBase(baseName.ToUpperInvariant())) return baseName + "-" + suffix;
        return value;
    }

    private static bool IsReservedDeviceBase(string value)
    {
        if (value == "CON" || value == "PRN" || value == "AUX" || value == "NUL") return true;
        if (value.Length != 4) return false;
        if (!(value.StartsWith("COM", StringComparison.Ordinal) || value.StartsWith("LPT", StringComparison.Ordinal))) return false;
        return value[3] >= '1' && value[3] <= '9';
    }

    private static string SlugGitRef(string raw)
    {
        StringBuilder builder = new(raw.Length);
        bool previousUnsafe = false;
        for (int i = 0; i < raw.Length; i++)
        {
            char ch = raw[i];
            if (IsGitRefSlugChar(ch))
            {
                builder.Append(ch);
                previousUnsafe = false;
            }
            else if (!previousUnsafe)
            {
                builder.Append('-');
                previousUnsafe = true;
            }
        }

        return builder.ToString();
    }

    private static bool IsGitRefSlugChar(char value)
    {
        return IsAsciiLetter(value) || (value >= '0' && value <= '9') || value == '.' || value == '_' || value == '-';
    }

    private static string ShortSha256(string input, int hexLength)
    {
        using SHA256 sha = SHA256.Create();
        byte[] bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(input));
        StringBuilder builder = new(hexLength);
        int byteCount = (hexLength + 1) / 2;
        for (int i = 0; i < byteCount; i++) builder.Append(bytes[i].ToString("x2"));
        if (builder.Length > hexLength) return builder.ToString().Substring(0, hexLength);
        return builder.ToString();
    }

    private static bool HasUriScheme(string value)
    {
        int index = value.IndexOf("://", StringComparison.Ordinal);
        if (index <= 0) return false;
        if (!IsAsciiLetter(value[0])) return false;
        for (int i = 1; i < index; i++)
        {
            char ch = value[i];
            if (!(IsAsciiLetter(ch) || (ch >= '0' && ch <= '9') || ch == '+' || ch == '.' || ch == '-')) return false;
        }

        return true;
    }

    private static bool HasDriveRoot(string value)
    {
        return value.Length >= 3 && IsAsciiLetter(value[0]) && value[1] == ':' && value[2] == '/';
    }

    private static bool IsDriveRelative(string value)
    {
        return value.Length >= 2 && IsAsciiLetter(value[0]) && value[1] == ':' && (value.Length == 2 || value[2] != '/');
    }

    private static bool IsUriWindowsDrivePath(string value)
    {
        return value.Length >= 4 && value[0] == '/' && IsAsciiLetter(value[1]) && value[2] == ':' && value[3] == '/';
    }

    private static bool IsAbsolutePathLike(string value)
    {
        return value.StartsWith("/", StringComparison.Ordinal)
            || value.StartsWith("\\\\", StringComparison.Ordinal)
            || HasDriveRoot(value.Replace('\\', '/'));
    }

    private static bool IsAsciiLetter(char value)
    {
        return (value >= 'a' && value <= 'z') || (value >= 'A' && value <= 'Z');
    }

    private static bool IsHex(char value)
    {
        return (value >= '0' && value <= '9') || (value >= 'a' && value <= 'f') || (value >= 'A' && value <= 'F');
    }

    private static string[] SplitNonEmpty(string value)
    {
        if (string.IsNullOrEmpty(value)) return Array.Empty<string>();
        string[] raw = value.Split('/');
        List<string> parts = new();
        for (int i = 0; i < raw.Length; i++)
        {
            if (raw[i].Length != 0) parts.Add(raw[i]);
        }

        return parts.ToArray();
    }

    private static string[] Subarray(string[] values, int start)
    {
        if (start >= values.Length) return Array.Empty<string>();
        string[] result = new string[values.Length - start];
        Array.Copy(values, start, result, 0, result.Length);
        return result;
    }

    private static string? OptionSourceHost(CanonicalPathNormalizeOptions? options)
    {
        return options?.SourceHost;
    }

    private static string? OptionTargetProfile(CanonicalPathNormalizeOptions? options)
    {
        return options?.TargetProfile;
    }

    private static bool PreserveExtendedLength(CanonicalPathNormalizeOptions? options)
    {
        return options?.Windows != null && options.Windows.PreserveExtendedLength;
    }

    private static bool RejectADS(CanonicalPathNormalizeOptions? options)
    {
        return options?.Windows != null && options.Windows.RejectADS;
    }

    private static bool RejectDeviceNames(CanonicalPathNormalizeOptions? options)
    {
        return options?.Windows != null && options.Windows.RejectDeviceNames;
    }

    private static bool Contains(string? value, string search)
    {
        return value != null && value.IndexOf(search, StringComparison.OrdinalIgnoreCase) >= 0;
    }

    private static CanonicalPathException PathError(string code, string message)
    {
        return new CanonicalPathException(code, message);
    }
}
