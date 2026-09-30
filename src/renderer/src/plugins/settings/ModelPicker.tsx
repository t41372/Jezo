import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { ModelRef, ProviderModel } from '../../../../shared/bridge'
import { Capabilities } from './Capabilities'

type Choosable = { provider: string; providerName: string; model: ProviderModel }

/** The models of every provider that's ready, grouped by provider, with search. */
export function ModelPicker({
  value,
  label,
  onChange,
  extra,
}: {
  value: ModelRef | null
  label: React.ReactNode
  onChange: (ref: ModelRef | null) => void
  /** A choice above the models, like "same as the main model". */
  extra?: { label: string; selected: boolean }
}) {
  const { t } = useTranslation('settings')
  const [open, setOpen] = useState(false)
  const [models, setModels] = useState<Choosable[]>([])
  useEffect(() => {
    if (open) window.jezo.providers.choosable().then(setModels)
  }, [open])
  const groups = [...new Map(models.map((m) => [m.provider, m.providerName])).entries()]
  const pick = (ref: ModelRef | null) => {
    onChange(ref)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="max-w-72 gap-1.5" />}>
        <span className="truncate">{label}</span>
        <ChevronDown className="size-3.5 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <Command>
          <CommandInput placeholder={t('models.search')} />
          <CommandList className="max-h-80">
            <CommandEmpty>{t('models.noneFound')}</CommandEmpty>
            {extra && (
              <CommandGroup>
                <CommandItem value="__extra" onSelect={() => pick(null)}>
                  <span className="flex-1">{extra.label}</span>
                  {extra.selected && <Check className="size-3.5" />}
                </CommandItem>
              </CommandGroup>
            )}
            {groups.map(([provider, name]) => (
              <CommandGroup key={provider} heading={name}>
                {models
                  .filter((m) => m.provider === provider)
                  .map(({ model }) => (
                    <CommandItem key={model.id} value={`${name} ${model.id}`} onSelect={() => pick({ provider, id: model.id })}>
                      <span className="min-w-0 flex-1 truncate">{model.name}</span>
                      <Capabilities model={model} compact />
                      {!extra?.selected && value?.provider === provider && value.id === model.id && <Check className="size-3.5" />}
                    </CommandItem>
                  ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
