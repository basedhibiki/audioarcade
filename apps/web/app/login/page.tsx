'use client'

import { useEffect, useMemo, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

export default function LoginPage() {
  // Create the client once (not every render)
  const supabase = useMemo(() => {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
  }, [])

  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sent' | 'error'>('idle')

  useEffect(() => {
    supabase.auth.getSession()
  }, [supabase])

  async function signIn() {
    try {
      await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      })
      setStatus('sent')
    } catch (e) {
      console.error(e)
      setStatus('error')
    }
  }

  return (
    <main className="max-w-sm mx-auto p-6 space-y-3">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <input
        className="w-full border p-2 rounded"
        placeholder="you@email.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <button className="w-full border p-2 rounded" onClick={signIn}>
        Send magic link
      </button>
      {status === 'sent' && (
        <p className="text-green-600 text-sm">Check your email for a magic link.</p>
      )}
      {status === 'error' && (
        <p className="text-red-600 text-sm">Couldn’t send link. Try again.</p>
      )}
    </main>
  )
}
