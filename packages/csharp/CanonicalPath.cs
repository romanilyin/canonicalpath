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
    private sealed class GrammarRoot
    {
        public string Kind;
        public string Prefix;
        public string Rest;
        public GrammarRoot(string kind, string prefix, string rest) { Kind = kind; Prefix = prefix; Rest = rest; }
        public bool Windows { get { return Kind != "relative" && Kind != "posix"; } }
    }

    private static string MarkRelative(string value)
    {
        return value.Length >= 2 && IsAsciiLetter(value[0]) && value[1] == ':' ? "./" + value : value;
    }

    private static GrammarRoot ParseGrammar(string value, bool nativePosix = false)
    {
        if (string.IsNullOrEmpty(value)) throw PathError("ERR_EMPTY_PATH", "path is empty");
        if (value.IndexOf('\0') >= 0) throw PathError("ERR_NUL_BYTE", "path contains NUL");
        if (nativePosix)
        {
            if (value.StartsWith("//", StringComparison.Ordinal) && !value.StartsWith("///", StringComparison.Ordinal)) throw PathError("ERR_INVALID_PATH", "double-leading-slash POSIX paths are unsupported");
            return value[0] == '/' ? new GrammarRoot("posix", "/", value.TrimStart('/')) : new GrammarRoot("relative", "", value);
        }
        GrammarRoot result;
        if (value.StartsWith("//?/", StringComparison.Ordinal))
        {
            string tail = value.Substring(4);
            if (HasDriveRoot(tail)) result = new GrammarRoot("extended-drive", "//?/" + char.ToLowerInvariant(tail[0]) + ":/", tail.Substring(3));
            else if (tail.StartsWith("UNC/", StringComparison.Ordinal)) result = ParseUNCRoot(tail.Substring(4), "//?/UNC/", "extended-unc");
            else throw PathError("ERR_INVALID_PATH", "unsupported or incomplete extended root");
        }
        else if (HasDriveRoot(value)) result = new GrammarRoot("drive", char.ToLowerInvariant(value[0]) + ":/", value.Substring(3));
        else if (IsDriveRelative(value)) throw PathError("ERR_DRIVE_RELATIVE_PATH", "unmarked drive-relative path");
        else if (value.StartsWith("//", StringComparison.Ordinal)) result = ParseUNCRoot(value.Substring(2), "//", "unc");
        else if (value[0] == '/') result = new GrammarRoot("posix", "/", value.Substring(1));
        else result = new GrammarRoot("relative", "", value);
        if (result.Windows && value.IndexOf('\\') >= 0) throw PathError("ERR_INVALID_PATH", "Windows canonical components cannot contain backslash");
        return result;
    }

    private static GrammarRoot ParseUNCRoot(string value, string prefix, string kind)
    {
        string[] parts = value.Split('/');
        if (parts.Length < 2 || parts[0].Length == 0 || parts[1].Length == 0 || parts[0] == "." || parts[0] == ".." || parts[1] == "." || parts[1] == "..") throw PathError("ERR_INVALID_PATH", "UNC requires a server and share");
        return new GrammarRoot(kind, prefix + parts[0] + "/" + parts[1], string.Join("/", parts, 2, parts.Length - 2));
    }

    private static string CleanGrammar(string value, bool nativePosix = false, string escapeCode = "ERR_INVALID_PATH")
    {
        GrammarRoot parsed = ParseGrammar(value, nativePosix);
        List<string> parts = new List<string>();
        foreach (string part in parsed.Rest.Split('/'))
        {
            if (part.Length == 0 || part == ".") continue;
            if (part == "..")
            {
                if (parts.Count > 0) parts.RemoveAt(parts.Count - 1);
                else if (parsed.Prefix.Length == 0) throw PathError(escapeCode, "relative path escapes its root");
            }
            else parts.Add(part);
        }
        string joined = string.Join("/", parts.ToArray());
        if (parsed.Prefix.Length == 0) return joined.Length == 0 ? "." : MarkRelative(joined);
        return parsed.Prefix + (joined.Length == 0 || parsed.Prefix.EndsWith("/", StringComparison.Ordinal) ? "" : "/") + joined;
    }

    private static GrammarRoot RequireCanonical(string value, bool allowDriveCase = false)
    {
        GrammarRoot parsed = ParseGrammar(value);
        bool driveCase = allowDriveCase && (parsed.Kind == "drive" || parsed.Kind == "extended-drive");
        int separatorLength = parsed.Prefix.Length > 0 && parsed.Rest.Length > 0 && !parsed.Prefix.EndsWith("/", StringComparison.Ordinal) ? 1 : 0;
        if ((!driveCase && !value.StartsWith(parsed.Prefix, StringComparison.Ordinal)) || value.Length != parsed.Prefix.Length + separatorLength + parsed.Rest.Length)
            throw PathError("ERR_INVALID_PATH", "path must be lexically cleaned canonical data");
        if (parsed.Rest.Length == 0 || (parsed.Kind == "relative" && value == ".")) return parsed;

        // Validate components in place. Rebuilding a cleaned string here allocates
        // arrays and component strings for every relative/join/serializer call.
        int start = 0;
        if (parsed.Kind == "relative" && value.StartsWith("./", StringComparison.Ordinal))
        {
            if (value.Length < 4 || !IsAsciiLetter(value[2]) || value[3] != ':')
                throw PathError("ERR_INVALID_PATH", "relative marker must disambiguate a drive-like component");
            start = 2;
        }
        for (int index = start; index <= parsed.Rest.Length; index++)
        {
            if (index < parsed.Rest.Length && parsed.Rest[index] != '/') continue;
            int length = index - start;
            if (length == 0 || (parsed.Rest[start] == '.' && (length == 1 || (length == 2 && parsed.Rest[start + 1] == '.'))))
                throw PathError("ERR_INVALID_PATH", "path must be lexically cleaned canonical data");
            start = index + 1;
        }
        return parsed;
    }

    private static string NormalizeMount(string? value)
    {
        if (string.IsNullOrEmpty(value)) return "/mnt";
        if (value == "/mnt" || value == "/") return value;
        GrammarRoot parsed = ParseGrammar(value, true);
        if (parsed.Kind != "posix") throw PathError("ERR_INVALID_PATH", "WSL mount root must be absolute POSIX");
        return CleanGrammar(value, true);
    }

    private static void ValidateWindowsComponents(string value, CanonicalPathNormalizeOptions? options, bool nativePosix = false)
    {
        if (!RejectADS(options) && !RejectDeviceNames(options)) return;
        string rest = ParseGrammar(value, nativePosix).Rest;
        if (RejectADS(options) && rest.IndexOf(':') >= 0) throw PathError("ERR_ALTERNATE_DATA_STREAM", "Windows alternate data stream is not allowed");
        if (RejectDeviceNames(options)) foreach (string part in rest.Split('/'))
        {
            if (IsReservedDeviceBase(SplitComponentBase(part).ToUpperInvariant())) throw PathError("ERR_RESERVED_DEVICE_NAME", "Windows reserved device name is not allowed");
        }
    }

    public static string Normalize(string raw)
    {
        return Normalize(raw, null);
    }

    public static string Normalize(string raw, CanonicalPathNormalizeOptions? options)
    {
        if (options != null && options.TrimOuterWhitespace && raw != null) raw = raw.Trim();
        if (string.IsNullOrEmpty(raw)) throw PathError("ERR_EMPTY_PATH", "path is empty");
        if (raw.IndexOf('\0') >= 0) throw PathError("ERR_NUL_BYTE", "path contains NUL");
        CanonicalPathWSLOptions? wsl = options == null ? null : options.WSL;
        string mount = NormalizeMount(wsl == null ? null : wsl.MountRoot);
        string? host = OptionSourceHost(options);
        string value = raw;
        if (host == "posix")
        {
            if (wsl != null && wsl.Enabled) throw PathError("ERR_INVALID_PATH", "native POSIX input cannot enable WSL mapping");
            ValidateWindowsComponents(value, options, true);
            value = CleanGrammar(value, true);
        }
        else if (host == "canonical")
        {
            ValidateWindowsComponents(value, options);
            value = CleanGrammar(value);
        }
        else
        {
            bool uriInput = HasUriScheme(value);
            if (uriInput || host == "vscode-file-uri") value = ParseFileUri(value, options);
            bool wslCandidate = wsl != null && wsl.Enabled && value.StartsWith("/", StringComparison.Ordinal) && (!value.StartsWith("//", StringComparison.Ordinal) || value.StartsWith("///", StringComparison.Ordinal)) && !(uriInput && IsUriWindowsDrivePath(value));
            if (wslCandidate)
            {
                ValidateWindowsComponents(value, options, true);
                value = CleanGrammar(value, true);
                string prefix = mount == "/" ? "/" : mount + "/";
                if (OptionTargetProfile(options) != "posix" && value.StartsWith(prefix, StringComparison.Ordinal))
                {
                    string tail = value.Substring(prefix.Length);
                    if (tail.Length > 0 && IsAsciiLetter(tail[0]) && (tail.Length == 1 || tail[1] == '/'))
                        value = char.ToLowerInvariant(tail[0]) + ":/" + (tail.Length == 1 ? "" : tail.Substring(2));
                }
                value = CleanGrammar(value);
            }
            else
            {
                value = value.Replace('\\', '/');
                if (IsUriWindowsDrivePath(value)) value = value.Substring(1);
                GrammarRoot parsed = ParseGrammar(value);
                if (!PreserveExtendedLength(options))
                {
                    if (parsed.Kind == "extended-drive") value = value.Substring(4);
                    else if (parsed.Kind == "extended-unc") value = "//" + value.Substring(8);
                }
                ValidateWindowsComponents(value, options);
                value = CleanGrammar(value);
            }
        }
        ValidateTargetProfile(value, OptionTargetProfile(options));
        return value;
    }

    public static string Relative(string root, string target)
    {
        GrammarRoot left = RequireCanonical(root);
        GrammarRoot right = RequireCanonical(target);
        if (left.Prefix.Length == 0 || right.Prefix.Length == 0) throw PathError("ERR_INVALID_PATH", "relative operands must be absolute canonical paths");
        string[] leftParts = left.Rest.Split(new char[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
        string[] rightParts = right.Rest.Split(new char[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
        if (left.Prefix != right.Prefix || rightParts.Length < leftParts.Length) throw PathError("ERR_OUTSIDE_ROOT", "target is outside root");
        for (int i = 0; i < leftParts.Length; i++) if (leftParts[i] != rightParts[i]) throw PathError("ERR_OUTSIDE_ROOT", "target is outside root");
        return rightParts.Length == leftParts.Length ? "." : MarkRelative(string.Join("/", rightParts, leftParts.Length, rightParts.Length - leftParts.Length));
    }

    public static string Join(string root, string relative)
    {
        GrammarRoot parsedRoot = RequireCanonical(root);
        GrammarRoot parsedRelative = ParseGrammar(relative);
        if (parsedRelative.Prefix.Length != 0) throw PathError("ERR_ABSOLUTE_PATH", "join argument must be relative");
        if (parsedRoot.Windows && relative.IndexOf('\\') >= 0) throw PathError("ERR_INVALID_PATH", "relative data is not representable under a Windows root");
        string clean = CleanGrammar(relative, false, "ERR_OUTSIDE_ROOT");
        if (clean == ".") return root;
        if (clean.StartsWith("./", StringComparison.Ordinal)) clean = clean.Substring(2);
        string combined = root == "." ? clean : root.TrimEnd('/') + "/" + clean;
        return CleanGrammar(combined, parsedRoot.Kind == "relative");
    }

    public static string Join(params string[] parts)
    {
        if (parts == null || parts.Length == 0) throw PathError("ERR_EMPTY_PATH", "join requires at least one path part");
        RequireCanonical(parts[0]);
        string value = parts[0];
        for (int i = 1; i < parts.Length; i++) value = Join(value, parts[i]);
        return value;
    }

    public static bool IsEqual(string left, string right, CanonicalPathNormalizeOptions? options = null)
    {
        return string.Equals(Normalize(left, options), Normalize(right, options), StringComparison.Ordinal);
    }

    public static string ToWin32(string canonical)
    {
        GrammarRoot parsed = RequireCanonical(canonical, true);
        if (parsed.Kind == "posix" || canonical.IndexOf('\\') >= 0 || canonical.StartsWith("./", StringComparison.Ordinal)) throw PathError("ERR_INVALID_PATH", "canonical path is not representable as a Windows path");
        string value = canonical;
        if (parsed.Kind == "drive") value = char.ToUpperInvariant(value[0]) + value.Substring(1);
        if (parsed.Kind == "extended-drive") value = value.Substring(0, 4) + char.ToUpperInvariant(value[4]) + value.Substring(5);
        return value.Replace('/', '\\');
    }

    public static string ToWSL(string canonical, CanonicalPathWSLOptions? options = null)
    {
        string mount = NormalizeMount(options == null ? null : options.MountRoot);
        GrammarRoot parsed = RequireCanonical(canonical, true);
        if (parsed.Kind == "posix" || parsed.Kind == "relative") return canonical;
        if (parsed.Kind != "drive") throw PathError("ERR_INVALID_PATH", "WSL serialization requires an ordinary drive");
        return (mount == "/" ? "" : mount) + "/" + parsed.Prefix[0] + (parsed.Rest.Length == 0 ? "" : "/" + parsed.Rest);
    }

    public static string ToPOSIX(string canonical)
    {
        if (RequireCanonical(canonical).Windows) throw PathError("ERR_INVALID_PATH", "Windows root requires an explicit host mapping");
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
        string hash = ShortSha256(raw, 64);
        string slug = SlugGitRef(raw).Trim('.', '_', '-');
        if (slug.Length > 80) slug = slug.Substring(0, 80).Trim('.', '_', '-');
        if (slug.Length == 0) slug = "ref";
        return "v2-" + slug + "--" + hash;
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
            string decoded = DecodeUriText(pathPart);
            string decodedAuthority = DecodeUriText(authority);
            if (decoded.IndexOf('\0') >= 0 || decodedAuthority.IndexOf('\0') >= 0) throw PathError("ERR_NUL_BYTE", "decoded URI contains NUL");
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

    private static string DecodeUriText(string value)
    {
        var utf8 = new UTF8Encoding(false, true);
        byte[] input = utf8.GetBytes(value);
        var output = new List<byte>(input.Length);
        for (int i = 0; i < input.Length; i++)
        {
            if (input[i] != (byte)'%') { output.Add(input[i]); continue; }
            output.Add(Convert.ToByte(Encoding.ASCII.GetString(input, i + 1, 2), 16));
            i += 2;
        }
        return utf8.GetString(output.ToArray());
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
        string prefix = System.Text.RegularExpressions.Regex.Replace(mountRoot, "/+", "/") + "/";
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
        GrammarRoot parsed = ParseGrammar(value);
        if (string.IsNullOrEmpty(targetProfile) || targetProfile == "portable") return;
        if (targetProfile == "posix" && !parsed.Windows) return;
        if (targetProfile == "win32-drive" && (parsed.Kind == "relative" || parsed.Kind == "drive" || parsed.Kind == "extended-drive")) return;
        throw PathError("ERR_INVALID_PATH", "canonical root is incompatible with target profile");
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
        byte[] encoded;
        try { encoded = new UTF8Encoding(false, true).GetBytes(input); }
        catch (EncoderFallbackException) { throw PathError("ERR_INVALID_COMPONENT", "git ref contains invalid Unicode"); }
        byte[] bytes = sha.ComputeHash(encoded);
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
