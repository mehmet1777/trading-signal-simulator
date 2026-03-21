import { NextResponse } from 'next/server'

// Edge runtime kullan (Vercel için optimize)
export const runtime = 'edge'

export async function GET() {
  try {
    const response = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr', {
      headers: {
        'Accept': 'application/json',
      },
      // Cache'i devre dışı bırak
      cache: 'no-store',
    })
    
    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`)
    }
    
    const data = await response.json()
    
    // CORS headers ekle
    return NextResponse.json(data, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  } catch (error) {
    console.error('Binance API proxy error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch from Binance API', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
