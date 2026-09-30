import { StreamdownTextPrimitive } from '@assistant-ui/react-streamdown'
import { code } from '@streamdown/code'
import { math } from '@streamdown/math'
import { cjk } from '@streamdown/cjk'
import 'katex/dist/katex.min.css'

const plugins = { code, math, cjk }
const components = {
  // Images in an answer never make a request to an outside server.
  img: ({ alt }: { alt?: string }) => <span className="text-muted-foreground">{alt}</span>,
}

export function Markdown() {
  return <StreamdownTextPrimitive plugins={plugins} components={components} controls={false} linkSafety={{ enabled: false }} className="jezo-markdown" />
}
