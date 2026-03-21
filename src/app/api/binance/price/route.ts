import { NextResponse } from 'next/server'

// Edge runtime kullan (Vercel için optimize)
export const runtime = 'edge'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const symbols = searchParams.get('symbols')
    const symbol = searchParams.get('symbol')
    
    let url = 'https://fapi.binance.com/fapi/v1/ticker/price'
    if (symbols) {
      url += `?symbols=${symbols}`
    } else if (symbol) {
      url += `?symbol=${symbol}`
    }
    
    const response = await fetch(url, {
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
    console.error('Binance price API proxy error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch price from Binance API', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
