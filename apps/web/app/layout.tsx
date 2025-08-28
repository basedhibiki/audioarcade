// apps/web/app/layout.tsx
import type { Metadata } from 'next'
import React from 'react'

export const metadata: Metadata = { title: 'Audio Arcade' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'Inter, system-ui' }}>{children}</body>
    </html>
  )
}
