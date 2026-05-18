package canonicalfs

import (
	"errors"
	"io/fs"
	"os"
	"testing"
)

func TestRootMethodsRejectNilRoot(t *testing.T) {
	var root *Root

	for _, testCase := range rootMethodErrorCases(root) {
		t.Run(testCase.name, func(t *testing.T) {
			err := testCase.run()
			if err == nil {
				t.Fatal("expected error, got nil")
			}
			if testCase.name != "Rename" && !errors.Is(err, os.ErrInvalid) {
				t.Fatalf("expected os.ErrInvalid, got %v", err)
			}
		})
	}
}

func TestRootMethodsRejectClosedRoot(t *testing.T) {
	root, err := OpenRoot(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := root.Close(); err != nil {
		t.Fatal(err)
	}

	for _, testCase := range rootMethodErrorCases(root) {
		t.Run(testCase.name, func(t *testing.T) {
			if err := testCase.run(); err == nil {
				t.Fatal("expected error, got nil")
			}
		})
	}
}

type rootMethodErrorCase struct {
	name string
	run  func() error
}

func rootMethodErrorCases(root *Root) []rootMethodErrorCase {
	return []rootMethodErrorCase{
		{
			name: "Open",
			run: func() error {
				file, err := root.Open("safe/file.txt")
				if file != nil {
					_ = file.Close()
				}
				return err
			},
		},
		{
			name: "OpenFile",
			run: func() error {
				file, err := root.OpenFile("safe/file.txt", OpenOptions{})
				if file != nil {
					_ = file.Close()
				}
				return err
			},
		},
		{
			name: "ReadFile",
			run: func() error {
				_, err := root.ReadFile("safe/file.txt", 1024)
				return err
			},
		},
		{
			name: "WriteFile",
			run: func() error {
				return root.WriteFile("safe/file.txt", []byte("ok"), OpenOptions{})
			},
		},
		{
			name: "MkdirAll",
			run: func() error {
				return root.MkdirAll("safe/dir", 0o755)
			},
		},
		{
			name: "Remove",
			run: func() error {
				return root.Remove("safe/file.txt")
			},
		},
		{
			name: "Stat",
			run: func() error {
				_, err := root.Stat("safe/file.txt")
				return err
			},
		},
		{
			name: "Walk",
			run: func() error {
				return root.Walk("safe", func(_ string, _ fs.FileInfo, err error) error {
					return err
				})
			},
		},
		{
			name: "ExtractZip",
			run: func() error {
				return root.ExtractZip("archives/archive.zip", ".")
			},
		},
		{
			name: "Rename",
			run: func() error {
				return root.Rename("safe/file.txt", "safe/file2.txt")
			},
		},
	}
}
