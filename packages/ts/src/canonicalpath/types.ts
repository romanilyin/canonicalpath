export type CanonicalPath = string & { readonly __canonicalPath: unique symbol };
export type CanonicalRelativePath = string & { readonly __canonicalRelativePath: unique symbol };

export type HostKind = "posix" | "win32" | "wsl" | "vscode-file-uri" | "dev-container" | "ssh-remote";

export interface WSLOptions {
  enabled?: boolean;
  mountRoot?: string;
}

export interface NormalizeOptions {
  sourceHost?: HostKind;
  targetProfile?: "portable" | "win32-drive" | "posix";
  wsl?: WSLOptions;
  uri?: {
    allowFileUri?: boolean;
    allowVSCodeFileUri?: boolean;
    rejectEncodedSlash?: boolean;
  };
  windows?: {
    preserveExtendedLength?: boolean;
    rejectDeviceNames?: boolean;
    rejectADS?: boolean;
  };
  trimOuterWhitespace?: boolean;
}
