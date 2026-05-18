package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"

	"github.com/romanilyin/canonicalpath/packages/go/canonicalpath"
)

type vectorFile struct {
	Cases []vectorCase `json:"cases"`
}

type vectorCase struct {
	ID        string                `json:"id"`
	Operation string                `json:"operation"`
	Raw       string                `json:"raw"`
	Root      string                `json:"root"`
	Target    string                `json:"target"`
	Relative  string                `json:"relative"`
	Profile   string                `json:"profile"`
	Options   canonicalpath.Options `json:"options"`
}

type output struct {
	Version int      `json:"version"`
	Results []result `json:"results"`
}

type result struct {
	File      string `json:"file"`
	ID        string `json:"id"`
	Operation string `json:"operation"`
	Status    string `json:"status"`
	Value     string `json:"value,omitempty"`
	Error     string `json:"error,omitempty"`
}

func main() {
	outPath := flag.String("out", "", "write results to this JSON file instead of stdout")
	specDir := flag.String("spec", filepath.Join("spec", "testdata"), "spec testdata directory")
	flag.Parse()

	results, err := collectResults(*specDir)
	if err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

	data, err := json.MarshalIndent(output{Version: 1, Results: results}, "", "  ")
	if err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	data = append(data, '\n')

	if *outPath == "" {
		_, _ = os.Stdout.Write(data)
		return
	}
	if err := os.MkdirAll(filepath.Dir(*outPath), 0o755); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := os.WriteFile(*outPath, data, 0o644); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func collectResults(specDir string) ([]result, error) {
	files, err := filepath.Glob(filepath.Join(specDir, "*_cases.json"))
	if err != nil {
		return nil, err
	}
	sort.Strings(files)

	results := make([]result, 0)
	for _, file := range files {
		vectors, err := readVectorFile(file)
		if err != nil {
			return nil, err
		}
		base := filepath.Base(file)
		for _, testCase := range vectors.Cases {
			value, err := runVector(testCase)
			entry := result{File: base, ID: testCase.ID, Operation: testCase.Operation}
			if err != nil {
				entry.Status = "error"
				entry.Error = string(canonicalpath.Code(err))
				if entry.Error == "" {
					entry.Error = err.Error()
				}
			} else {
				entry.Status = "ok"
				entry.Value = value
			}
			results = append(results, entry)
		}
	}
	return results, nil
}

func readVectorFile(file string) (vectorFile, error) {
	data, err := os.ReadFile(file)
	if err != nil {
		return vectorFile{}, err
	}
	var vectors vectorFile
	if err := json.Unmarshal(data, &vectors); err != nil {
		return vectorFile{}, err
	}
	return vectors, nil
}

func runVector(testCase vectorCase) (string, error) {
	switch testCase.Operation {
	case "normalize":
		value, err := canonicalpath.Normalize(testCase.Raw, testCase.Options)
		return string(value), err
	case "relative":
		value, err := canonicalpath.Relative(canonicalpath.Path(testCase.Root), canonicalpath.Path(testCase.Target))
		return string(value), err
	case "join":
		value, err := canonicalpath.Join(canonicalpath.Path(testCase.Root), canonicalpath.RelativePath(testCase.Relative))
		return string(value), err
	case "is-equal":
		value, err := canonicalpath.IsEqual(testCase.Root, testCase.Target, testCase.Options)
		return strconv.FormatBool(value), err
	case "to-win32":
		return canonicalpath.ToWin32(canonicalpath.Path(testCase.Raw))
	case "to-wsl":
		return canonicalpath.ToWSL(canonicalpath.Path(testCase.Raw), testCase.Options.WSL)
	case "to-posix":
		return canonicalpath.ToPOSIX(canonicalpath.Path(testCase.Raw))
	case "sanitize-component":
		return canonicalpath.SanitizeComponent(testCase.Raw, testCase.Profile)
	case "encode-component":
		return canonicalpath.EncodeComponent(testCase.Raw, testCase.Profile)
	case "encode-git-ref":
		return canonicalpath.EncodeGitRef(testCase.Raw)
	default:
		return "", fmt.Errorf("unsupported vector operation %q", testCase.Operation)
	}
}
