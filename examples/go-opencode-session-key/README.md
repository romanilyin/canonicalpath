# Go OpenCode Session Key Example

Use `canonicalpath` for deterministic project identity. Do not use it as a filesystem sandbox.

```go
package main

import (
    "fmt"

    "github.com/romanilyin/canonicalpath/packages/go/canonicalpath"
)

func main() {
    canon, err := canonicalpath.Normalize(`C:\Users\Alice\Repo`, canonicalpath.Options{
        SourceHost:    canonicalpath.HostWin32,
        TargetProfile: canonicalpath.TargetWin32Drive,
    })
    if err != nil {
        panic(err)
    }

    projectKey := string(canon)
    fmt.Println(projectKey) // c:/Users/Alice/Repo
}
```

Store this value as `projects.canonical_project_path`, then link sessions by stable `project_id`. Do not make sessions unique by canonical path.
