/** Subprocess diagnostics shown in speech settings must not expose source credentials. */
export function speechError(error: unknown): string {
  const details = error as { stderr?: unknown; stdout?: unknown; message?: unknown } | null
  const output = [details?.stderr, details?.stdout].map((value) => String(value ?? '')).find((value) => value.trim())
  // execFile's message includes its arguments, including authenticated URLs.
  // Redact before truncating, while each credential still has its URL prefix.
  return (output ?? String(details?.message || error))
    .replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/?#]*@/gi, '$1***@')
    .slice(-2000)
}
