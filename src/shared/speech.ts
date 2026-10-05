/** Standard ASR declarations are extensible; retain fields this Jezo doesn't know yet. */
export interface SpeechSchema {
  type?: string
  title?: string
  description?: string
  default?: unknown
  enum?: unknown[]
  const?: unknown
  format?: string
  writeOnly?: boolean
  properties?: Record<string, SpeechSchema>
  required?: string[]
  anyOf?: SpeechSchema[]
  $ref?: string
  $defs?: Record<string, SpeechSchema>
  [field: string]: unknown
}

export interface SpeechPackage {
  name: string
  version: string
  source: string | null
  commit: string | null
  revision: string | null
  vcs: string | null
  subdirectory: string | null
  editable: boolean
  engines: string[]
}

export interface SpeechModel {
  id: string
  engine: string
  name: string
  package: string
  properties: Record<string, unknown>
  capabilities: SpeechCapabilities
  metadata: Record<string, unknown>
  /** How Jezo records for this model, from the adapter's one rule. null when the declarations can't be read. */
  dictation: SpeechDictation | null
  error: string | null
}

export interface SpeechDictation {
  /** The artifact and capability mode recognition runs in. */
  mode: 'batch' | 'streaming'
  /** Audio goes to the engine while the user talks, so words can appear as they speak. */
  incremental: boolean
  sampleRate: number
}

export interface SpeechCapability {
  supported?: boolean
  [field: string]: unknown
}

export interface SpeechModeCapabilities {
  language?: { runtime_override?: SpeechCapability; candidate_languages?: SpeechCapability }
  guidance?: { prompt?: SpeechCapability; phrase_hints?: SpeechCapability; mutable_mid_stream?: SpeechCapability }
  emits_partials?: SpeechCapability
  partial_stability?: SpeechCapability
  re_segments?: SpeechCapability
  finality_level?: { mode: string }
  [field: string]: unknown
}

export interface SpeechCapabilities {
  batch?: SpeechModeCapabilities | null
  streaming?: SpeechModeCapabilities | null
  streaming_input?: SpeechCapability
  streaming_output?: SpeechCapability
  [field: string]: unknown
}

/** Unknown declaration nodes stay visible, without assuming the next protocol's shape. */
export function speechCapabilityAt(tree: unknown, path: string): SpeechCapability | null {
  let node: unknown = tree
  for (const field of path.split('.')) {
    if (!node || typeof node !== 'object') return null
    node = (node as Record<string, unknown>)[field]
  }
  return node && typeof node === 'object' ? (node as SpeechCapability) : null
}

export interface SpeechArtifactReport {
  mode: string
  applicable: boolean
  readiness: string
  requirements: {
    artifact_id: string
    label: string
    state: string
    required_for_inference: boolean
    can_acquire_now: boolean
    may_acquire_during_inference: boolean
    source_is_mutable: boolean
    acquisition_blocker: string | null
    required_actions: { kind: string; message: string; url: string | null }[]
    location: string | null
    size_bytes: number | null
    expected_size_bytes: number | null
    artifact_version: string | null
  }[]
  diagnostics: unknown[]
}

export interface SpeechModelSettings {
  config: Record<string, unknown>
  options: Record<string, unknown>
  provider: Record<string, unknown>
  deadlines?: Record<string, unknown>
}

export interface SpeechModelDetail extends SpeechModel {
  /** From the configured instance when it constructs, which can differ from the class declaration. */
  dictation: SpeechDictation | null
  /** Configured instance declarations. null means construction failed. */
  effectiveCapabilities: SpeechCapabilities | null
  configurationError: string | null
  configSchema: SpeechSchema
  paramsSchema: SpeechSchema
  runtimeSchema: SpeechSchema
  deadlinesSchema: SpeechSchema
  settings: SpeechModelSettings
  /** Credential names only. Their values never return to the renderer. */
  secrets: string[]
  artifacts: Partial<Record<'batch' | 'streaming', SpeechArtifactReport>>
  artifactErrors: Partial<Record<'batch' | 'streaming', string>>
  cacheRoot: string | null
  acquisitionError?: {
    mode: string
    message: string
    reason: string | null
    required_actions: { kind: string; message: string; url: string | null }[]
    retriable_after: number | null
    report?: SpeechArtifactReport
  }
}

export interface SpeechUpdate {
  name: string
  current: string
  latest: string | null
  requirement: string | null
  error: string | null
}

export interface SpeechInventory {
  core: SpeechPackage | null
  plugins: SpeechPackage[]
  models: SpeechModel[]
  packages: SpeechPackage[]
  python: string | null
  /** Pre-release protocol versions alone cannot identify the PR 107 contract. */
  runtime: { stableText: boolean; sessionCapabilityChecks: boolean } | null
  uv: string | null
  updates: SpeechUpdate[]
  checkedAt: string | null
  diagnostics: string[]
  sessionDiagnostics: { model: string; diagnostic: SpeechDiagnostic }[]
}

export interface SpeechDiagnostic {
  code: string
  level: string
  message: string
  param?: string | null
  provided?: unknown
  effective?: unknown
  [field: string]: unknown
}

export type SpeechCommand =
  | { kind: 'refresh' | 'checkUpdates' | 'diagnose' }
  | { kind: 'installPlugin'; requirement: string }
  | { kind: 'uninstallPlugin' | 'updatePackage'; name: string }
  | { kind: 'updatePackages'; names: string[] }
  | { kind: 'select'; model: string | null }
  | { kind: 'saveModel'; model: string; settings: SpeechModelSettings; secrets: Record<string, string | null> }
  | { kind: 'acquire'; model: string; mode: 'batch' | 'streaming'; refresh: boolean }
