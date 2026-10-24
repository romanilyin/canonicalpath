package canonicalfs

import "testing"

func TestZipPathBudgetDefaultsAndInvalidLimits(t *testing.T) {
	defaults, err := defaultZipLimits(ZipLimits{})
	if err != nil || defaults.MaxEntryNameBytes <= 0 || defaults.MaxPathDepth <= 0 ||
		defaults.MaxTotalPathComponents <= 0 || defaults.MaxDirectories <= 0 || defaults.MaxObjects <= 0 {
		t.Fatalf("unbounded ZIP path defaults: %+v, %v", defaults, err)
	}
	for _, limits := range []ZipLimits{
		{MaxEntryNameBytes: -1}, {MaxPathDepth: -1}, {MaxTotalPathComponents: -1}, {MaxDirectories: -1}, {MaxObjects: -1},
	} {
		_, err := defaultZipLimits(limits)
		if Code(err) != ErrReadLimitExceeded {
			t.Fatalf("expected invalid limit rejection, got %v", err)
		}
	}
}
