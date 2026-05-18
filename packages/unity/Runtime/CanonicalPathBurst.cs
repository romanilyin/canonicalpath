namespace CanonicalPath
{
    public enum CanonicalPathBurstStatus
    {
        Ok = 0,
        EmptyPath = 1,
        NulByte = 2,
        AbsolutePath = 3,
        DriveRelativePath = 4,
        InvalidPath = 5,
    }

    public static unsafe class CanonicalPathBurst
    {
        public const ushort Slash = (ushort)'/';
        public const ushort Backslash = (ushort)'\\';
        public const ushort Colon = (ushort)':';
        public const ushort Dot = (ushort)'.';

        public static bool IsAsciiLetter(ushort value)
        {
            return (value >= (ushort)'a' && value <= (ushort)'z') || (value >= (ushort)'A' && value <= (ushort)'Z');
        }

        public static ushort ToLowerAscii(ushort value)
        {
            if (value >= (ushort)'A' && value <= (ushort)'Z') return (ushort)(value + 32);
            return value;
        }

        public static bool IsSeparator(ushort value)
        {
            return value == Slash || value == Backslash;
        }

        public static bool IsWindowsDriveRoot(ushort first, ushort second, ushort third)
        {
            return IsAsciiLetter(first) && second == Colon && IsSeparator(third);
        }

        public static bool IsWindowsDriveRelative(ushort first, ushort second, bool hasThird, ushort third)
        {
            return IsAsciiLetter(first) && second == Colon && (!hasThird || !IsSeparator(third));
        }

        public static CanonicalPathBurstStatus ValidateRelativeCodeUnit(ushort value)
        {
            if (value == 0) return CanonicalPathBurstStatus.NulByte;
            if (IsSeparator(value)) return CanonicalPathBurstStatus.InvalidPath;
            return CanonicalPathBurstStatus.Ok;
        }

        public static CanonicalPathBurstStatus ValidateRelativePrefix(int length, ushort first, ushort second, bool hasThird, ushort third)
        {
            if (length <= 0) return CanonicalPathBurstStatus.EmptyPath;
            if (first == 0 || (length > 1 && second == 0) || (hasThird && third == 0)) return CanonicalPathBurstStatus.NulByte;
            if (IsSeparator(first)) return CanonicalPathBurstStatus.AbsolutePath;
            if (length >= 3 && IsWindowsDriveRoot(first, second, third)) return CanonicalPathBurstStatus.AbsolutePath;
            if (IsWindowsDriveRelative(first, second, hasThird, third)) return CanonicalPathBurstStatus.DriveRelativePath;
            return CanonicalPathBurstStatus.Ok;
        }

        public static CanonicalPathBurstStatus CopyRelativeCanonical(ushort* input, int length, ushort* output, int capacity, out int written)
        {
            written = 0;
            if (input == null || output == null || capacity < 0) return CanonicalPathBurstStatus.InvalidPath;
            if (length <= 0) return CanonicalPathBurstStatus.EmptyPath;

            ushort first = input[0];
            ushort second = length > 1 ? input[1] : (ushort)0;
            ushort third = length > 2 ? input[2] : (ushort)0;
            CanonicalPathBurstStatus prefix = ValidateRelativePrefix(length, first, second, length > 2, third);
            if (prefix != CanonicalPathBurstStatus.Ok) return prefix;

            bool previousSeparator = false;
            int componentDots = 0;
            for (int i = 0; i < length; i++)
            {
                ushort value = input[i];
                if (value == 0) return CanonicalPathBurstStatus.NulByte;
                if (IsSeparator(value))
                {
                    if (componentDots == 2) return CanonicalPathBurstStatus.InvalidPath;
                    componentDots = 0;
                    if (previousSeparator || written == 0) continue;
                    if (written >= capacity) return CanonicalPathBurstStatus.InvalidPath;
                    output[written++] = Slash;
                    previousSeparator = true;
                    continue;
                }

                if (value == Dot)
                {
                    componentDots++;
                }
                else
                {
                    componentDots = -1;
                }

                if (written >= capacity) return CanonicalPathBurstStatus.InvalidPath;
                output[written++] = value;
                previousSeparator = false;
            }

            if (componentDots == 2) return CanonicalPathBurstStatus.InvalidPath;
            if (written > 0 && output[written - 1] == Slash) written--;
            if (written == 0) return CanonicalPathBurstStatus.EmptyPath;
            return CanonicalPathBurstStatus.Ok;
        }
    }
}
