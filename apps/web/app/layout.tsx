// apps/web/app/layout.tsx
import type { Metadata } from 'next'
import React from 'react'
import './globals.css';
import '@livekit/components-styles';

import XMBNavCvS2 from './components/XMBNavCvS2';
export const metadata: Metadata = { title: 'Audio Arcade' }
import './globals.css'
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'Inter, system-ui' }}>{children}</body>
    </html>
  )
  
}


