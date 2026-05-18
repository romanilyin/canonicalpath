# Go Safe File Tool Example

Use `canonicalfs` for real project-root-bound file access. File tool payloads should pass a project root plus a path relative to that root.

```go
package main

import (
    "fmt"

    "github.com/romanilyin/canonicalpath/packages/go/canonicalfs"
)

func main() {
    root, err := canonicalfs.OpenRoot("/home/alice/repo")
    if err != nil {
        panic(err)
    }
    defer root.Close()

    data, err := root.ReadFile("README.md", 1<<20)
    if err != nil {
        panic(err)
    }

    fmt.Printf("%d bytes\n", len(data))
}
```

Rules:

- Accept only relative paths from file tool payloads.
- Reject absolute paths, NUL, and `..` escapes before I/O.
- Do not implement access as `filepath.Join(root, userPath)` followed by `os.Open`.
- `Rename` is unsupported on Go 1.24 until a root-bound implementation is available.
