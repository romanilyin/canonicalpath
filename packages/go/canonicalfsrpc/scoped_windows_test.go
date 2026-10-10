//go:build windows

package canonicalfsrpc

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestScopedEndpointsRejectWindowsJunction(t *testing.T) {
	project := t.TempDir()
	protected := filepath.Join(project, "ProjectSettings")
	if err := os.MkdirAll(protected, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(protected, "secret.txt"), []byte("protected"), 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(project, "Temp", "SGGUnityMcp", "session-1")
	if err := os.MkdirAll(filepath.Dir(link), 0700); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; New-Item -ItemType Junction -Path $env:CP_TEST_LINK -Target $env:CP_TEST_TARGET | Out-Null")
	cmd.Env = append(os.Environ(), "CP_TEST_LINK="+link, "CP_TEST_TARGET="+protected)
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("create junction: %v %s", err, output)
	}
	assertScopedProtected(t, project, "temp_session", "session-1/secret.txt")
}
