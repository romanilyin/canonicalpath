package canonicalfs

import (
	"archive/zip"
	"io"
	"io/fs"
	"path"
	"strings"
)

// ExtractZip extracts a ZIP file through root-bound paths.
func (r *Root) ExtractZip(zipRel string, destRel string) error {
	zipClean, err := cleanRelative(zipRel)
	if err != nil {
		return err
	}
	destClean, err := cleanRelative(destRel)
	if err != nil {
		return err
	}

	archiveFile, err := r.Open(zipClean)
	if err != nil {
		return err
	}
	defer archiveFile.Close()

	info, err := archiveFile.Stat()
	if err != nil {
		return err
	}
	reader, err := zip.NewReader(archiveFile, info.Size())
	if err != nil {
		return err
	}

	for _, entry := range reader.File {
		entryRel, err := zipEntryPath(destClean, entry.Name)
		if err != nil {
			return err
		}
		if entry.FileInfo().IsDir() {
			if err := r.MkdirAll(entryRel, zipModePerm(entry.Mode(), 0o755)); err != nil {
				return err
			}
			continue
		}

		if dir := path.Dir(entryRel); dir != "." {
			if err := r.MkdirAll(dir, 0o755); err != nil {
				return err
			}
		}
		if err := extractZipFile(r, entry, entryRel); err != nil {
			return err
		}
	}
	return nil
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

func extractZipFile(root *Root, entry *zip.File, entryRel string) error {
	src, err := entry.Open()
	if err != nil {
		return err
	}
	defer src.Close()

	dst, err := root.OpenFile(entryRel, OpenOptions{Create: true, Truncate: true, Exclusive: true, Mode: uint32(zipModePerm(entry.Mode(), 0o644))})
	if err != nil {
		return err
	}
	defer dst.Close()
	_, err = io.Copy(dst, src)
	return err
}

func zipModePerm(mode fs.FileMode, fallback fs.FileMode) fs.FileMode {
	perm := mode.Perm()
	if perm == 0 {
		return fallback
	}
	return perm
}
