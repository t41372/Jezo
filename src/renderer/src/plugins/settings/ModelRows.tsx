import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Row } from '@/components/ListCard'
import { Segmented } from '@/components/Segmented'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import type { ModelChoice, ModelStatus } from '../../../../shared/bridge'

/**
 * Which model the agent uses. A local one is found on its own; a cloud one
 * needs a key, which goes to the OS keychain and never comes back here.
 */
export function ModelRows() {
  const { t } = useTranslation('settings')
  const [status, setStatus] = useState<ModelStatus | null>(null)
  useEffect(() => {
    window.jezo.models.status().then(setStatus)
  }, [])
  const choose = (choice: ModelChoice) => window.jezo.models.choose(choice).then(setStatus)
  if (!status) return <Row title={t('model')} description={t('modelHint')} />

  const provider = status.cloud.providers.find((p) => p.id === status.cloud.provider)
  return (
    <>
      <Row title={t('model')} description={t('modelHint')}>
        <Segmented
          label={t('model')}
          value={status.use}
          onChange={(use) => choose({ use })}
          options={[
            { value: 'local', label: t('local') },
            { value: 'cloud', label: t('cloud') },
          ]}
        />
      </Row>
      {status.use === 'local' ? (
        status.local ? (
          <Row title={status.local.server} description={t('localFound', { count: status.local.models.length })}>
            <Choose value={status.local.id} options={status.local.models.map((m) => m.id)} onChange={(localId) => choose({ localId })} />
          </Row>
        ) : (
          <Row title={t('localMissing')} description={t('localMissingHint')}>
            <Button variant="outline" size="sm" onClick={() => window.jezo.models.status().then(setStatus)}>
              {t('lookAgain')}
            </Button>
          </Row>
        )
      ) : (
        <>
          <Row title={t('provider')}>
            <Choose
              value={status.cloud.provider}
              options={status.cloud.providers.map((p) => p.id)}
              label={(id) => status.cloud.providers.find((p) => p.id === id)?.name ?? id}
              onChange={(provider) => choose({ provider })}
            />
          </Row>
          <KeyRow provider={provider?.name ?? status.cloud.provider} hasKey={provider?.hasKey ?? false} onSave={(key) => window.jezo.models.setKey(status.cloud.provider, key).then(setStatus)} />
          {status.cloud.id && (
            <Row title={t('cloudModel')}>
              <Choose value={status.cloud.id} options={status.cloud.models} onChange={(cloudId) => choose({ cloudId })} />
            </Row>
          )}
        </>
      )}
    </>
  )
}

function Choose({ value, options, label = (v) => v, onChange }: { value: string; options: string[]; label?: (v: string) => string; onChange: (v: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="max-w-60 gap-1.5" />}>
        <span className="truncate">{label(value)}</span>
        <ChevronDown className="size-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 min-w-56">
        <DropdownMenuRadioGroup value={value} onValueChange={(v) => onChange(v as string)}>
          {options.map((o) => (
            <DropdownMenuRadioItem key={o} value={o} closeOnClick>
              {label(o)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The key is written once and then only shown as saved. */
function KeyRow({ provider, hasKey, onSave }: { provider: string; hasKey: boolean; onSave: (key: string | null) => void }) {
  const { t } = useTranslation('settings')
  const [key, setKey] = useState('')
  if (hasKey) {
    return (
      <Row title={t('key', { provider })} description={t('keySavedHint')}>
        <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Check className="size-3.5 text-ok" strokeWidth={2.5} />
          {t('keySaved')}
        </span>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onSave(null)}>
          {t('keyRemove')}
        </Button>
      </Row>
    )
  }
  return (
    <Row title={t('key', { provider })} description={t('keyHint')}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (key.trim()) onSave(key.trim())
          setKey('')
        }}
      >
        <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={t('keyPlaceholder')} className="h-8 w-52" autoComplete="off" />
        <Button type="submit" size="sm" disabled={!key.trim()}>
          {t('keySave')}
        </Button>
      </form>
    </Row>
  )
}
