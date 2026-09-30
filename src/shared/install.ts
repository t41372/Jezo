import type { SkillInstallResult, SkillPreview } from './skills'

export interface InstallChoice {
  id: string
  title: string
  description: string
  source: string
  destination: string
  resources?: string[]
}

export type InstallPreview =
  | { kind: 'skill'; preview: SkillPreview }
  | { kind: 'package' | 'mcp'; token: string; choices: InstallChoice[] }

export interface InstallResult {
  installed: string[]
  conflicts: string[]
  skills?: SkillInstallResult
}

export interface InstallOrigin {
  source: string
  installed: string
  by: 'user' | 'agent'
  ref?: string
}

export interface InstalledPackage {
  source: string
  enabled: boolean
  origin?: InstallOrigin
  resources: { kind: string; path: string }[]
}

export interface InstalledMcp {
  name: string
  source: string
  enabled: boolean
  origin?: InstallOrigin
  state: 'connecting' | 'connected' | 'disconnected' | 'needs-auth' | 'failed' | 'closed' | 'disabled'
  tools: string[]
  error?: string
}

export interface InstalledResources {
  packages: InstalledPackage[]
  servers: InstalledMcp[]
}

export interface ExtensionQuestion {
  id: string
  kind: 'confirm' | 'select' | 'input'
  title: string
  message?: string
  options?: string[]
  placeholder?: string
  expires?: number
  answered?: boolean
  answer?: string | boolean
}

export interface ExtensionNotice {
  message: string
  type: 'info' | 'warning' | 'error'
}
