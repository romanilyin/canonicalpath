package canonicalpath

import (
	"encoding/json"
	"os"
	"testing"
)

type unityMCPPathScopeVectorFile struct {
	Cases []unityMCPPathScopeVectorCase `json:"cases"`
}

type unityMCPPathScopeVectorCase struct {
	ID                      string `json:"id"`
	Scope                   string `json:"scope"`
	Raw                     string `json:"raw"`
	ExpectedProjectRelative string `json:"expectedProjectRelative"`
	ExpectedCacheRelative   string `json:"expectedCacheRelative"`
	Error                   string `json:"error"`
}

func TestNormalizeUnityMCPScopedPathVectors(t *testing.T) {
	data, err := os.ReadFile("../../../spec/testdata/unity_mcp_path_scope_vectors.json")
	if err != nil {
		t.Fatal(err)
	}

	var vectors unityMCPPathScopeVectorFile
	if err := json.Unmarshal(data, &vectors); err != nil {
		t.Fatal(err)
	}

	for _, testCase := range vectors.Cases {
		t.Run(testCase.ID, func(t *testing.T) {
			actual, err := NormalizeUnityMCPScopedPath(UnityMCPPathScope(testCase.Scope), testCase.Raw)
			if testCase.Error != "" {
				if err == nil {
					t.Fatalf("expected error %s, got %#v", testCase.Error, actual)
				}
				if string(Code(err)) != testCase.Error {
					t.Fatalf("expected error %s, got %s", testCase.Error, Code(err))
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}

			expectedKind := ScopedPathKindProject
			expectedPath := testCase.ExpectedProjectRelative
			if expectedPath == "" {
				expectedKind = ScopedPathKindCache
				expectedPath = testCase.ExpectedCacheRelative
			}
			if actual.Scope != UnityMCPPathScope(testCase.Scope) || actual.Kind != expectedKind || string(actual.Path) != expectedPath {
				t.Fatalf("expected %s %s %s, got %s %s %s", testCase.Scope, expectedKind, expectedPath, actual.Scope, actual.Kind, actual.Path)
			}
		})
	}
}
