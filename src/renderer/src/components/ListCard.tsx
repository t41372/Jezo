import { cn } from 'cn'
import { Card } from '@/components/ui/card'

/** A card of rows separated by lines. */
export function ListCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return <Card className={cn('gap-0 py-0 [&>*:not(:last-child)]:border-b', className)}>{children}</Card>
}

export function Row({ title, description, children }: { title: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[14.5px] font-medium">{title}</div>
        {description && <div className="mt-0.5 text-[12.5px] text-pretty text-muted-foreground">{description}</div>}
      </div>
      {children}
    </div>
  )
}
