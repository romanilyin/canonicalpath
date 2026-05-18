package canonicalpath

import (
	"path/filepath"
	"testing"
)

func TestNormalizeVectorsIdempotent(t *testing.T) {
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
				if testCase.Operation != "normalize" || testCase.Expected == "" {
					continue
				}
				testCase := testCase
				t.Run(testCase.ID, func(t *testing.T) {
					actual, err := Normalize(testCase.Expected, testCase.Options)
					if err != nil {
						t.Fatalf("normalizing canonical output failed: %v", err)
					}
					if string(actual) != testCase.Expected {
						t.Fatalf("not idempotent: %q -> %q", testCase.Expected, actual)
					}
				})
			}
		})
	}
}
