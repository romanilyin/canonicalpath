package canonicalfs

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"io/fs"
	"os"
	"path"
	"strings"
	"time"
)

// ZipLimits bounds compressed input, expanded output, metadata, and work time.
// Zero values select conservative defaults; negative values are rejected.
type ZipLimits struct {
	MaxArchiveBytes     int64
	MaxEntries          int
	MaxEntryBytes       int64
	MaxTotalBytes       int64
	MaxCompressionRatio uint64
	MaxDuration         time.Duration
}

func defaultZipLimits(l ZipLimits) (ZipLimits, error) {
	if l.MaxArchiveBytes < 0 || l.MaxEntries < 0 || l.MaxEntryBytes < 0 || l.MaxTotalBytes < 0 || l.MaxDuration < 0 {
		return l, newError(ErrReadLimitExceeded, "invalid ZIP limits")
	}
	if l.MaxArchiveBytes == 0 {
		l.MaxArchiveBytes = 64 << 20
	}
	if l.MaxEntries == 0 {
		l.MaxEntries = 1000
	}
	if l.MaxEntryBytes == 0 {
		l.MaxEntryBytes = 16 << 20
	}
	if l.MaxTotalBytes == 0 {
		l.MaxTotalBytes = 64 << 20
	}
	if l.MaxCompressionRatio == 0 {
		l.MaxCompressionRatio = 1000
	}
	if l.MaxDuration == 0 {
		l.MaxDuration = 30 * time.Second
	}
	return l, nil
}

// ExtractZip uses bounded defaults and a separate destination root handle.
func (r *Root) ExtractZip(zipRel string, destRel string) error {
	return r.ExtractZipWithLimits(context.Background(), zipRel, destRel, ZipLimits{})
}

// ExtractZipWithLimits confines all members to the opened destination. Existing
// destination symlinks, special input files and non-regular archive entries are rejected. On error,
// earlier complete entries may remain; the incomplete output file is removed.
func (r *Root) ExtractZipWithLimits(ctx context.Context, zipRel, destRel string, limits ZipLimits) error {
	limits, err := defaultZipLimits(limits)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, limits.MaxDuration)
	defer cancel()
	zipClean, err := cleanRelative(zipRel)
	if err != nil {
		return err
	}
	destClean, err := cleanRelative(destRel)
	if err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	archiveFile, err := r.openRegularFile(zipClean, os.O_RDONLY, 0)
	if err != nil {
		return err
	}
	defer archiveFile.Close()
	info, err := archiveFile.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() > limits.MaxArchiveBytes {
		return newError(ErrReadLimitExceeded, "ZIP compressed input exceeds limit or is not a regular file")
	}
	// Freeze the bounded input so another writer cannot change metadata between
	// preflight and archive/zip's per-entry allocations.
	archive, err := io.ReadAll(io.LimitReader(zipContextReader{ctx: ctx, reader: archiveFile}, limits.MaxArchiveBytes+1))
	if err != nil {
		return err
	}
	if int64(len(archive)) > limits.MaxArchiveBytes {
		return newError(ErrReadLimitExceeded, "ZIP compressed input exceeds limit")
	}
	input := bytes.NewReader(archive)
	if err := checkZipEntryCount(input, int64(len(archive)), limits.MaxEntries); err != nil {
		return err
	}
	reader, err := zip.NewReader(input, int64(len(archive)))
	if err != nil {
		return err
	}
	if len(reader.File) > limits.MaxEntries {
		return newError(ErrReadLimitExceeded, "ZIP entry count exceeds limit")
	}
	var declared uint64
	for _, entry := range reader.File {
		if _, err := zipEntryPath(".", entry.Name); err != nil {
			return err
		}
		if !entry.Mode().IsRegular() && !entry.Mode().IsDir() {
			return newError(ErrArchiveTraversal, "ZIP contains a link or special file")
		}
		expanded := entry.UncompressedSize64
		if expanded > uint64(limits.MaxEntryBytes) || expanded > uint64(limits.MaxTotalBytes)-declared {
			return newError(ErrReadLimitExceeded, "ZIP expanded output exceeds limit")
		}
		declared += expanded
		compressed := entry.CompressedSize64
		if expanded > 0 && (compressed == 0 || (expanded-1)/compressed >= limits.MaxCompressionRatio) {
			return newError(ErrReadLimitExceeded, "ZIP compression ratio exceeds limit")
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	destination, err := r.openZipDestination(destClean)
	if err != nil {
		return err
	}
	defer destination.Close()
	var total int64
	for _, entry := range reader.File {
		if err := ctx.Err(); err != nil {
			return err
		}
		entryRel, _ := zipEntryPath(".", entry.Name)
		if entry.FileInfo().IsDir() {
			dir, err := destination.openZipDestination(entryRel)
			if err != nil {
				return err
			}
			_ = dir.Close()
			continue
		}
		// Pin the member parent as well. Its children cannot traverse back into
		// the extraction destination through a replaced directory symlink.
		parent, err := destination.openZipDestination(path.Dir(entryRel))
		if err != nil {
			return err
		}
		remaining := min(limits.MaxEntryBytes, limits.MaxTotalBytes-total)
		n, err := extractZipFile(ctx, parent, entry, path.Base(entryRel), remaining)
		_ = parent.Close()
		total += n
		if err != nil {
			return err
		}
	}
	return nil
}

// openZipDestination walks through pinned directory handles and rejects
// pre-existing symlinks. Each open remains confined to its current parent.
func (r *Root) openZipDestination(rel string) (*Root, error) {
	return r.openPinnedDirectory(rel, true, ErrArchiveTraversal)
}

// OpenScopedRoot pins an exact scope anchor, rejecting links and replacement
// races in every component. The returned handle must be closed by the caller.
func (r *Root) OpenScopedRoot(rel string, create bool) (*Root, error) {
	clean, err := cleanRelative(rel)
	if err != nil {
		return nil, err
	}
	if clean == "." {
		return nil, newError(ErrOutsideRoot, "scope must be narrower than the project root")
	}
	child, err := r.openPinnedDirectory(clean, create, ErrSymlinkEscape)
	if err == nil {
		child.rejectFileLinks = true
	}
	return child, err
}

func (r *Root) openPinnedDirectory(rel string, create bool, code ErrorCode) (*Root, error) {
	current, err := r.OpenRoot(".")
	if err != nil {
		return nil, err
	}
	if rel == "." {
		return current, nil
	}
	for _, part := range strings.Split(rel, "/") {
		handle, _ := current.rootHandle()
		if create {
			if err := handle.Mkdir(part, 0o755); err != nil && !errors.Is(err, os.ErrExist) {
				_ = current.Close()
				return nil, err
			}
		}
		info, err := handle.Lstat(part)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			_ = current.Close()
			return nil, newError(code, "directory anchor contains a link or non-directory")
		}
		child, err := current.OpenRoot(part)
		_ = current.Close()
		if err != nil {
			return nil, err
		}
		opened, statErr := child.Stat(".")
		if statErr != nil || !os.SameFile(info, opened) {
			_ = child.Close()
			return nil, newError(code, "directory anchor changed during opening")
		}
		current = child
	}
	return current, nil
}

func zipEntryPath(destRel string, entryName string) (string, error) {
	if entryName == "" || strings.ContainsRune(entryName, '\x00') || strings.Contains(entryName, "\\") || path.IsAbs(entryName) {
		return "", newError(ErrArchiveTraversal, "zip entry path is not a safe relative path")
	}
	entryClean, err := cleanRelative(entryName)
	if err != nil || entryClean == "." {
		return "", newError(ErrArchiveTraversal, "zip entry escapes destination")
	}
	joined := entryClean
	if destRel != "." {
		joined = destRel + "/" + entryClean
	}
	clean, err := cleanRelative(joined)
	if err != nil {
		return "", newError(ErrArchiveTraversal, "zip entry escapes destination")
	}
	return clean, nil
}

type zipContextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r zipContextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
}

func extractZipFile(ctx context.Context, root *Root, entry *zip.File, entryRel string, limit int64) (n int64, resultErr error) {
	src, err := entry.Open()
	if err != nil {
		return 0, err
	}
	defer src.Close()
	dst, err := root.OpenFile(entryRel, OpenOptions{Create: true, Exclusive: true, Mode: uint32(zipModePerm(entry.Mode(), 0o644))})
	if err != nil {
		return 0, err
	}
	defer func() {
		resultErr = errors.Join(resultErr, dst.Close())
		if resultErr != nil {
			_ = root.Remove(entryRel)
		}
	}()
	// Never write even the extra probing byte to the destination.
	bounded := zipContextReader{ctx: ctx, reader: src}
	n, err = io.Copy(dst, io.LimitReader(bounded, limit))
	if err != nil {
		return n, err
	}
	var probe [1]byte
	count, err := bounded.Read(probe[:])
	if count != 0 {
		return n, newError(ErrReadLimitExceeded, "ZIP actual expanded output exceeds limit")
	}
	if err != io.EOF {
		return n, err
	}
	return n, nil
}

func zipModePerm(mode fs.FileMode, fallback fs.FileMode) fs.FileMode {
	perm := mode.Perm()
	if perm == 0 {
		return fallback
	}
	return perm
}

// Check the bounded end record before archive/zip allocates per-entry metadata.
// ZIP64 is deliberately refused by this bounded extraction API.
func checkZipEntryCount(file io.ReaderAt, size int64, maxEntries int) error {
	if size < 22 {
		return zip.ErrFormat
	}
	length := min(size, int64(22+65535))
	tail := make([]byte, length)
	if _, err := file.ReadAt(tail, size-length); err != nil {
		return err
	}
	for i := len(tail) - 22; i >= 0; i-- {
		if binary.LittleEndian.Uint32(tail[i:i+4]) != 0x06054b50 {
			continue
		}
		commentLength := int(binary.LittleEndian.Uint16(tail[i+20 : i+22]))
		if i+22+commentLength > len(tail) {
			continue
		}
		if i+22+commentLength != len(tail) {
			return zip.ErrFormat
		}
		count := int(binary.LittleEndian.Uint16(tail[i+10 : i+12]))
		centralSize := int64(binary.LittleEndian.Uint32(tail[i+12 : i+16]))
		centralOffset := int64(binary.LittleEndian.Uint32(tail[i+16 : i+20]))
		if count == 65535 || count > maxEntries || centralSize == 0xffffffff || centralOffset == 0xffffffff {
			return newError(ErrReadLimitExceeded, "ZIP entry count exceeds limit or uses ZIP64")
		}
		// Accept a single-disk ordinary ZIP with an exact central directory.
		// Counting actual headers also rejects forged/wrapped EOCD counts before
		// archive/zip can allocate one File object for every hidden entry.
		endOffset := size - length + int64(i)
		// archive/zip also probes ZIP64 for a 65535-byte central directory.
		// Refuse its locator without rejecting an ordinary directory of that size.
		if endOffset >= 20 {
			var locator [4]byte
			if _, err := file.ReadAt(locator[:], endOffset-20); err != nil {
				return err
			}
			if binary.LittleEndian.Uint32(locator[:]) == 0x07064b50 {
				return newError(ErrReadLimitExceeded, "ZIP64 is not supported by bounded extraction")
			}
		}
		if binary.LittleEndian.Uint32(tail[i+4:i+8]) != 0 || int(binary.LittleEndian.Uint16(tail[i+8:i+10])) != count || centralOffset+centralSize != endOffset {
			return zip.ErrFormat
		}
		var header [46]byte
		actual := 0
		for offset := centralOffset; offset < endOffset; {
			if endOffset-offset < int64(len(header)) {
				return zip.ErrFormat
			}
			if _, err := file.ReadAt(header[:], offset); err != nil {
				return err
			}
			if binary.LittleEndian.Uint32(header[:4]) != 0x02014b50 {
				return zip.ErrFormat
			}
			actual++
			if actual > maxEntries {
				return newError(ErrReadLimitExceeded, "ZIP entry count exceeds limit")
			}
			step := int64(46) + int64(binary.LittleEndian.Uint16(header[28:30])) + int64(binary.LittleEndian.Uint16(header[30:32])) + int64(binary.LittleEndian.Uint16(header[32:34]))
			if step > endOffset-offset {
				return zip.ErrFormat
			}
			offset += step
		}
		if actual != count {
			return zip.ErrFormat
		}
		return nil
	}
	return zip.ErrFormat
}
