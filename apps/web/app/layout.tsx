import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'
import '@livekit/components-styles'

export const metadata: Metadata = {
  title: 'Audio Arcade',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

