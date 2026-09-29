import { useEffect, useState } from 'react'

/** The current time, updated every `ms` while `active`. */
export function useNow(ms: number, active = true) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(timer)
  }, [ms, active])
  return now
}
