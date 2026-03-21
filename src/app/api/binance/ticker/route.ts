import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const response = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr', {
      headers: {
        'Accept': 'application/json',
      },
    })
    
    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`)
    }
    
    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Binance API proxy error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch from Binance API' },
      { status: 500 }
    )
  }
}
