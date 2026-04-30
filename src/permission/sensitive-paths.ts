const SENSITIVE_FILE_PATTERNS: RegExp[] = [
  /^\.env$/,
  /^\.env\..+/,
  /\.pem$/,
  /\.key$/,
  /^id_rsa$/,
  /^id_ed25519$/,
  /^\.npmrc$/,
  /^\.pypirc$/,
  /^\.netrc$/,
  /secret/i,
  /credential/i,
  /token/i,
];

const SENSITIVE_SEARCH_FILE_GLOBS = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "id_rsa",
  "id_ed25519",
  "*secret*",
  "*credential*",
  "*token*",
];

const SENSITIVE_DIRS = [".ssh", ".aws", ".git"];

export function isSensitiveReadPath(realPath: string): boolean {
  const segments = realPath.split("/").filter(Boolean);
  for (const seg of segments) {
    if (SENSITIVE_DIRS.includes(seg)) return true;
    for (const pat of SENSITIVE_FILE_PATTERNS) {
      if (pat.test(seg)) return true;
    }
  }
  return false;
}

export function sensitiveRgExcludeGlobs(): string[] {
  return [
    ...SENSITIVE_DIRS.map((dir) => `!${dir}`),
    ...SENSITIVE_SEARCH_FILE_GLOBS.map((glob) => `!${glob}`),
  ];
}

export function sensitiveGrepExcludeArgs(): string[] {
  return [
    ...SENSITIVE_DIRS.map((dir) => `--exclude-dir=${dir}`),
    ...SENSITIVE_SEARCH_FILE_GLOBS.map((glob) => `--exclude=${glob}`),
  ];
}
