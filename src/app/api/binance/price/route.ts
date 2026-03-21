import { NextResponse } from 'next/server'

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
    })
    
    if (!response.ok) {
      throw new Error(`Binance API error: ${response.status}`)
    }
    
    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Binance price API proxy error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch price from Binance API' },
      { status: 500 }
    )
  }
}
