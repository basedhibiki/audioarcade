'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import '@livekit/components-styles';

export default function Home() {
  const router = useRouter()
  const [slug, setSlug] = useState('demo')

  function goToChannel(target?: string) {
    const name = ((target ?? slug) || 'demo').trim()
    router.push(`/channel/${encodeURIComponent(name)}`)
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-6 text-center">
        <h1 className="text-3xl font-semibold">Audio Arcade</h1>
        <p className="opacity-80">Open a channel by name, or try the demo.</p>

        <div className="space-y-3">
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="channel name (e.g. demo)"
            className="ps2-input w-full"
          />
          <div className="ps2-grid">
            <button onClick={() => goToChannel()} className="ps2-btn">
              Join Channel
            </button>
            <button onClick={() => goToChannel('demo')} className="ps2-btn">
              Quick Demo
            </button>
          </div>
        </div>

        <div className="opacity-70 text-sm">
          Tip: Controls (Take/Pass AUX, Collab, Listen) live inside the channel page.
        </div>
      </div>
    </main>
  )
}
