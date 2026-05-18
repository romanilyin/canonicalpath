package canonicalpath

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

type vectorFile struct {
	Version int          `json:"version"`
	Cases   []vectorCase `json:"cases"`
}

type vectorCase struct {
	ID        string  `json:"id"`
	Operation string  `json:"operation"`
	Raw       string  `json:"raw"`
	Root      string  `json:"root"`
	Target    string  `json:"target"`
	Relative  string  `json:"relative"`
	Profile   string  `json:"profile"`
	Expected  string  `json:"expected"`
	Error     string  `json:"error"`
	Options   Options `json:"options"`
}

func TestSharedVectors(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("..", "..", "..", "spec", "testdata", "*_cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) == 0 {
		t.Fatal("no shared canonicalpath vector files found")
	}

	for _, file := range files {
		file := file
		t.Run(filepath.Base(file), func(t *testing.T) {
			vectors := readVectorFile(t, file)
			for _, testCase := range vectors.Cases {
				testCase := testCase
				t.Run(testCase.ID, func(t *testing.T) {
					actual, err := runVector(testCase)
					assertVectorResult(t, testCase, actual, err)
				})
			}
		})
	}
}

func readVectorFile(t *testing.T, file string) vectorFile {
	t.Helper()
	data, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var vectors vectorFile
	if err := json.Unmarshal(data, &vectors); err != nil {
		t.Fatal(err)
	}
	return vectors
}

func runVector(testCase vectorCase) (string, error) {
	switch testCase.Operation {
	case "normalize":
		result, err := Normalize(testCase.Raw, testCase.Options)
		return string(result), err
	case "relative":
		result, err := Relative(Path(testCase.Root), Path(testCase.Target))
		return string(result), err
	case "join":
		result, err := Join(Path(testCase.Root), RelativePath(testCase.Relative))
		return string(result), err
	case "is-equal":
		result, err := IsEqual(testCase.Root, testCase.Target, testCase.Options)
		return strconv.FormatBool(result), err
	case "to-win32":
		return ToWin32(Path(testCase.Raw))
	case "to-wsl":
		return ToWSL(Path(testCase.Raw), testCase.Options.WSL)
	case "to-posix":
		return ToPOSIX(Path(testCase.Raw))
	case "sanitize-component":
		return SanitizeComponent(testCase.Raw, testCase.Profile)
	case "encode-component":
		return EncodeComponent(testCase.Raw, testCase.Profile)
	case "encode-git-ref":
		return EncodeGitRef(testCase.Raw)
	default:
		return "", newError(ErrInvalidPath, "unsupported vector operation")
	}
}

func assertVectorResult(t *testing.T, testCase vectorCase, actual string, err error) {
	t.Helper()
	if testCase.Error != "" {
		if err == nil {
			t.Fatalf("expected error %s, got result %q", testCase.Error, actual)
		}
		if got := errorCode(err); got != testCase.Error {
			t.Fatalf("expected error %s, got %s (%v)", testCase.Error, got, err)
		}
		return
	}
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if actual != testCase.Expected {
		t.Fatalf("expected %q, got %q", testCase.Expected, actual)
	}
}

func errorCode(err error) string {
	var pathErr *Error
	if errors.As(err, &pathErr) {
		return string(pathErr.Code)
	}
	return err.Error()
}
