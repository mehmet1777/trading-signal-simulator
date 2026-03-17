'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import html2canvas from 'html2canvas'

interface TradingPair {
  symbol: string
  baseAsset: string
  quoteAsset: string
  price: string
}

interface TradeData {
  id: string
  symbol: string
  type: 'long' | 'short'
  entryPrice: number
  leverage: number
  investment: number
  currentPrice: number
  pnl: number
  roi: number
  liquidationPrice: number
  isActive: boolean
  startTime: Date
  takeProfit?: number
  stopLoss?: number
}

interface PendingOrder {
  id: string
  symbol: string
  type: 'long' | 'short'
  orderType: 'limit'
  limitPrice: number
  leverage: number
  investment: number
  createdAt: Date
}

interface TradeHistory {
  id: string
  symbol: string
  type: 'long' | 'short'
  entryPrice: number
  exitPrice: number
  leverage: number
  investment: number
  pnl: number
  roi: number
  startTime: Date
  endTime: Date
  duration: number
  status: 'completed' | 'liquidated'
}

interface BinanceTickerItem {
  symbol: string
  lastPrice: string
  [key: string]: string | number
}

export default function CompactTradingSimulator() {
  const [tradingPairs, setTradingPairs] = useState<TradingPair[]>([])
  const [selectedPair, setSelectedPair] = useState<string>('BTCUSDT')
  const [currentPrice, setCurrentPrice] = useState<number>(0)
  const [leverage, setLeverage] = useState<number>(10)
  const [investment, setInvestment] = useState<number>(100)
  const [activeTrades, setActiveTrades] = useState<TradeData[]>([])
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([])
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [wsConnectionStatus, setWsConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected')
  const [orderType, setOrderType] = useState<'buy' | 'sell'>('buy')
  const [orderMode, setOrderMode] = useState<'market' | 'limit'>('market')
  const [orderAmount, setOrderAmount] = useState<string>('')
  const [limitPrice, setLimitPrice] = useState<string>('')
  const [availableBalance] = useState<number>(10000)
  const [percentageAmount, setPercentageAmount] = useState<number>(0)
  const [activeTab, setActiveTab] = useState<'positions' | 'orders'>('positions')
  const [showTpSlModal, setShowTpSlModal] = useState<string | null>(null)
  const [takeProfitPrice, setTakeProfitPrice] = useState<string>('')
  const [stopLossPrice, setStopLossPrice] = useState<string>('')
  const [takeProfitPercentage, setTakeProfitPercentage] = useState<string>('')
  const [stopLossPercentage, setStopLossPercentage] = useState<string>('')
  const [tpSlType, setTpSlType] = useState<'long' | 'short'>('long')
  const [shareTradeId, setShareTradeId] = useState<string | null>(null)
  const [tradeHistory, setTradeHistory] = useState<TradeHistory[]>([])
  const [showStatsModal, setShowStatsModal] = useState<boolean>(false)
  const [coinSearch, setCoinSearch] = useState<string>('')
  const [showCoinDropdown, setShowCoinDropdown] = useState<boolean>(false)
  const [liquidationAlert, setLiquidationAlert] = useState<{
    show: boolean
    trade: TradeData | null
  }>({ show: false, trade: null })
  const [signalPopup, setSignalPopup] = useState<{
    show: boolean
    symbol: string
    type: string
    entry: string
    tp: string
    sl: string
    leverage: string
  } | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const priceUpdateRef = useRef<HTMLDivElement>(null)
  const shareCardRef = useRef<HTMLDivElement>(null)

  // İstatistik hesaplama fonksiyonları
  const calculateStats = () => {
    if (tradeHistory.length === 0) {
      return {
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalPnL: 0,
        totalROI: 0,
        avgPnL: 0,
        avgROI: 0,
        bestTrade: null,
        worstTrade: null,
        totalDuration: 0,
        avgDuration: 0
      }
    }

    const totalTrades = tradeHistory.length
    const winningTrades = tradeHistory.filter(t => t.pnl > 0).length
    const losingTrades = tradeHistory.filter(t => t.pnl < 0).length
    const winRate = (winningTrades / totalTrades) * 100
    
    const totalPnL = tradeHistory.reduce((sum, t) => sum + t.pnl, 0)
    const totalROI = tradeHistory.reduce((sum, t) => sum + t.roi, 0)
    const avgPnL = totalPnL / totalTrades
    const avgROI = totalROI / totalTrades
    
    const bestTrade = tradeHistory.reduce((best, current) => 
      current.pnl > (best?.pnl || -Infinity) ? current : best, null as TradeHistory | null
    )
    
    // En zararlı işlem: sadece zararlı işlemler varsa göster
    const losingTradesForWorst = tradeHistory.filter(t => t.pnl < 0)
    const worstTrade = losingTradesForWorst.length > 0 
      ? losingTradesForWorst.reduce((worst, current) => 
          current.pnl < worst.pnl ? current : worst
        )
      : null
    
    const totalDuration = tradeHistory.reduce((sum, t) => sum + t.duration, 0)
    const avgDuration = totalDuration / totalTrades

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      totalPnL,
      totalROI,
      avgPnL,
      avgROI,
      bestTrade,
      worstTrade,
      totalDuration,
      avgDuration
    }
  }

  const formatDuration = (ms: number): string => {
    const minutes = Math.floor(ms / 60000)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    
    if (days > 0) return `${days}g ${hours % 24}s`
    if (hours > 0) return `${hours}s ${minutes % 60}d`
    return `${minutes}d`
  }

  const getMaxLeverage = (investmentAmount: number): number => {
    if (investmentAmount <= 500) return 125
    if (investmentAmount <= 1000) return 100
    if (investmentAmount <= 3000) return 50
    if (investmentAmount <= 5000) return 25
    if (investmentAmount <= 10000) return 15
    return 10
  }

  const maxLeverage = getMaxLeverage(parseFloat(orderAmount) || 100)

  const formatPrice = (price: number): string => {
    // Tüm fiyatlar için tutarlı format kullan
    if (price >= 1000) {
      return price.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    } else if (price >= 1) {
      return price.toLocaleString('tr-TR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
    } else if (price >= 0.01) {
      return price.toLocaleString('tr-TR', { minimumFractionDigits: 6, maximumFractionDigits: 6 })
    } else {
      return price.toLocaleString('tr-TR', { minimumFractionDigits: 8, maximumFractionDigits: 8 })
    }
  }

  // Formatlanmış fiyat string'ini number'a çevir
  const parseFormattedPrice = (priceStr: string): number => {
    if (!priceStr || priceStr.trim() === '') return 0
    
    // Hem Türkçe hem İngilizce formatları destekle
    let cleaned = priceStr.trim()
    
    // Eğer virgül varsa (Türkçe format): "0,221800" veya "75.000,00"
    if (cleaned.includes(',')) {
      // Türkçe format: binlik ayracı (.) kaldır, ondalık ayracı (,) noktaya çevir
      cleaned = cleaned.replace(/\./g, '').replace(',', '.')
    }
    // Eğer sadece nokta varsa (İngilizce format): "0.221800" veya "75000.00"
    // Hiçbir şey yapma, zaten doğru format
    
    const num = parseFloat(cleaned)
    return isNaN(num) ? 0 : num
  }

  const formatPnL = (pnl: number): string => {
    const sign = pnl >= 0 ? '+' : ''
    return `${sign}${pnl.toFixed(2)}`
  }
  // URL parametrelerinden sinyal bilgilerini oku
  useEffect(() => {
    console.log('🔍 URL kontrol ediliyor...')
    const urlParams = new URLSearchParams(window.location.search)
    const symbol = urlParams.get('symbol')
    const type = urlParams.get('type') // 'long' veya 'short'
    const entry = urlParams.get('entry')
    const tp = urlParams.get('tp')
    const sl = urlParams.get('sl')
    const leverage = urlParams.get('leverage')

    console.log('📊 URL Parametreleri:', { symbol, type, entry, tp, sl, leverage })

    // URL parametreleri varsa popup göster
    if (symbol && type && entry) {
      console.log('🎯 Sinyal parametreleri algılandı:', { symbol, type, entry, tp, sl, leverage })
      
      try {
        const popupData = {
          show: true,
          symbol: symbol.toUpperCase(),
          type: type,
          entry: entry,
          tp: tp || '',
          sl: sl || '',
          leverage: leverage || '10'
        }
        
        console.log('📦 Popup data hazırlandı:', popupData)
        
        // State'i set et
        setSignalPopup(popupData)
        
        console.log('✅ setSignalPopup çağrıldı!')
        
        // URL'yi temizle (parametreleri kaldır) - SONRA yap
        setTimeout(() => {
          window.history.replaceState({}, document.title, window.location.pathname)
          console.log('🧹 URL temizlendi')
        }, 500)
      } catch (error) {
        console.error('❌ Popup ayarlama hatası:', error)
      }
    } else {
      console.log('❌ URL parametreleri eksik veya yok')
    }
  }, []) // Dependency array boş - sadece mount'ta çalışır

  // Sinyal popup'ından sinyali uygula
  const applySignal = () => {
    if (!signalPopup) return
    
    console.log('🚀 Sinyal uygulanıyor:', signalPopup)
    
    // Coin'i seç
    setSelectedPair(signalPopup.symbol)
    
    // Coin search input'unu güncelle
    const coinName = signalPopup.symbol.replace('USDT', '')
    setCoinSearch(coinName)
    
    // İşlem türünü seç
    setOrderType(signalPopup.type === 'short' ? 'sell' : 'buy')
    
    // Limit moduna geç ve giriş fiyatını ayarla
    setOrderMode('limit')
    setLimitPrice(signalPopup.entry)
    
    // Kaldıracı ayarla
    setLeverage(parseInt(signalPopup.leverage))
    
    // TP/SL bilgilerini sakla
    if (signalPopup.tp || signalPopup.sl) {
      sessionStorage.setItem('signalTP', signalPopup.tp)
      sessionStorage.setItem('signalSL', signalPopup.sl)
    }
    
    // Popup'ı kapat
    setSignalPopup(null)
    
    console.log('✅ Sinyal başarıyla uygulandı!')
  }

  // Popup state değişikliklerini izle
  useEffect(() => {
    console.log('🔄 signalPopup state değişti:', signalPopup)
  }, [signalPopup])

  // localStorage'dan trade geçmişini yükle
  useEffect(() => {
    try {
      const savedActiveTrades = localStorage.getItem('activeTrades')
      if (savedActiveTrades) {
        const trades = JSON.parse(savedActiveTrades).map((trade: TradeData & { startTime: string }) => ({
          ...trade,
          startTime: new Date(trade.startTime)
        }))
        setActiveTrades(trades)
        if (trades.length > 0) {
          setSelectedTradeId(trades[0].id)
        }
      }

      const savedPendingOrders = localStorage.getItem('pendingOrders')
      if (savedPendingOrders) {
        const orders = JSON.parse(savedPendingOrders).map((order: PendingOrder & { createdAt: string }) => ({
          ...order,
          createdAt: new Date(order.createdAt)
        }))
        setPendingOrders(orders)
      }

      const savedTradeHistory = localStorage.getItem('tradeHistory')
      if (savedTradeHistory) {
        const history = JSON.parse(savedTradeHistory).map((trade: TradeHistory & { startTime: string, endTime: string }) => ({
          ...trade,
          startTime: new Date(trade.startTime),
          endTime: new Date(trade.endTime)
        }))
        setTradeHistory(history)
      }
    } catch (error) {
      console.error('Trade geçmişi yükleme hatası:', error)
      localStorage.removeItem('activeTrades')
      localStorage.removeItem('pendingOrders')
      localStorage.removeItem('tradeHistory')
    }
  }, [])

  // Binance'dan trading çiftlerini çek
  useEffect(() => {
    const fetchTradingPairs = async () => {
      try {
        console.log('🔄 Binance Futures\'dan coin listesi çekiliyor...')
        // FUTURES API endpoint'i kullan
        const response = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr')
        const data = await response.json()
        const pairs = data
          .filter((item: BinanceTickerItem) => item.symbol.endsWith('USDT'))
          .map((item: BinanceTickerItem) => ({
            symbol: item.symbol,
            baseAsset: item.symbol.replace('USDT', ''),
            quoteAsset: 'USDT',
            price: parseFloat(item.lastPrice).toFixed(8)
          }))
          .sort((a: TradingPair, b: TradingPair) => a.symbol.localeCompare(b.symbol))
        
        console.log(`✅ ${pairs.length} Futures coin çifti yüklendi`)
        setTradingPairs(pairs)
        if (pairs.length > 0) {
          // URL parametresi var mı kontrol et
          const urlParams = new URLSearchParams(window.location.search)
          const urlSymbol = urlParams.get('symbol')
          
          if (urlSymbol) {
            // URL'den coin geliyorsa onu seç
            const urlPair = pairs.find((p: TradingPair) => p.symbol.toUpperCase() === urlSymbol.toUpperCase())
            if (urlPair) {
              setSelectedPair(urlPair.symbol)
              setCurrentPrice(parseFloat(urlPair.price))
              console.log('✅ URL\'den coin seçildi:', urlPair.symbol)
            } else {
              // URL'deki coin bulunamazsa BTC seç
              const btcPair = pairs.find((p: TradingPair) => p.symbol === 'BTCUSDT') || pairs[0]
              setSelectedPair(btcPair.symbol)
              setCurrentPrice(parseFloat(btcPair.price))
            }
          } else {
            // URL parametresi yoksa varsayılan BTC seç
            const btcPair = pairs.find((p: TradingPair) => p.symbol === 'BTCUSDT') || pairs[0]
            setSelectedPair(btcPair.symbol)
            setCurrentPrice(parseFloat(btcPair.price))
          }
        }
      } catch (error) {
        console.error('❌ Futures trading çiftleri yüklenirken hata:', error)
      }
    }

    // İlk yükleme
    fetchTradingPairs()
    
    // Her 5 dakikada bir güncelle (yeni coinler için)
    const interval = setInterval(fetchTradingPairs, 5 * 60 * 1000)
    
    return () => clearInterval(interval)
  }, [])

  // Pozisyon fiyatlarını güncelleyen fonksiyon
  const updateTradePrice = useCallback((symbol: string, newPrice: number) => {
    setActiveTrades(prevTrades => {
      const updatedTrades = prevTrades.map(trade => {
        if (trade.symbol.toLowerCase() === symbol.toLowerCase()) {
          const positionSize = (trade.leverage * trade.investment) / trade.entryPrice
          let pnl = 0
          
          if (trade.type === 'long') {
            pnl = (newPrice - trade.entryPrice) * positionSize
          } else {
            pnl = (trade.entryPrice - newPrice) * positionSize
          }
          
          const roi = (pnl / trade.investment) * 100
          
          return {
            ...trade,
            currentPrice: newPrice,
            pnl,
            roi
          }
        }
        return trade
      })

      // TP/SL kontrolü - Tetiklenen pozisyonları kapat
      const tradesToClose: { id: string, reason: 'take_profit' | 'stop_loss' | 'liquidated' }[] = []
      
      updatedTrades.forEach(trade => {
        if (trade.symbol.toLowerCase() === symbol.toLowerCase()) {
          let shouldClose = false
          let closeReason: 'take_profit' | 'stop_loss' | 'liquidated' | null = null
          
          // Take Profit kontrolü
          if (trade.takeProfit) {
            if (trade.type === 'long') {
              // Long pozisyon: fiyat TP'ye ulaştı veya geçti
              if (newPrice >= trade.takeProfit) {
                shouldClose = true
                closeReason = 'take_profit'
              }
            } else {
              // Short pozisyon: fiyat TP'ye ulaştı veya geçti
              if (newPrice <= trade.takeProfit) {
                shouldClose = true
                closeReason = 'take_profit'
              }
            }
          }
          
          // Stop Loss kontrolü
          if (!shouldClose && trade.stopLoss) {
            if (trade.type === 'long') {
              // Long pozisyon: fiyat SL'ye ulaştı veya geçti
              if (newPrice <= trade.stopLoss) {
                shouldClose = true
                closeReason = 'stop_loss'
              }
            } else {
              // Short pozisyon: fiyat SL'ye ulaştı veya geçti
              if (newPrice >= trade.stopLoss) {
                shouldClose = true
                closeReason = 'stop_loss'
              }
            }
          }
          
          // Liquidation kontrolü
          if (!shouldClose) {
            if (trade.type === 'long') {
              // Long pozisyon: fiyat liquidation seviyesine ulaştı veya geçti
              if (newPrice <= trade.liquidationPrice) {
                shouldClose = true
                closeReason = 'liquidated'
              }
            } else {
              // Short pozisyon: fiyat liquidation seviyesine ulaştı veya geçti
              if (newPrice >= trade.liquidationPrice) {
                shouldClose = true
                closeReason = 'liquidated'
              }
            }
          }
          
          if (shouldClose && closeReason) {
            tradesToClose.push({ id: trade.id, reason: closeReason })
            
            // Liquidation durumunda popup göster
            if (closeReason === 'liquidated') {
              setLiquidationAlert({
                show: true,
                trade: { ...trade, currentPrice: newPrice }
              })
            }
            
            console.log(`🎯 ${closeReason === 'take_profit' ? 'Take Profit' : closeReason === 'stop_loss' ? 'Stop Loss' : 'Liquidation'} tetiklendi! Pozisyon kapatılıyor:`, {
              id: trade.id,
              type: trade.type,
              entryPrice: trade.entryPrice,
              currentPrice: newPrice,
              takeProfit: trade.takeProfit,
              stopLoss: trade.stopLoss,
              liquidationPrice: trade.liquidationPrice,
              pnl: trade.pnl,
              roi: trade.roi
            })
          }
        }
      })

      // Tetiklenen pozisyonları kapat
      if (tradesToClose.length > 0) {
        // Her tetiklenen pozisyon için closeTrade fonksiyonunu çağır
        tradesToClose.forEach(({ id, reason }) => {
          console.log(`🎯 ${reason === 'take_profit' ? 'Take Profit' : reason === 'stop_loss' ? 'Stop Loss' : 'Liquidation'} tetiklendi! Pozisyon kapatılıyor:`, {
            id: id,
            reason: reason
          })
          // closeTrade fonksiyonu hem pozisyonu kapatacak hem de history'ye ekleyecek
          closeTrade(id, reason)
        })
        
        // updatedTrades'i olduğu gibi döndür, closeTrade kendi state'ini güncelleyecek
        return updatedTrades
      }

      return updatedTrades
    })
  }, [])

  // Tek coin için WebSocket bağlantısı (seçili coin için)
  const connectWebSocket = useCallback((symbol: string) => {
    // Önce mevcut bağlantıyı kapat
    if (wsRef.current) {
      console.log('Mevcut WebSocket kapatılıyor...')
      wsRef.current.close()
      wsRef.current = null
    }

    setWsConnectionStatus('connecting')

    setTimeout(() => {
      // Eğer bu arada başka bir bağlantı açıldıysa, bu işlemi iptal et
      if (wsRef.current !== null) {
        console.log('Zaten aktif WebSocket var, yeni bağlantı iptal ediliyor')
        return
      }

      try {
        // FUTURES WebSocket endpoint'i kullan
        const wsUrl = `wss://fstream.binance.com/ws/${symbol.toLowerCase()}@trade`
        const ws = new WebSocket(wsUrl)
        
        ws.onopen = () => {
          console.log('WebSocket bağlandı:', symbol)
          setWsConnectionStatus('connected')
        }

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            const newPrice = parseFloat(data.p)
            
            if (isNaN(newPrice)) return
            
            // Sadece seçili coin için currentPrice'ı güncelle (UI için)
            if (symbol.toLowerCase() === selectedPair.toLowerCase()) {
              setCurrentPrice(prevPrice => {
                if (priceUpdateRef.current) {
                  const element = priceUpdateRef.current
                  if (newPrice > prevPrice) {
                    element.classList.remove('text-red-400')
                    element.classList.add('text-green-400')
                  } else if (newPrice < prevPrice) {
                    element.classList.remove('text-green-400')
                    element.classList.add('text-red-400')
                  }
                  
                  setTimeout(() => {
                    element.classList.remove('text-green-400', 'text-red-400')
                    element.classList.add('text-white')
                  }, 500)
                }
                
                return newPrice
              })
            }
            
            // WebSocket sadece limit emirler için kullanılacak (pozisyon güncellemesi API'den)

            // Bekleyen limit emirlerini kontrol et
            setPendingOrders(prevOrders => {
              if (prevOrders.length === 0) return prevOrders
              
              // localStorage'dan güncel listeyi al (race condition önlemi)
              const storedOrders = localStorage.getItem('pendingOrders')
              const currentOrders = storedOrders ? JSON.parse(storedOrders) : prevOrders
              
              const triggeredOrders: PendingOrder[] = []
              const remainingOrders: PendingOrder[] = []
              
              currentOrders.forEach((order: PendingOrder) => {
                if (order.symbol.toLowerCase() === symbol.toLowerCase()) {
                  let shouldTrigger = false
                  
                  if (order.type === 'long') {
                    // Long için: mevcut fiyat limit fiyatına eşit veya altına düştüğünde tetikle
                    shouldTrigger = newPrice <= order.limitPrice
                  } else {
                    // Short için: mevcut fiyat limit fiyatına eşit veya üstüne çıktığında tetikle
                    shouldTrigger = newPrice >= order.limitPrice
                  }
                  
                  if (shouldTrigger) {
                    triggeredOrders.push(order)
                  } else {
                    remainingOrders.push(order)
                  }
                } else {
                  remainingOrders.push(order)
                }
              })

              // Tetiklenen emirleri pozisyona çevir
              if (triggeredOrders.length > 0) {
                console.log(`${triggeredOrders.length} limit emri tetiklendi, emirler:`, triggeredOrders.map(o => o.id))
                
                // HEMEN localStorage'ı güncelle (race condition önlemi)
                localStorage.setItem('pendingOrders', JSON.stringify(remainingOrders))
                
                // setTimeout ile state güncellemesini bir sonraki tick'e ertele
                setTimeout(() => {
                  const newTrades: TradeData[] = []
                  
                  triggeredOrders.forEach(order => {
                    const liquidationPrice = calculateLiquidationPrice(order.limitPrice, order.leverage, order.type)
                    const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
                    
                    const newTrade: TradeData = {
                      id: tradeId,
                      symbol: order.symbol,
                      type: order.type,
                      entryPrice: order.limitPrice,
                      leverage: order.leverage,
                      investment: order.investment,
                      currentPrice: newPrice,
                      pnl: 0,
                      roi: 0,
                      liquidationPrice,
                      isActive: true,
                      startTime: new Date()
                    }
                    
                    newTrades.push(newTrade)
                  })

                  // Tüm yeni trade'leri tek seferde ekle
                  setActiveTrades(prevTrades => {
                    const updatedTrades = [...prevTrades, ...newTrades]
                    localStorage.setItem('activeTrades', JSON.stringify(updatedTrades))
                    console.log(`${newTrades.length} pozisyon açıldı`)
                    return updatedTrades
                  })
                }, 0)
              }

              // Her durumda remainingOrders döndür (tetiklenen emirler çıkarılmış olacak)
              return remainingOrders
            })
          } catch (parseError) {
            console.error('WebSocket mesaj ayrıştırma hatası:', parseError)
          }
        }

        ws.onerror = () => {
          console.log('WebSocket hata:', symbol)
          setWsConnectionStatus('error')
        }

        ws.onclose = () => {
          console.log('WebSocket kapandı:', symbol)
          setWsConnectionStatus('disconnected')
        }
        
        // Ref'e kaydet
        wsRef.current = ws
      } catch (connectionError) {
        console.error('WebSocket bağlantı hatası:', connectionError)
        setWsConnectionStatus('error')
      }
    }, 100)
  }, [selectedPair])

  // Diğer coinlerin fiyatlarını periyodik olarak güncelle
  useEffect(() => {
    if (activeTrades.length === 0) return

    const updateAllCoinPrices = async () => {
      // Tüm açık pozisyonların coinlerini al (seçili coin dahil)
      const allCoins = [...new Set(activeTrades.map(trade => trade.symbol))]

      if (allCoins.length === 0) return

      try {
        // Tüm coinlerin fiyatlarını tek seferde çek
        const response = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbols=["${allCoins.join('","')}"]`)
        const data = await response.json()
        
        // Her coin için fiyatı güncelle
        data.forEach((ticker: { symbol: string, price: string }) => {
          const newPrice = parseFloat(ticker.price)
          if (!isNaN(newPrice)) {
            // Seçili coin için currentPrice'ı da güncelle
            if (ticker.symbol === selectedPair) {
              setCurrentPrice(newPrice)
            }
            updateTradePrice(ticker.symbol, newPrice)
          }
        })
      } catch (error) {
        console.error('Coin fiyatları güncellenirken hata:', error)
      }
    }

    // İlk güncelleme
    updateAllCoinPrices()
    
    // Her 5 saniyede bir güncelle
    const interval = setInterval(updateAllCoinPrices, 5000)
    
    return () => clearInterval(interval)
  }, [activeTrades, selectedPair, updateTradePrice])

  // Coin seçimi değiştiğinde search input'unu güncelle
  useEffect(() => {
    if (selectedPair && tradingPairs.length > 0) {
      const selectedPairData = tradingPairs.find(pair => pair.symbol === selectedPair)
      if (selectedPairData) {
        setCoinSearch(selectedPairData.baseAsset)
        const newPrice = parseFloat(selectedPairData.price)
        setCurrentPrice(newPrice)
        // Limit price'ı current price ile senkronize et
        if (!limitPrice || limitPrice === '0') {
          setLimitPrice(newPrice.toFixed(4))
        }
      }
      
      connectWebSocket(selectedPair)
    }
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [selectedPair, tradingPairs, connectWebSocket])

  // Click outside handler - dropdown'ı kapat
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('.coin-search-container')) {
        setShowCoinDropdown(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const calculateLiquidationPrice = (entryPrice: number, leverage: number, type: 'long' | 'short') => {
    const priceChange = entryPrice / leverage
    
    if (type === 'long') {
      return entryPrice - priceChange
    } else {
      return entryPrice + priceChange
    }
  }

  const startTrade = () => {
    if (currentPrice === 0) return
    if (activeTrades.length >= 5) {
      alert('⚠️ Maksimum 5 pozisyon açabilirsiniz!')
      return
    }
    
    const amount = parseFloat(orderAmount)
    if (!amount || amount <= 0) {
      alert('⚠️ Geçerli bir miktar girin!')
      return
    }
    
    if (amount > availableBalance) {
      alert('⚠️ Yetersiz bakiye!')
      return
    }

    setIsLoading(true)
    
    setTimeout(() => {
      if (orderMode === 'market') {
        // Market emri - hemen pozisyon aç
        const liquidationPrice = calculateLiquidationPrice(currentPrice, leverage, orderType === 'buy' ? 'long' : 'short')
        const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        
        const newTrade: TradeData = {
          id: tradeId,
          symbol: selectedPair,
          type: orderType === 'buy' ? 'long' : 'short',
          entryPrice: currentPrice,
          leverage,
          investment: amount,
          currentPrice: currentPrice,
          pnl: 0,
          roi: 0,
          liquidationPrice,
          isActive: true,
          startTime: new Date()
        }
        
        setActiveTrades(prev => {
          const newTrades = [...prev, newTrade]
          localStorage.setItem('activeTrades', JSON.stringify(newTrades))
          
          // Sinyal TP/SL bilgileri varsa otomatik ayarla
          const signalTP = sessionStorage.getItem('signalTP')
          const signalSL = sessionStorage.getItem('signalSL')
          
          if (signalTP || signalSL) {
            console.log('🎯 Sinyal TP/SL otomatik ayarlanıyor:', { tp: signalTP, sl: signalSL })
            
            // TP/SL'yi pozisyona ekle
            setTimeout(() => {
              setActiveTrades(prevTrades => {
                const updatedTrades = prevTrades.map(trade => {
                  if (trade.id === tradeId) {
                    return {
                      ...trade,
                      takeProfit: signalTP ? parseFloat(signalTP) : undefined,
                      stopLoss: signalSL ? parseFloat(signalSL) : undefined
                    }
                  }
                  return trade
                })
                localStorage.setItem('activeTrades', JSON.stringify(updatedTrades))
                return updatedTrades
              })
              
              // Sinyal bilgilerini temizle
              sessionStorage.removeItem('signalTP')
              sessionStorage.removeItem('signalSL')
            }, 100)
          }
          
          return newTrades
        })
        
        setSelectedTradeId(tradeId)
      } else {
        // Limit emri - bekleyen emirlere ekle
        const limitPriceValue = parseFloat(limitPrice)
        if (!limitPriceValue || limitPriceValue <= 0) {
          alert('⚠️ Geçerli bir limit fiyatı girin!')
          setIsLoading(false)
          return
        }

        // Limit emri mantık kontrolü
        const tradeType = orderType === 'buy' ? 'long' : 'short'
        let isValidLimitOrder = false

        if (tradeType === 'long') {
          // Long için: limit fiyatı mevcut fiyattan düşük olmalı (daha ucuza almak için)
          isValidLimitOrder = limitPriceValue < currentPrice
          if (!isValidLimitOrder) {
            alert('⚠️ Long pozisyon için limit fiyatı mevcut fiyattan düşük olmalıdır!')
            setIsLoading(false)
            return
          }
        } else {
          // Short için: limit fiyatı mevcut fiyattan yüksek olmalı (daha pahalıya satmak için)
          isValidLimitOrder = limitPriceValue > currentPrice
          if (!isValidLimitOrder) {
            alert('⚠️ Short pozisyon için limit fiyatı mevcut fiyattan yüksek olmalıdır!')
            setIsLoading(false)
            return
          }
        }
        
        const orderId = `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        
        const newOrder: PendingOrder = {
          id: orderId,
          symbol: selectedPair,
          type: tradeType,
          orderType: 'limit',
          limitPrice: limitPriceValue,
          leverage,
          investment: amount,
          createdAt: new Date()
        }
        
        setPendingOrders(prev => {
          const newOrders = [...prev, newOrder]
          localStorage.setItem('pendingOrders', JSON.stringify(newOrders))
          return newOrders
        })
      }
      
      setIsLoading(false)
      setOrderAmount('')
      setLimitPrice('')
      setPercentageAmount(0)
    }, 1000)
  }

  const closeTrade = (tradeId?: string, reason: 'manual' | 'take_profit' | 'stop_loss' | 'liquidated' = 'manual') => {
    const targetTradeId = tradeId || selectedTradeId
    if (!targetTradeId) return
    
    console.log('🔄 closeTrade çağrıldı:', { tradeId: targetTradeId, reason })
    
    setActiveTrades(prev => {
      const tradeToClose = prev.find(t => t.id === targetTradeId)
      if (tradeToClose) {
        console.log('📊 Trade bulundu, history\'ye ekleniyor:', tradeToClose.id)
        // Kapatılan pozisyonu trade history'ye ekle
        const completedTrade: TradeHistory = {
          id: tradeToClose.id,
          symbol: tradeToClose.symbol,
          type: tradeToClose.type,
          entryPrice: tradeToClose.entryPrice,
          exitPrice: tradeToClose.currentPrice,
          leverage: tradeToClose.leverage,
          investment: tradeToClose.investment,
          pnl: tradeToClose.pnl,
          roi: tradeToClose.roi,
          startTime: tradeToClose.startTime,
          endTime: new Date(),
          duration: Date.now() - tradeToClose.startTime.getTime(),
          status: reason === 'liquidated' ? 'liquidated' : 'completed'
        }
        
        setTradeHistory(prevHistory => {
          // Aynı ID'li trade zaten var mı kontrol et (duplikasyon önlemi)
          const existingTrade = prevHistory.find(t => t.id === completedTrade.id)
          if (existingTrade) {
            console.log('⚠️ Duplikasyon önlendi, trade zaten history\'de:', completedTrade.id)
            return prevHistory // Değişiklik yapma
          }
          
          const newHistory = [...prevHistory, completedTrade]
          localStorage.setItem('tradeHistory', JSON.stringify(newHistory))
          console.log('✅ Trade history\'ye eklendi:', completedTrade.id)
          return newHistory
        })
      }
      
      const newTrades = prev.filter(t => t.id !== targetTradeId)
      localStorage.setItem('activeTrades', JSON.stringify(newTrades))
      
      if (selectedTradeId === targetTradeId) {
        setSelectedTradeId(newTrades.length > 0 ? newTrades[0].id : null)
      }
      
      return newTrades
    })
  }

  const cancelOrder = (orderId: string) => {
    setPendingOrders(prev => {
      const newOrders = prev.filter(o => o.id !== orderId)
      localStorage.setItem('pendingOrders', JSON.stringify(newOrders))
      return newOrders
    })
  }

  const handleShareTrade = async (tradeId: string) => {
    setShareTradeId(tradeId)
    
    // DOM'un render olması ve fontların yüklenmesi için bekleme
    setTimeout(async () => {
      const shareCard = shareCardRef.current
      if (!shareCard) return

      try {
        // Fontların yüklenmesini bekle
        await document.fonts.ready
        
        const canvas = await html2canvas(shareCard, {
          logging: false,
          useCORS: true
        })

        canvas.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob)
            const link = document.createElement('a')
            link.download = `trade-${tradeId}.png`
            link.href = url
            link.click()
            URL.revokeObjectURL(url)
          }
          setShareTradeId(null)
        })
      } catch (error) {
        console.error('Paylaşım görseli oluşturma hatası:', error)
        setShareTradeId(null)
      }
    }, 300)
  }

  return (
    <div className="min-h-screen bg-[#0B0E11] text-white">
      {/* Sinyal Popup - EN ÜSTTE */}
      {signalPopup && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4" style={{ zIndex: 9999 }}>
          <div className="bg-[#1E2329] rounded-lg p-6 max-w-md w-full border border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                🚨 Yeni Sinyal Geldi!
              </h2>
              <button
                onClick={() => setSignalPopup(null)}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-3 mb-6">
              <div className="bg-[#2B3139] rounded p-3">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-gray-400 text-sm">Coin:</span>
                  <span className="text-white font-bold text-lg">{signalPopup.symbol}</span>
                </div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-gray-400 text-sm">İşlem Türü:</span>
                  <span className={`font-bold text-lg ${signalPopup.type === 'short' ? 'text-red-400' : 'text-green-400'}`}>
                    {signalPopup.type === 'short' ? '📉 SHORT' : '📈 LONG'}
                  </span>
                </div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-gray-400 text-sm">Giriş Fiyatı:</span>
                  <span className="text-white font-bold">${signalPopup.entry}</span>
                </div>
                {signalPopup.tp && (
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-gray-400 text-sm">Take Profit:</span>
                    <span className="text-green-400 font-bold">${signalPopup.tp}</span>
                  </div>
                )}
                {signalPopup.sl && (
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-gray-400 text-sm">Stop Loss:</span>
                    <span className="text-red-400 font-bold">${signalPopup.sl}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-sm">Kaldıraç:</span>
                  <span className="text-yellow-400 font-bold">{signalPopup.leverage}x</span>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setSignalPopup(null)}
                className="flex-1 bg-gray-600 hover:bg-gray-700 text-white py-3 rounded font-semibold transition-colors"
              >
                İptal
              </button>
              <button
                onClick={applySignal}
                className="flex-1 bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-black py-3 rounded font-semibold transition-colors"
              >
                🚀 Sinyali Uygula
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Liquidation Alert Popup */}
      {liquidationAlert.show && liquidationAlert.trade && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1E2329] rounded-lg w-full max-w-md border-2 border-[#F6465D] shadow-2xl">
            {/* Header */}
            <div className="bg-[#F6465D] px-4 py-3 rounded-t-lg">
              <div className="flex items-center space-x-2">
                <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <h3 className="text-lg font-bold text-white">Pozisyon Liquidate Edildi!</h3>
              </div>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4">
              <div className="text-center">
                <div className="text-xl font-bold text-[#F6465D] mb-2">
                  {liquidationAlert.trade.symbol.replace('USDT', '')}USDT
                </div>
                <div className="text-sm text-gray-400 mb-1">
                  {liquidationAlert.trade.type === 'long' ? 'Long' : 'Short'} • {liquidationAlert.trade.leverage}x Kaldıraç
                </div>
              </div>

              <div className="bg-[#2B3139] rounded-lg p-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Giriş Fiyatı:</span>
                  <span className="text-white">{formatPrice(liquidationAlert.trade.entryPrice)} USDT</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Liquidation Fiyatı:</span>
                  <span className="text-[#F6465D]">{formatPrice(liquidationAlert.trade.liquidationPrice)} USDT</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Son Fiyat:</span>
                  <span className="text-white">{formatPrice(liquidationAlert.trade.currentPrice)} USDT</span>
                </div>
                <div className="border-t border-gray-600 pt-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Toplam Zarar:</span>
                    <span className="text-[#F6465D] font-bold">{formatPnL(liquidationAlert.trade.pnl)} USDT</span>
                  </div>
                </div>
              </div>

              <div className="text-xs text-gray-400 text-center">
                Pozisyonunuz liquidation seviyesine ulaştığı için otomatik olarak kapatılmıştır.
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-700">
              <button
                onClick={() => setLiquidationAlert({ show: false, trade: null })}
                className="w-full bg-[#F6465D] hover:bg-[#E53E3E] text-white py-2 px-4 rounded-lg font-medium transition-colors"
              >
                Tamam
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Paylaşım Kartı - Ekran dışında render edilir */}
      {shareTradeId && activeTrades.find(t => t.id === shareTradeId) && (
        <div style={{ position: 'fixed', left: '-9999px', top: '-9999px' }}>
          <div 
            ref={shareCardRef}
            style={{
              width: '1024px',
              height: '600px',
              background: 'linear-gradient(135deg, #0a0e1a 0%, #141824 50%, #0a0e1a 100%)',
              position: 'relative',
              overflow: 'hidden',
              fontFamily: 'system-ui, -apple-system, sans-serif'
            }}
          >
            {/* Arka plan dekoratif elemanlar - Daha büyük ve renkli */}
            <div style={{
              position: 'absolute',
              top: '-100px',
              right: '-100px',
              width: '500px',
              height: '500px',
              background: 'radial-gradient(circle, rgba(14, 203, 129, 0.12) 0%, transparent 70%)',
              borderRadius: '50%'
            }}></div>
            <div style={{
              position: 'absolute',
              bottom: '-150px',
              left: '-150px',
              width: '600px',
              height: '600px',
              background: 'radial-gradient(circle, rgba(246, 70, 93, 0.08) 0%, transparent 70%)',
              borderRadius: '50%'
            }}></div>
            
            {/* Sağ üst köşe elmaslar - Daha büyük ve belirgin */}
            <div style={{
              position: 'absolute',
              top: '30px',
              right: '50px',
              display: 'flex',
              gap: '12px',
              flexWrap: 'wrap',
              width: '200px'
            }}>
              {[...Array(12)].map((_, i) => (
                <div 
                  key={i}
                  style={{
                    width: '24px',
                    height: '24px',
                    background: i % 3 === 0 ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.06)',
                    transform: 'rotate(45deg)',
                    marginTop: i % 2 === 0 ? '0' : '15px'
                  }}
                ></div>
              ))}
            </div>

            {/* Yıldızlar/noktalar */}
            <div style={{ position: 'absolute', top: '80px', left: '60px', width: '4px', height: '4px', background: 'rgba(255, 255, 255, 0.3)', borderRadius: '50%' }}></div>
            <div style={{ position: 'absolute', top: '150px', left: '120px', width: '3px', height: '3px', background: 'rgba(255, 255, 255, 0.2)', borderRadius: '50%' }}></div>
            <div style={{ position: 'absolute', bottom: '100px', right: '150px', width: '5px', height: '5px', background: 'rgba(255, 255, 255, 0.25)', borderRadius: '50%' }}></div>

            {/* Logo/Branding - Sol Üst - Minimal ve Şık */}
            <div style={{
              position: 'absolute',
              top: '30px',
              left: '80px',
              zIndex: 20,
              display: 'flex',
              alignItems: 'center',
              gap: '18px'
            }}>
              {/* Logo Icon - Gerçek Logo Dosyası - Dengeli Boyut */}
              <div style={{
                width: '48px',
                height: '48px',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '12px',
                overflow: 'hidden',
                background: 'rgba(0, 0, 0, 0.4)',
                backdropFilter: 'blur(10px)'
              }}>
                <img 
                  src="/logo.png" 
                  alt="IndicSigs Logo"
                  style={{
                    width: '48px',
                    height: '48px',
                    objectFit: 'contain',
                    mixBlendMode: 'screen',
                    filter: 'brightness(1.2) contrast(1.1)'
                  }}
                />
              </div>
              
              {/* Brand Text - Tek Satır - Turkuaz */}
              <div style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '10px'
              }}>
                <span style={{
                  fontSize: '24px',
                  fontWeight: '700',
                  color: '#00CED1',
                  letterSpacing: '0.5px',
                  textShadow: '0 0 20px rgba(0, 206, 209, 0.4)'
                }}>
                  İNDİCSİGS
                </span>
                <span style={{
                  fontSize: '16px',
                  fontWeight: '400',
                  color: '#9ca3af',
                  letterSpacing: '1px'
                }}>
                  FUTURES
                </span>
              </div>
            </div>

            {(() => {
              const trade = activeTrades.find(t => t.id === shareTradeId)!
              const typeColor = trade.type === 'long' ? '#0ECB81' : '#F6465D'
              const roiColor = trade.roi >= 0 ? '#0ECB81' : '#F6465D'
              
              return (
                <div style={{ 
                  position: 'relative', 
                  zIndex: 10,
                  padding: '60px 80px',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between'
                }}>
                  {/* Üst Kısım - Pozisyon Bilgileri */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '32px', marginBottom: '50px' }}>
                      <span style={{
                        fontSize: '48px',
                        fontWeight: 'bold',
                        color: typeColor,
                        textShadow: `0 0 20px ${typeColor}40`
                      }}>
                        {trade.type === 'long' ? 'Long' : 'Short'}
                      </span>
                      <div style={{ height: '60px', width: '2px', background: 'rgba(255, 255, 255, 0.2)' }}></div>
                      <span style={{ fontSize: '48px', fontWeight: 'bold', color: '#ffffff' }}>
                        {trade.leverage}x
                      </span>
                      <div style={{ height: '60px', width: '2px', background: 'rgba(255, 255, 255, 0.2)' }}></div>
                      <span style={{ fontSize: '42px', fontWeight: '500', color: '#e5e7eb' }}>
                        {trade.symbol.replace('USDT', '')}USDT Perpetual
                      </span>
                    </div>

                    {/* ROI - Çok Büyük ve Parlak */}
                    <div style={{ marginBottom: '60px' }}>
                      <div style={{
                        fontSize: '120px',
                        fontWeight: 'bold',
                        color: roiColor,
                        textShadow: `0 0 40px ${roiColor}60`,
                        letterSpacing: '-2px'
                      }}>
                        {trade.roi >= 0 ? '+' : ''}{trade.roi.toFixed(2)}%
                      </div>
                    </div>
                  </div>

                  {/* Alt Kısım - Fiyat Bilgileri */}
                  <div style={{ display: 'flex', gap: '80px' }}>
                    <div>
                      <div style={{ 
                        color: '#9ca3af', 
                        fontSize: '20px', 
                        marginBottom: '8px',
                        fontWeight: '500'
                      }}>
                        Entry Price
                      </div>
                      <div style={{
                        color: '#fbbf24',
                        fontSize: '36px',
                        fontFamily: 'monospace',
                        fontWeight: '700',
                        textShadow: '0 0 20px rgba(251, 191, 36, 0.3)'
                      }}>
                        {formatPrice(trade.entryPrice)}
                      </div>
                    </div>
                    <div>
                      <div style={{ 
                        color: '#9ca3af', 
                        fontSize: '20px', 
                        marginBottom: '8px',
                        fontWeight: '500'
                      }}>
                        Last Price
                      </div>
                      <div style={{
                        color: '#fbbf24',
                        fontSize: '36px',
                        fontFamily: 'monospace',
                        fontWeight: '700',
                        textShadow: '0 0 20px rgba(251, 191, 36, 0.3)'
                      }}>
                        {formatPrice(trade.currentPrice)}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-1 sm:px-2 py-1 sm:py-1">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-1 sm:gap-2">
          
          {/* Sol Panel - Trading Form */}
          <div className="order-1">
            <div className="bg-[#1E2329] rounded-lg p-2 space-y-1.5 h-fit sticky top-1">
              
              {/* Fiyat Gösterimi ve Coin Seçimi - Yan Yana */}
              <div className="flex items-center gap-2">
                {/* Coin Seçimi - Arama Özellikli */}
                <div className="flex-1 relative coin-search-container">
                  <input
                    type="text"
                    placeholder="Coin ara... (örn: BTC, ETH)"
                    value={coinSearch}
                    onChange={(e) => {
                      setCoinSearch(e.target.value)
                      setShowCoinDropdown(true)
                    }}
                    onFocus={() => setShowCoinDropdown(true)}
                    className="w-full bg-[#2B3139] border border-gray-600 rounded px-2 py-1.5 text-white focus:border-[#F0B90B] focus:outline-none text-sm"
                  />
                  
                  {/* Dropdown Listesi */}
                  {showCoinDropdown && (
                    <div className="absolute top-full left-0 right-0 bg-[#2B3139] border border-gray-600 rounded-b max-h-48 overflow-y-auto z-50 mt-1">
                      {tradingPairs
                        .filter(pair => 
                          pair.baseAsset.toLowerCase().includes(coinSearch.toLowerCase()) ||
                          pair.symbol.toLowerCase().includes(coinSearch.toLowerCase())
                        )
                        .slice(0, 10) // İlk 10 sonuç
                        .map((pair) => (
                          <div
                            key={pair.symbol}
                            onClick={() => {
                              setSelectedPair(pair.symbol)
                              setCoinSearch(pair.baseAsset)
                              setShowCoinDropdown(false)
                            }}
                            className="px-2 py-1.5 hover:bg-[#3B4149] cursor-pointer text-sm text-white flex justify-between"
                          >
                            <span>{pair.baseAsset}/USDT</span>
                            <span className="text-xs text-gray-400">${formatPrice(parseFloat(pair.price))}</span>
                          </div>
                        ))
                      }
                      {tradingPairs.filter(pair => 
                        pair.baseAsset.toLowerCase().includes(coinSearch.toLowerCase()) ||
                        pair.symbol.toLowerCase().includes(coinSearch.toLowerCase())
                      ).length === 0 && (
                        <div className="px-2 py-1.5 text-sm text-gray-400">
                          Coin bulunamadı
                        </div>
                      )}
                    </div>
                  )}
                </div>
                
                {/* Fiyat Gösterimi - Sağ */}
                <div className="flex items-center space-x-1 bg-[#2B3139] rounded px-2 py-1.5">
                  <div className={`w-1 h-1 rounded-full ${
                    wsConnectionStatus === 'connected' ? 'bg-green-400' : 'bg-red-400'
                  }`}></div>
                  <div 
                    ref={priceUpdateRef}
                    className="text-sm font-bold text-white transition-colors duration-300 whitespace-nowrap"
                  >
                    ${formatPrice(currentPrice)}
                  </div>
                </div>
              </div>
              {/* Buy/Sell Tabs - Binance Style */}
              <div className="flex bg-[#2B3139] rounded p-0.5">
                <button
                  onClick={() => setOrderType('buy')}
                  className={`flex-1 py-1 px-1 font-medium transition-all rounded text-xs ${
                    orderType === 'buy'
                      ? 'bg-[#0ECB81] text-white shadow-lg'
                      : 'text-gray-300 hover:text-white'
                  }`}
                >
                  Buy
                </button>
                <button
                  onClick={() => setOrderType('sell')}
                  className={`flex-1 py-1 px-1 font-medium transition-all rounded text-xs ${
                    orderType === 'sell'
                      ? 'bg-[#F6465D] text-white shadow-lg'
                      : 'text-gray-300 hover:text-white'
                  }`}
                >
                  Sell
                </button>
              </div>

              {/* Available Balance */}
              <div className="flex items-center justify-between text-xs py-1">
                <span className="text-gray-400">Avbl</span>
                <span className="text-white">{availableBalance.toFixed(2)} USDT</span>
              </div>

              {/* Order Type */}
              <div className="flex items-center bg-[#2B3139] rounded px-2 py-1.5">
                <svg className="w-3 h-3 text-gray-400 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <select
                  value={orderMode}
                  onChange={(e) => setOrderMode(e.target.value as 'market' | 'limit')}
                  className="flex-1 bg-transparent text-white focus:outline-none text-sm"
                >
                  <option value="market">Market</option>
                  <option value="limit">Limit</option>
                </select>
              </div>



              {/* Amount Input */}
              <div className="bg-[#2B3139] rounded px-2 py-0.5">
                <div className="flex items-center justify-between">
                  <button 
                    onClick={() => {
                      const current = parseFloat(orderAmount) || 0
                      const newAmount = Math.max(0, current - 10)
                      setOrderAmount(newAmount.toString())
                    }}
                    className="w-3 h-3 flex items-center justify-center bg-[#3B4149] hover:bg-[#4B5159] rounded text-gray-300 hover:text-white transition-colors"
                  >
                    <svg className="w-2 h-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                    </svg>
                  </button>
                  <div className="flex-1 text-center">
                    <div className="text-xs text-gray-400 mb-0.5">Amount (USDT)</div>
                    <input
                      type="number"
                      value={orderAmount}
                      onChange={(e) => setOrderAmount(e.target.value)}
                      className="w-full bg-transparent text-white text-center text-sm focus:outline-none placeholder-gray-500"
                      placeholder="0"
                    />
                  </div>
                  <button 
                    onClick={() => {
                      const current = parseFloat(orderAmount) || 0
                      const newAmount = current + 10
                      setOrderAmount(newAmount.toString())
                    }}
                    className="w-3 h-3 flex items-center justify-center bg-[#3B4149] hover:bg-[#4B5159] rounded text-gray-300 hover:text-white transition-colors"
                  >
                    <svg className="w-2 h-2" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Limit Price Input - Sadece Limit seçildiğinde göster */}
              {orderMode === 'limit' && (
                <div className="bg-[#2B3139] rounded px-2 py-0.5">
                  <div className="flex items-center justify-between">
                    <button 
                      onClick={() => {
                        const current = parseFloat(limitPrice) || currentPrice
                        const newPrice = Math.max(0, current - (currentPrice * 0.001))
                        setLimitPrice(newPrice.toFixed(4))
                      }}
                      className="w-3 h-3 flex items-center justify-center bg-[#3B4149] hover:bg-[#4B5159] rounded text-gray-300 hover:text-white transition-colors"
                    >
                      <svg className="w-2 h-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                      </svg>
                    </button>
                    <div className="flex-1 text-center">
                      <div className="text-xs text-gray-400 mb-0.5">Limit Price (USDT)</div>
                      <input
                        type="number"
                        value={limitPrice}
                        onChange={(e) => setLimitPrice(e.target.value)}
                        className="w-full bg-transparent text-white text-center text-sm focus:outline-none placeholder-gray-500"
                        placeholder={formatPrice(currentPrice)}
                      />
                    </div>
                    <button 
                      onClick={() => {
                        const current = parseFloat(limitPrice) || currentPrice
                        const newPrice = current + (currentPrice * 0.001)
                        setLimitPrice(newPrice.toFixed(4))
                      }}
                      className="w-3 h-3 flex items-center justify-center bg-[#3B4149] hover:bg-[#4B5159] rounded text-gray-300 hover:text-white transition-colors"
                    >
                      <svg className="w-2 h-2" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}
              {/* Percentage Slider */}
              <div className="space-y-0.5">
                <div className="flex justify-between gap-0.5">
                  {[0, 25, 50, 75, 100].map((percent) => (
                    <button
                      key={percent}
                      onClick={() => {
                        setPercentageAmount(percent)
                        const amount = (availableBalance * percent / 100).toFixed(2)
                        setOrderAmount(amount)
                      }}
                      className={`flex-1 py-0.5 text-xs rounded transition-colors ${
                        percentageAmount >= percent 
                          ? 'bg-[#F0B90B] text-black font-medium' 
                          : 'bg-[#2B3139] text-gray-400 hover:text-white'
                      }`}
                    >
                      {percent}%
                    </button>
                  ))}
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={percentageAmount}
                  onChange={(e) => {
                    const percent = Number(e.target.value)
                    setPercentageAmount(percent)
                    const amount = (availableBalance * percent / 100).toFixed(2)
                    setOrderAmount(amount)
                  }}
                  className="w-full h-0.5 bg-[#2B3139] rounded appearance-none cursor-pointer slider"
                  style={{
                    background: `linear-gradient(to right, #F0B90B 0%, #F0B90B ${percentageAmount}%, #2B3139 ${percentageAmount}%, #2B3139 100%)`
                  }}
                />
              </div>



              {/* Kaldıraç */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs text-gray-400">Kaldıraç: {leverage}x</span>
                  <span className="text-xs text-gray-400">(Max: {maxLeverage}x)</span>
                </div>
                <div className="grid grid-cols-6 gap-0.5 mb-0.5">
                  {(() => {
                    // Max kaldıraca göre dinamik butonlar oluştur
                    const leverageButtons = []
                    
                    if (maxLeverage >= 5) leverageButtons.push(5)
                    if (maxLeverage >= 10) leverageButtons.push(10)
                    if (maxLeverage >= 20) leverageButtons.push(20)
                    if (maxLeverage >= 50) leverageButtons.push(50)
                    if (maxLeverage >= 75) leverageButtons.push(75)
                    
                    // Max kaldıracı ekle (eğer zaten yoksa)
                    if (!leverageButtons.includes(maxLeverage)) {
                      leverageButtons.push(maxLeverage)
                    }
                    
                    // İlk 6 butonu al (grid-cols-6 için)
                    return leverageButtons.slice(0, 6).map((lev) => (
                      <button
                        key={lev}
                        onClick={() => setLeverage(lev)}
                        className={`py-0.5 text-xs rounded transition-colors ${
                          leverage === lev
                            ? 'bg-[#F0B90B] text-black'
                            : 'bg-[#2B3139] text-gray-300'
                        }`}
                      >
                        {lev}x
                      </button>
                    ))
                  })()}
                </div>
                <input
                  type="range"
                  min="1"
                  max={maxLeverage}
                  value={leverage}
                  onChange={(e) => setLeverage(Number(e.target.value))}
                  className="w-full h-0.5 bg-[#2B3139] rounded appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, #F0B90B 0%, #F0B90B ${((leverage - 1) / (maxLeverage - 1)) * 100}%, #2B3139 ${((leverage - 1) / (maxLeverage - 1)) * 100}%, #2B3139 100%)`
                  }}
                />
              </div>

              {/* Buy/Sell Button */}
              <button
                onClick={startTrade}
                disabled={isLoading || !orderAmount}
                className={`w-full py-1.5 rounded font-bold text-sm transition-colors disabled:opacity-50 ${
                  orderType === 'buy'
                    ? 'bg-[#0ECB81] hover:bg-[#0BB574] text-white'
                    : 'bg-[#F6465D] hover:bg-[#E53E3E] text-white'
                }`}
              >
                {isLoading ? 'İşleniyor...' : `${orderType === 'buy' ? 'Buy/Long' : 'Sell/Short'}`}
              </button>
            </div>
          </div>

          {/* Sağ Panel - Pozisyonlar */}
          <div className="order-2">
            <div className="bg-[#1E2329] rounded-lg h-fit sticky top-1">
              {/* Tab Header */}
              <div className="flex border-b border-gray-700">
                <button
                  onClick={() => setActiveTab('positions')}
                  className={`flex-1 px-2 py-2 text-xs font-medium transition-colors relative ${
                    activeTab === 'positions'
                      ? 'text-[#F0B90B]'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Pozisyonlar ({activeTrades.length})
                  {activeTab === 'positions' && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#F0B90B]"></div>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('orders')}
                  className={`flex-1 px-2 py-2 text-xs font-medium transition-colors relative ${
                    activeTab === 'orders'
                      ? 'text-[#F0B90B]'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Açık Emirler ({pendingOrders.length})
                  {activeTab === 'orders' && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#F0B90B]"></div>
                  )}
                </button>
              </div>
              {/* Tab Content */}
              <div className="p-2">
                {activeTab === 'positions' ? (
                  activeTrades.length > 0 ? (
                    <div className="space-y-2">
                      {/* Header Controls */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-1">
                          <input
                            type="checkbox"
                            id="hideOtherPairs"
                            className="w-3 h-3 text-[#F0B90B] bg-[#2B3139] border-gray-600 rounded"
                          />
                          <label htmlFor="hideOtherPairs" className="text-xs text-gray-400">
                            Diğer Çiftleri Gizle
                          </label>
                        </div>
                        <button
                          onClick={() => {
                            if (confirm('Tüm pozisyonları kapatmak istediğinizden emin misiniz?')) {
                              console.log('🔴 Tümünü Kapat butonu - Tüm pozisyonlar kapatılıyor:', activeTrades.length)
                              // Her pozisyon için closeTrade fonksiyonunu çağır
                              activeTrades.forEach(trade => {
                                console.log('🔄 Toplu kapatma - Trade kapatılıyor:', trade.id)
                                closeTrade(trade.id, 'manual')
                              })
                            }
                          }}
                          className="text-xs text-gray-400 hover:text-red-400 transition-colors"
                        >
                          Tümünü Kapat
                        </button>
                      </div>

                      {/* Pozisyon Listesi */}
                      <div className="space-y-1.5">
                        {activeTrades.map((trade) => (
                          <div
                            key={trade.id}
                            className={`bg-[#2B3139] rounded-lg p-2.5 cursor-pointer transition-all ${
                              selectedTradeId === trade.id ? 'ring-1 ring-[#F0B90B]' : 'hover:bg-[#3B4149]'
                            }`}
                            onClick={() => setSelectedTradeId(trade.id)}
                          >
                            {/* Pozisyon Header */}
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center space-x-2">
                                <div className={`w-5 h-5 rounded flex items-center justify-center text-xs font-bold ${
                                  trade.type === 'long' ? 'bg-[#0ECB81] text-white' : 'bg-[#F6465D] text-white'
                                }`}>
                                  {trade.type === 'long' ? (
                                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M5.293 7.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L10 4.414 6.707 7.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                                    </svg>
                                  ) : (
                                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M14.707 12.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L10 15.586l3.293-3.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                  )}
                                </div>
                                <div>
                                  <div className="font-semibold text-xs">
                                    {trade.symbol.replace('USDT', '')}USDT Perpetual
                                  </div>
                                  <div className="text-xs text-gray-400">
                                    Isolated {trade.leverage}x
                                  </div>
                                </div>
                              </div>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleShareTrade(trade.id)
                                }}
                                className="text-gray-400 hover:text-white"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                                </svg>
                              </button>
                            </div>

                            {/* PnL ve ROE */}
                            <div className="flex justify-between items-center mb-2">
                              <div>
                                <div className="text-xs text-gray-400">Gerçekleşmemiş PnL (USDT)</div>
                                <div className={`text-lg font-bold ${
                                  trade.pnl >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'
                                }`}>
                                  {formatPnL(trade.pnl)}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-xs text-gray-400">ROE</div>
                                <div className={`text-lg font-bold ${
                                  trade.roi >= 0 ? 'text-[#0ECB81]' : 'text-[#F6465D]'
                                }`}>
                                  {trade.roi >= 0 ? '+' : ''}{trade.roi.toFixed(2)}%
                                </div>
                              </div>
                            </div>

                            {/* Pozisyon Detayları */}
                            <div className="grid grid-cols-3 gap-3 mb-2">
                              <div>
                                <div className="text-xs text-gray-400">Boyut({trade.symbol.replace('USDT', '')})</div>
                                <div className="text-xs font-medium">
                                  {((trade.leverage * trade.investment) / trade.entryPrice).toFixed(4)}
                                </div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-400 flex items-center">
                                  Marj (USDT) 
                                  <svg className="w-3 h-3 ml-1" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd" />
                                  </svg>
                                </div>
                                <div className="text-xs font-medium">{trade.investment.toFixed(2)}</div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-400">Risk</div>
                                <div className="text-xs font-medium text-yellow-400">
                                  {((Math.abs(trade.currentPrice - trade.liquidationPrice) / trade.currentPrice) * 100).toFixed(2)}%
                                </div>
                              </div>
                            </div>

                            {/* Fiyat Bilgileri */}
                            <div className="grid grid-cols-3 gap-3 mb-2">
                              <div>
                                <div className="text-xs text-gray-400">Giriş Fiyatı</div>
                                <div className="text-xs font-mono">{formatPrice(trade.entryPrice)}</div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-400">Mark Fiyatı</div>
                                <div className="text-xs font-mono">{formatPrice(trade.currentPrice)}</div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-400">Liq. Fiyatı</div>
                                <div className="text-xs font-mono text-red-400">{formatPrice(trade.liquidationPrice)}</div>
                              </div>
                            </div>

                            {/* TP/SL Bilgileri - Tek Satır Kompakt */}
                            {(trade.takeProfit || trade.stopLoss) && (
                              <div style={{ 
                                display: 'grid', 
                                gridTemplateColumns: '1fr 1fr', 
                                gap: '4px', 
                                marginBottom: '8px' 
                              }}>
                                {trade.takeProfit && (
                                  <div style={{
                                    background: 'rgba(14, 203, 129, 0.15)',
                                    border: '1px solid rgba(14, 203, 129, 0.3)',
                                    borderRadius: '4px',
                                    padding: '6px 8px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                  }}>
                                    <span style={{ color: '#9ca3af', fontSize: '10px', fontWeight: '600' }}>
                                      TP:
                                    </span>
                                    <span style={{ 
                                      color: '#0ECB81', 
                                      fontWeight: 'bold', 
                                      fontSize: '10px',
                                      flex: 1
                                    }}>
                                      {formatPrice(trade.takeProfit)}
                                    </span>
                                    <span style={{ color: '#0ECB81', fontSize: '9px', fontWeight: '600' }}>
                                      +{(((trade.takeProfit - trade.entryPrice) / trade.entryPrice) * 100).toFixed(2)}%
                                    </span>
                                  </div>
                                )}
                                {trade.stopLoss && (
                                  <div style={{
                                    background: 'rgba(246, 70, 93, 0.15)',
                                    border: '1px solid rgba(246, 70, 93, 0.3)',
                                    borderRadius: '4px',
                                    padding: '6px 8px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                  }}>
                                    <span style={{ color: '#9ca3af', fontSize: '10px', fontWeight: '600' }}>
                                      SL:
                                    </span>
                                    <span style={{ 
                                      color: '#F6465D', 
                                      fontWeight: 'bold', 
                                      fontSize: '10px',
                                      flex: 1
                                    }}>
                                      {formatPrice(trade.stopLoss)}
                                    </span>
                                    <span style={{ color: '#F6465D', fontSize: '9px', fontWeight: '600' }}>
                                      {(((trade.stopLoss - trade.entryPrice) / trade.entryPrice) * 100).toFixed(2)}%
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Action Buttons */}
                            <div className="grid grid-cols-2 gap-1.5">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setTpSlType(trade.type)
                                  
                                  // Input'ları temizle (önceki coin'in değerleri kalmasın)
                                  setTakeProfitPrice('')
                                  setStopLossPrice('')
                                  setTakeProfitPercentage('')
                                  setStopLossPercentage('')
                                  
                                  // Mevcut TP/SL değerlerini yükle (eğer varsa)
                                  if (trade.takeProfit) {
                                    setTakeProfitPrice(formatPrice(trade.takeProfit))
                                  }
                                  if (trade.stopLoss) {
                                    setStopLossPrice(formatPrice(trade.stopLoss))
                                  }
                                  
                                  // O coin'in güncel fiyatını çek ve trade'i güncelle
                                  const updateTradePrice = async () => {
                                    try {
                                      const response = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${trade.symbol}`)
                                      const data = await response.json()
                                      const latestPrice = parseFloat(data.price)
                                      
                                      // Trade'in currentPrice'ını güncelle
                                      setActiveTrades(prev => prev.map(t => 
                                        t.id === trade.id 
                                          ? { ...t, currentPrice: latestPrice }
                                          : t
                                      ))
                                    } catch (error) {
                                      console.error('Güncel fiyat çekme hatası:', error)
                                    }
                                  }
                                  
                                  updateTradePrice()
                                  setShowTpSlModal(trade.id)
                                }}
                                className="bg-[#3B4149] hover:bg-[#4B5159] text-white py-1.5 px-2 rounded text-xs transition-colors"
                              >
                                Kar Al & Zarar Durdur
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  console.log('🔴 Manuel pozisyon kapatma:', trade.id)
                                  closeTrade(trade.id, 'manual')
                                }}
                                className="bg-[#F6465D] hover:bg-[#E53E3E] text-white py-1.5 px-2 rounded text-xs transition-colors"
                              >
                                Pozisyonu Kapat
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-6">
                      <div className="text-gray-400 mb-1 text-xs">Açık pozisyon yok</div>
                      <div className="text-xs text-gray-500">
                        Pozisyon açmak için sol paneli kullanın
                      </div>
                    </div>
                  )
                ) : (
                  pendingOrders.length > 0 ? (
                    <div className="space-y-2">
                      {/* Header Controls */}
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-gray-400">
                          Bekleyen Limit Emirleri
                        </div>
                        <button
                          onClick={() => {
                            if (confirm('Tüm bekleyen emirleri iptal etmek istediğinizden emin misiniz?')) {
                              setPendingOrders([])
                              localStorage.setItem('pendingOrders', JSON.stringify([]))
                            }
                          }}
                          className="text-xs text-gray-400 hover:text-red-400 transition-colors"
                        >
                          Tümünü İptal Et
                        </button>
                      </div>

                      {/* Emir Listesi */}
                      <div className="space-y-1.5">
                        {pendingOrders.map((order) => (
                          <div
                            key={order.id}
                            className="bg-[#2B3139] rounded-lg p-2.5 hover:bg-[#3B4149] transition-all"
                          >
                            {/* Emir Header */}
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center space-x-2">
                                <div className={`w-5 h-5 rounded flex items-center justify-center text-xs font-bold ${
                                  order.type === 'long' ? 'bg-[#0ECB81] text-white' : 'bg-[#F6465D] text-white'
                                }`}>
                                  {order.type === 'long' ? (
                                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M5.293 7.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L10 4.414 6.707 7.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                                    </svg>
                                  ) : (
                                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                      <path fillRule="evenodd" d="M14.707 12.293a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 111.414-1.414L10 15.586l3.293-3.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                  )}
                                </div>
                                <div>
                                  <div className="font-semibold text-xs">
                                    {order.symbol.replace('USDT', '')}USDT Perpetual
                                  </div>
                                  <div className="text-xs text-gray-400">
                                    {order.type === 'long' ? 'Buy/Long' : 'Sell/Short'} • Limit • {order.leverage}x
                                  </div>
                                </div>
                              </div>
                              <div className={`text-xs px-2 py-1 rounded ${
                                order.type === 'long' ? 'bg-[#0ECB81]/20 text-[#0ECB81]' : 'bg-[#F6465D]/20 text-[#F6465D]'
                              }`}>
                                Bekliyor
                              </div>
                            </div>

                            {/* Emir Detayları */}
                            <div className="grid grid-cols-3 gap-3 mb-2">
                              <div>
                                <div className="text-xs text-gray-400">Limit Fiyatı</div>
                                <div className="text-xs font-mono">{formatPrice(order.limitPrice)}</div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-400">Miktar (USDT)</div>
                                <div className="text-xs font-medium">{order.investment.toFixed(2)}</div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-400">Mevcut Fiyat</div>
                                <div className="text-xs font-mono">{formatPrice(currentPrice)}</div>
                              </div>
                            </div>

                            {/* Fiyat Farkı */}
                            <div className="mb-3">
                              <div className="text-xs text-gray-400">Fiyat Farkı</div>
                              <div className={`text-xs font-medium ${
                                order.type === 'long' 
                                  ? (order.limitPrice < currentPrice ? 'text-[#0ECB81]' : 'text-[#F6465D]')
                                  : (order.limitPrice > currentPrice ? 'text-[#0ECB81]' : 'text-[#F6465D]')
                              }`}>
                                {(((order.limitPrice - currentPrice) / currentPrice) * 100).toFixed(2)}%
                                {order.type === 'long' 
                                  ? (order.limitPrice < currentPrice ? ' (Tetiklenmeye hazır)' : ' (Fiyat düşmeli)')
                                  : (order.limitPrice > currentPrice ? ' (Tetiklenmeye hazır)' : ' (Fiyat yükselmeli)')
                                }
                              </div>
                            </div>

                            {/* Action Button */}
                            <button
                              onClick={() => cancelOrder(order.id)}
                              className="w-full bg-[#F6465D] hover:bg-[#E53E3E] text-white py-1.5 px-2 rounded text-xs transition-colors"
                            >
                              Emri İptal Et
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-6">
                      <div className="text-gray-400 mb-1 text-xs">Açık emir yok</div>
                      <div className="text-xs text-gray-500">
                        Limit emirleriniz burada görünecek
                      </div>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* TP/SL Modal */}
      {showTpSlModal && (() => {
        const selectedTrade = activeTrades.find(t => t.id === showTpSlModal)
        if (!selectedTrade) return null
        
        const entryPrice = selectedTrade.entryPrice
        // Modal açıldığında o coin'in güncel fiyatını kullan
        const currentPrice = selectedTrade.currentPrice // Bu WebSocket ile güncelleniyor
        const tradeType = selectedTrade.type
        const leverage = selectedTrade.leverage
        const investment = selectedTrade.investment
        
        // Yüzde parse etme - "%5", "5%", "5", "%5%" gibi formatları destekler
        const parsePercentInput = (input: string): number | null => {
          if (!input || input.trim() === '') return null
          // Önce % işaretlerini ve boşlukları kaldır
          let cleaned = input.replace(/[%\s]/g, '')
          // Türkçe format: "74.545,37" → önce binlik ayracı (.) kaldır, sonra virgülü noktaya çevir
          cleaned = cleaned.replace(/\./g, '').replace(',', '.')
          const num = parseFloat(cleaned)
          return isNaN(num) ? null : num
        }
        
        // Yüzde bazlı fiyat hesaplama - ANLIK FİYATTAN hesapla
        const calculatePriceFromPercent = (percent: number, isTP: boolean) => {
          if (tradeType === 'long') {
            return isTP ? currentPrice * (1 + percent / 100) : currentPrice * (1 - percent / 100)
          } else {
            return isTP ? currentPrice * (1 - percent / 100) : currentPrice * (1 + percent / 100)
          }
        }
        
        // Fiyattan yüzde hesaplama - GİRİŞ FİYATINA göre (PnL için)
        const calculatePercentFromPrice = (price: number) => {
          if (tradeType === 'long') {
            return ((price - entryPrice) / entryPrice) * 100
          } else {
            return ((entryPrice - price) / entryPrice) * 100
          }
        }
        
        // Fiyattan yüzde hesaplama - ANLIK FİYATTAN (ROE için)
        const calculatePercentFromCurrentPrice = (price: number) => {
          if (tradeType === 'long') {
            return ((price - currentPrice) / currentPrice) * 100
          } else {
            return ((currentPrice - price) / currentPrice) * 100
          }
        }
        
        // ROE hesaplama (leverage ile çarpılmış)
        const calculateROE = (priceChangePercent: number) => {
          return priceChangePercent * leverage
        }
        
        // USDT cinsinden PnL hesaplama
        const calculatePnL = (priceChangePercent: number) => {
          const roe = calculateROE(priceChangePercent)
          return (investment * roe) / 100
        }
        
        // TP değerlerini hesapla
        const getTpValues = () => {
          if (!takeProfitPrice || takeProfitPrice.trim() === '') {
            return { price: null, percent: 0, roe: 0, pnl: 0 }
          }
          
          // Yüzde mi yoksa fiyat mı kontrol et - SADECE % işaretine bak
          if (takeProfitPrice.includes('%')) {
            // Yüzde girişi
            const percentValue = parsePercentInput(takeProfitPrice)
            if (percentValue === null) return { price: null, percent: 0, roe: 0, pnl: 0 }
            const price = calculatePriceFromPercent(percentValue, true)
            // TP için GÜNCEL FİYATTAN hesapla (modal için)
            const priceChangePercent = calculatePercentFromCurrentPrice(price)
            const roe = calculateROE(priceChangePercent)
            const pnl = calculatePnL(priceChangePercent)
            return { price, percent: priceChangePercent, roe, pnl }
          } else {
            // Fiyat girişi - formatlanmış string'i parse et
            const price = parseFormattedPrice(takeProfitPrice)
            if (price === 0) return { price: null, percent: 0, roe: 0, pnl: 0 }
            // TP için GÜNCEL FİYATTAN hesapla (modal için)
            const priceChangePercent = calculatePercentFromCurrentPrice(price)
            const roe = calculateROE(priceChangePercent)
            const pnl = calculatePnL(priceChangePercent)
            return { price, percent: priceChangePercent, roe, pnl }
          }
        }
        
        // SL değerlerini hesapla
        const getSlValues = () => {
          if (!stopLossPrice || stopLossPrice.trim() === '') {
            return { price: null, percent: 0, roe: 0, pnl: 0 }
          }
          
          // Yüzde mi yoksa fiyat mı kontrol et - SADECE % işaretine bak
          if (stopLossPrice.includes('%')) {
            // Yüzde girişi
            const percentValue = parsePercentInput(stopLossPrice)
            if (percentValue === null) return { price: null, percent: 0, roe: 0, pnl: 0 }
            const price = calculatePriceFromPercent(percentValue, false)
            // SL için GÜNCEL FİYATTAN hesapla (modal için)
            const priceChangePercent = calculatePercentFromCurrentPrice(price)
            const roe = calculateROE(priceChangePercent)
            const pnl = calculatePnL(priceChangePercent)
            return { price, percent: priceChangePercent, roe, pnl }
          } else {
            // Fiyat girişi - formatlanmış string'i parse et
            const price = parseFormattedPrice(stopLossPrice)
            if (price === 0) return { price: null, percent: 0, roe: 0, pnl: 0 }
            // SL için GÜNCEL FİYATTAN hesapla (modal için)
            const priceChangePercent = calculatePercentFromCurrentPrice(price)
            const roe = calculateROE(priceChangePercent)
            const pnl = calculatePnL(priceChangePercent)
            return { price, percent: priceChangePercent, roe, pnl }
          }
        }
        
        const tpValues = getTpValues()
        const slValues = getSlValues()
        
        return (
          <div key={`${showTpSlModal}-${selectedTrade.currentPrice}`} className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-[#1E2329] rounded-lg w-full max-w-md">
              {/* Modal Header */}
              <div className="flex items-center justify-between p-3 sm:p-4 border-b border-gray-700">
                <div className="flex-1 min-w-0">
                  <h3 className="text-base sm:text-lg font-semibold text-white">Kar Al/Zarar Durdur</h3>
                  <p className="text-xs text-gray-400 mt-1">
                    {selectedTrade.symbol} • {tradeType === 'long' ? 'Long' : 'Short'} • Giriş: {formatPrice(entryPrice)} USDT
                  </p>
                  <p className="text-xs text-white mt-0.5">
                    Anlık: {formatPrice(selectedTrade.currentPrice)} USDT
                  </p>
                </div>
                <button
                  onClick={() => setShowTpSlModal(null)}
                  className="text-gray-400 hover:text-white ml-2 flex-shrink-0"
                >
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-3 sm:p-4 space-y-3 sm:space-y-4">
                {/* Take Profit Section */}
                <div className="space-y-2 sm:space-y-3">
                  <div className="flex items-center space-x-2">
                    <div className="w-4 h-4 sm:w-5 sm:h-5 bg-[#0ECB81] rounded flex items-center justify-center flex-shrink-0">
                      <svg className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <span className="text-white font-medium text-sm sm:text-base">Kar Al (Take Profit)</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Tetikleme Fiyatı</label>
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={() => {
                            const current = parseFormattedPrice(takeProfitPrice) || selectedTrade.currentPrice
                            const step = selectedTrade.currentPrice * 0.002 // %0.2 adım
                            const newPrice = Math.max(0, current - step)
                            setTakeProfitPrice(formatPrice(newPrice))
                          }}
                          className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center bg-[#3B4149] hover:bg-[#4B5159] rounded text-gray-300 hover:text-white transition-colors flex-shrink-0"
                        >
                          <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                          </svg>
                        </button>
                        <input
                          type="text"
                          value={takeProfitPrice || formatPrice(selectedTrade.currentPrice)}
                          onChange={(e) => setTakeProfitPrice(e.target.value)}
                          onFocus={() => {
                            if (!takeProfitPrice) {
                              setTakeProfitPrice(formatPrice(selectedTrade.currentPrice))
                            }
                          }}
                          className="flex-1 bg-[#2B3139] border border-gray-600 rounded px-2 sm:px-3 py-1.5 sm:py-2 text-white focus:border-[#0ECB81] focus:outline-none text-sm text-center"
                          placeholder={formatPrice(selectedTrade.currentPrice)}
                        />
                        <button 
                          onClick={() => {
                            const current = parseFormattedPrice(takeProfitPrice) || selectedTrade.currentPrice
                            const step = selectedTrade.currentPrice * 0.002 // %0.2 adım
                            const newPrice = current + step
                            setTakeProfitPrice(formatPrice(newPrice))
                          }}
                          className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center bg-[#3B4149] hover:bg-[#4B5159] rounded text-gray-300 hover:text-white transition-colors flex-shrink-0"
                        >
                          <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Kazanç</label>
                      <div className="bg-[#2B3139] border border-gray-600 rounded px-2 sm:px-3 py-1.5 sm:py-2 space-y-0.5">
                        <div className={`text-xs sm:text-sm font-medium ${
                          tpValues.percent > 0 ? 'text-[#0ECB81]' : 'text-gray-400'
                        }`}>
                          {tpValues.percent > 0 ? `+${tpValues.percent.toFixed(2)}%` : '0.00%'}
                        </div>
                        {tpValues.roe > 0 && (
                          <>
                            <div className="text-[10px] sm:text-xs text-[#0ECB81]">
                              ROE: +{tpValues.roe.toFixed(2)}%
                            </div>
                            <div className="text-[10px] sm:text-xs text-[#0ECB81] font-medium">
                              +{tpValues.pnl.toFixed(2)} USDT
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stop Loss Section */}
                <div className="space-y-2 sm:space-y-3">
                  <div className="flex items-center space-x-2">
                    <div className="w-4 h-4 sm:w-5 sm:h-5 bg-[#F6465D] rounded flex items-center justify-center flex-shrink-0">
                      <svg className="w-2.5 h-2.5 sm:w-3 sm:h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <span className="text-white font-medium text-sm sm:text-base">Zarar Durdur (Stop Loss)</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Tetikleme Fiyatı</label>
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={() => {
                            const current = parseFormattedPrice(stopLossPrice) || selectedTrade.currentPrice
                            const step = selectedTrade.currentPrice * 0.002 // %0.2 adım
                            const newPrice = Math.max(0, current - step)
                            setStopLossPrice(formatPrice(newPrice))
                          }}
                          className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center bg-[#3B4149] hover:bg-[#4B5159] rounded text-gray-300 hover:text-white transition-colors flex-shrink-0"
                        >
                          <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                          </svg>
                        </button>
                        <input
                          type="text"
                          value={stopLossPrice || formatPrice(selectedTrade.currentPrice)}
                          onChange={(e) => setStopLossPrice(e.target.value)}
                          onFocus={() => {
                            if (!stopLossPrice) {
                              setStopLossPrice(formatPrice(selectedTrade.currentPrice))
                            }
                          }}
                          className="flex-1 bg-[#2B3139] border border-gray-600 rounded px-2 sm:px-3 py-1.5 sm:py-2 text-white focus:border-[#F6465D] focus:outline-none text-sm text-center"
                          placeholder={formatPrice(selectedTrade.currentPrice)}
                        />
                        <button 
                          onClick={() => {
                            const current = parseFormattedPrice(stopLossPrice) || selectedTrade.currentPrice
                            const step = selectedTrade.currentPrice * 0.002 // %0.2 adım
                            const newPrice = current + step
                            setStopLossPrice(formatPrice(newPrice))
                          }}
                          className="w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center bg-[#3B4149] hover:bg-[#4B5159] rounded text-gray-300 hover:text-white transition-colors flex-shrink-0"
                        >
                          <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Zarar</label>
                      <div className="bg-[#2B3139] border border-gray-600 rounded px-2 sm:px-3 py-1.5 sm:py-2 space-y-0.5">
                        <div className={`text-xs sm:text-sm font-medium ${
                          slValues.percent < 0 ? 'text-[#F6465D]' : 'text-gray-400'
                        }`}>
                          {slValues.percent < 0 ? `${slValues.percent.toFixed(2)}%` : '0.00%'}
                        </div>
                        {slValues.roe < 0 && (
                          <>
                            <div className="text-[10px] sm:text-xs text-[#F6465D]">
                              ROE: {slValues.roe.toFixed(2)}%
                            </div>
                            <div className="text-[10px] sm:text-xs text-[#F6465D] font-medium">
                              {slValues.pnl.toFixed(2)} USDT
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex space-x-2 sm:space-x-3 pt-2 sm:pt-4">
                  <button
                    onClick={() => {
                      setShowTpSlModal(null)
                      setTakeProfitPrice('')
                      setStopLossPrice('')
                    }}
                    className="flex-1 py-2 sm:py-3 bg-[#2B3139] hover:bg-[#3B4149] text-white rounded-lg font-medium transition-colors text-sm"
                  >
                    İptal
                  </button>
                  <button
                    onClick={() => {
                      // TP/SL kaydetme işlemi
                      let finalTP: number | undefined = undefined
                      let finalSL: number | undefined = undefined
                      
                      // TP hesapla
                      if (tpValues.price && tpValues.price > 0) {
                        finalTP = tpValues.price
                      }
                      
                      // SL hesapla
                      if (slValues.price && slValues.price > 0) {
                        finalSL = slValues.price
                      }
                      
                      // Trade'i güncelle - Force re-render için yeni array oluştur
                      setActiveTrades(prev => {
                        const updatedTrades = prev.map(trade => {
                          if (trade.id === showTpSlModal) {
                            // Tamamen yeni obje oluştur
                            return {
                              id: trade.id,
                              symbol: trade.symbol,
                              type: trade.type,
                              entryPrice: trade.entryPrice,
                              leverage: trade.leverage,
                              investment: trade.investment,
                              currentPrice: trade.currentPrice,
                              pnl: trade.pnl,
                              roi: trade.roi,
                              liquidationPrice: trade.liquidationPrice,
                              isActive: trade.isActive,
                              startTime: trade.startTime,
                              takeProfit: finalTP,
                              stopLoss: finalSL
                            }
                          }
                          return trade
                        })
                        // localStorage'a kaydet
                        localStorage.setItem('activeTrades', JSON.stringify(updatedTrades))
                        // Yeni array döndür (referans değişsin)
                        return [...updatedTrades]
                      })
                      
                      setShowTpSlModal(null)
                      setTakeProfitPrice('')
                      setStopLossPrice('')
                    }}
                    className="flex-1 py-2 sm:py-3 bg-[#F0B90B] hover:bg-[#D4A017] text-black rounded-lg font-medium transition-colors text-sm"
                  >
                    Onayla
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* İstatistikler Butonu - Sayfanın En Altı */}
      <div className="mt-4 pb-4">
        <button
          onClick={() => setShowStatsModal(true)}
          className="w-full py-3 bg-gradient-to-r from-[#F0B90B] to-[#D4A017] hover:from-[#D4A017] hover:to-[#B8901A] text-black rounded-lg font-semibold transition-all duration-200 flex items-center justify-center gap-2 shadow-lg"
        >
          <svg 
            className="w-5 h-5" 
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24"
          >
            <path 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={2} 
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" 
            />
          </svg>
          İstatistikler
        </button>
      </div>

      {/* İstatistikler Modalı - Kompakt Mobil */}
      {showStatsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-2">
          <div className="bg-[#1E2329] rounded-lg max-w-4xl w-full max-h-[95vh] overflow-y-auto">
            <div className="p-3">
              {/* Modal Header - Kompakt */}
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-lg font-bold text-white">📊 İstatistikler</h2>
                <div className="flex items-center gap-2">
                  {tradeHistory.length > 0 && (
                    <button
                      onClick={() => {
                        if (confirm('Tüm işlem geçmişi silinecek. Emin misiniz?')) {
                          setTradeHistory([])
                          localStorage.removeItem('tradeHistory')
                        }
                      }}
                      className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-medium transition-colors flex items-center gap-1"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      Sıfırla
                    </button>
                  )}
                  <button
                    onClick={() => setShowStatsModal(false)}
                    className="text-gray-400 hover:text-white text-xl"
                  >
                    ×
                  </button>
                </div>
              </div>

              {(() => {
                const stats = calculateStats()
                
                if (stats.totalTrades === 0) {
                  return (
                    <div className="text-center py-8">
                      <div className="text-4xl mb-2">📈</div>
                      <h3 className="text-lg text-gray-400 mb-1">Henüz işlem yok</h3>
                      <p className="text-sm text-gray-500">İlk işleminizi tamamladıktan sonra istatistikler görünecek.</p>
                    </div>
                  )
                }

                return (
                  <div className="space-y-3">
                    {/* Genel İstatistikler - Kompakt Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div className="bg-[#2B3139] rounded p-2 text-center">
                        <div className="text-lg font-bold text-white">{stats.totalTrades}</div>
                        <div className="text-xs text-gray-400">Toplam</div>
                      </div>
                      <div className="bg-[#2B3139] rounded p-2 text-center">
                        <div className="text-lg font-bold text-green-400">{stats.winningTrades}</div>
                        <div className="text-xs text-gray-400">Karlı</div>
                      </div>
                      <div className="bg-[#2B3139] rounded p-2 text-center">
                        <div className="text-lg font-bold text-red-400">{stats.losingTrades}</div>
                        <div className="text-xs text-gray-400">Zararlı</div>
                      </div>
                      <div className="bg-[#2B3139] rounded p-2 text-center">
                        <div className="text-lg font-bold text-yellow-400">{stats.winRate.toFixed(1)}%</div>
                        <div className="text-xs text-gray-400">Başarı</div>
                      </div>
                    </div>

                    {/* Kar/Zarar - Tek Kart */}
                    <div className="bg-[#2B3139] rounded p-3">
                      <h3 className="text-sm font-semibold text-white mb-2">💰 Performans</h3>
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="flex justify-between">
                          <span className="text-gray-400">Toplam PnL:</span>
                          <span className={`font-bold ${stats.totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {formatPnL(stats.totalPnL)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Ort. PnL:</span>
                          <span className={`font-bold ${stats.avgPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {formatPnL(stats.avgPnL)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Toplam ROI:</span>
                          <span className={`font-bold ${stats.totalROI >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {stats.totalROI >= 0 ? '+' : ''}{stats.totalROI.toFixed(1)}%
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">Ort. ROI:</span>
                          <span className={`font-bold ${stats.avgROI >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {stats.avgROI >= 0 ? '+' : ''}{stats.avgROI.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* En İyi/En Kötü - Yan Yana Kompakt */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {stats.bestTrade && (
                        <div className="bg-[#2B3139] rounded p-2">
                          <h3 className="text-xs font-semibold text-green-400 mb-1">🏆 En Karlı</h3>
                          <div className="space-y-1 text-xs">
                            <div className="flex justify-between">
                              <span className="text-gray-400">{stats.bestTrade.symbol}</span>
                              <span className={stats.bestTrade.type === 'long' ? 'text-green-400' : 'text-red-400'}>
                                {stats.bestTrade.type.toUpperCase()}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-green-400 font-bold">+{stats.bestTrade.pnl.toFixed(1)}</span>
                              <span className="text-green-400 font-bold">+{stats.bestTrade.roi.toFixed(1)}%</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {stats.worstTrade && (
                        <div className="bg-[#2B3139] rounded p-2">
                          <h3 className="text-xs font-semibold text-red-400 mb-1">📉 En Zararlı</h3>
                          <div className="space-y-1 text-xs">
                            <div className="flex justify-between">
                              <span className="text-gray-400">{stats.worstTrade.symbol}</span>
                              <span className={stats.worstTrade.type === 'long' ? 'text-green-400' : 'text-red-400'}>
                                {stats.worstTrade.type.toUpperCase()}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-red-400 font-bold">{stats.worstTrade.pnl.toFixed(1)}</span>
                              <span className="text-red-400 font-bold">{stats.worstTrade.roi.toFixed(1)}%</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Son İşlemler - Kompakt Tablo */}
                    <div className="bg-[#2B3139] rounded p-2">
                      <h3 className="text-sm font-semibold text-white mb-2">📋 Son İşlemler</h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-400 border-b border-gray-600">
                              <th className="text-left py-1">Sembol</th>
                              <th className="text-left py-1">Tip</th>
                              <th className="text-right py-1">PnL</th>
                              <th className="text-right py-1">ROI</th>
                              <th className="text-right py-1">Süre</th>
                            </tr>
                          </thead>
                          <tbody>
                            {tradeHistory.slice(-8).reverse().map((trade, index) => (
                              <tr key={`${trade.id}-${index}`} className="border-b border-gray-700">
                                <td className="py-1 text-white">{trade.symbol}</td>
                                <td className="py-1">
                                  <span className={trade.type === 'long' ? 'text-green-400' : 'text-red-400'}>
                                    {trade.type === 'long' ? 'L' : 'S'}
                                  </span>
                                </td>
                                <td className={`py-1 text-right font-bold ${trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {formatPnL(trade.pnl)}
                                </td>
                                <td className={`py-1 text-right font-bold ${trade.roi >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                  {trade.roi >= 0 ? '+' : ''}{trade.roi.toFixed(1)}%
                                </td>
                                <td className="py-1 text-right text-gray-400">
                                  {formatDuration(trade.duration)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}