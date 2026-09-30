/** Where a top-level skill came from, saved in skills/installed.yaml. */
export interface SkillOrigin {
  name: string
  source: string
  ref?: string
  path?: string
  installed: string
  by: 'user' | 'agent'
  hash?: string
  /** These files are removed with the skill, but aren't covered by text undo. */
  binary?: string[]
}

/** A skill as the 它用的方法 page shows it. `id` is its workspace directory. */
export interface SkillInfo {
  id: string
  name: string
  title: string
  description: string
  enabled: boolean
  instructions: string
  broken?: boolean
  origin?: SkillOrigin
  removable?: boolean
  updatable?: boolean
  programs?: boolean
}

export interface SkillCandidate {
  path: string
  name: string
  title: string
  description: string
  files: number
  programs: boolean
}

export interface SkillSkipped {
  count: number
  reason: string
}

/** Files stay in the main process until the user installs or closes the dialog. */
export interface SkillPreview {
  token: string
  skills: SkillCandidate[]
  skipped: SkillSkipped[]
  modified?: boolean
}

export interface SkillInstallResult {
  installed: { name: string; title: string; directory: string; files: number; binary?: number }[]
  skipped: SkillSkipped[]
  /** Nothing is installed until these replacements have been agreed to. */
  conflicts: string[]
  modified?: boolean
}
