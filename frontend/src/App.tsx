import { useState, useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import axios from 'axios'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

// Fix Leaflet icons
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
})

// Custom airport icon (màu xanh lá)
const airportIcon = L.icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
  iconRetinaUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
})

const API = axios.create({ 
  baseURL: 'http://localhost:8000',
  timeout: 120000 // 2 minutes for analysis operations
})

// Các khu vực phân tích chính + Global (bbox chỉ dùng cho filter ở backend)
const REGIONS = {
  'global': {
    name: 'Toàn thế giới',
    bbox: null as any,
    center: [20, 0] as [number, number],
    zoom: 2
  },
  'southeast-asia': {
    name: 'Đông Nam Á',
    bbox: { minLat: -10, maxLat: 30, minLon: 90, maxLon: 150 },
    center: [10, 120] as [number, number],
    zoom: 5
  },
  'europe': {
    name: 'Châu Âu',
    bbox: { minLat: 35, maxLat: 72, minLon: -15, maxLon: 40 },
    center: [52, 10] as [number, number],
    zoom: 4
  },
  'asia': {
    name: 'Châu Á',
    bbox: { minLat: -10, maxLat: 55, minLon: 60, maxLon: 150 },
    center: [30, 100] as [number, number],
    zoom: 3
  },
  'north-america': {
    name: 'Bắc Mỹ',
    bbox: { minLat: 15, maxLat: 72, minLon: -170, maxLon: -50 },
    center: [40, -100] as [number, number],
    zoom: 3
  }
}

function App() {
  console.log('=== App component rendering ===')
  
  const [airports, setAirports] = useState<any[]>([])
  const [routes, setRoutes] = useState<any[]>([])
  const [showAirports, setShowAirports] = useState(true)
  const [showRoutes, setShowRoutes] = useState(true)
  const [loading, setLoading] = useState(true)
  const [zoom, setZoom] = useState(2)
  const [airportRatio, setAirportRatio] = useState(100) // 0-100%
  const [routeRatio, setRouteRatio] = useState(100) // 0-100%
  const [selectedRegion, setSelectedRegion] = useState<keyof typeof REGIONS>('southeast-asia')
  const [removedItems, setRemovedItems] = useState<any[]>([])
  const [showRemovedPanel, setShowRemovedPanel] = useState(false)
  const [showAttackPanel, setShowAttackPanel] = useState(false)
  const [showCurvesPanel, setShowCurvesPanel] = useState(false)
  const [showRecommendationsPanel, setShowRecommendationsPanel] = useState(false)
  const [robustnessCurves, setRobustnessCurves] = useState<any>(null)
  const [topHubs, setTopHubs] = useState<any>(null)
  const [redundancySuggestions, setRedundancySuggestions] = useState<any[]>([])
  const [loadingAnalysis, setLoadingAnalysis] = useState(false)
  const [mapKey, setMapKey] = useState(0) // Force re-render map

  // Danh sách sân bay cho dropdown (lọc theo khu vực)
  const [airportOptions, setAirportOptions] = useState<any[]>([])
  const [countryFrom, setCountryFrom] = useState<string>('')
  const [countryTo, setCountryTo] = useState<string>('')

  // Route case-study (A -> B)
  const [caseSrc, setCaseSrc] = useState<string>('FRA')
  const [caseDst, setCaseDst] = useState<string>('SGN')
  const [caseWithDefense, setCaseWithDefense] = useState<boolean>(true)
  const [caseResult, setCaseResult] = useState<any | null>(null)
  const [caseDefenseMethod, setCaseDefenseMethod] = useState<string>('TER')
  const [attackSimResult, setAttackSimResult] = useState<any | null>(null)
  const [showAttackSimModal, setShowAttackSimModal] = useState<boolean>(false)

  // Overview / report panel
  const [showOverview, setShowOverview] = useState<boolean>(false)
  
  // Chart zoom modal
  const [zoomedChart, setZoomedChart] = useState<{ title: string; data: any; config: any } | null>(null)
  
  // Attack strategy parameters
  const [attackStrategy, setAttackStrategy] = useState<string>('degree_targeted_attack')
  const [maxFraction, setMaxFraction] = useState<number>(0.5)
  const [nRuns, setNRuns] = useState<number>(5)
  
  // Defense strategy parameters
  const [kHubs, setKHubs] = useState<number>(10)
  const [maxDistance, setMaxDistance] = useState<number>(2000)
  const [defenseAttackStrategy, setDefenseAttackStrategy] = useState<string>('degree_targeted_attack')
  
  // Schneider Defense parameters
  const [schneiderMaxTrials, setSchneiderMaxTrials] = useState<number>(20000)
  const [schneiderPatience, setSchneiderPatience] = useState<number>(5000)
  const [schneiderAttackStrategy, setSchneiderAttackStrategy] = useState<string>('degree_targeted_attack')
  const [schneiderDefenseResult, setSchneiderDefenseResult] = useState<any>(null)
  
  // Top-k impact
  const [topKImpact, setTopKImpact] = useState<any>(null)
  const [topK, setTopK] = useState<number>(10)
  const [topKStrategy, setTopKStrategy] = useState<string>('degree')

  useEffect(() => {
    console.log('=== useEffect: loading initial data ===')
    loadData()
    loadRemovedItems()
    loadAirportOptions()
  }, [selectedRegion])

  useEffect(() => {
    // Refresh removed items periodically
    const interval = setInterval(() => {
      loadRemovedItems()
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  // Force reload data when removed items change - removed to avoid infinite loop
  // Data will be reloaded in handleRemoveNode/Edge directly

  async function loadData() {
    try {
      setLoading(true)
      console.log('Loading data for region:', selectedRegion)
      
      const region = REGIONS[selectedRegion]
      const params = region.bbox ? {
        minLat: region.bbox.minLat,
        maxLat: region.bbox.maxLat,
        minLon: region.bbox.minLon,
        maxLon: region.bbox.maxLon
      } : {}
      
      // Add timestamp to force fresh data
      const timestamp = Date.now()
      const [airportsRes, routesRes] = await Promise.all([
        API.get('/geojson/airports', { params: { ...params, _t: timestamp } }),
        API.get('/geojson/routes', { params: { ...params, _t: timestamp } })
      ])
      
      const newAirports = airportsRes.data.features || []
      const newRoutes = routesRes.data.features || []
      
      console.log('Airports loaded:', newAirports.length)
      console.log('Routes loaded:', newRoutes.length)
      
      // Clear and set new data to force re-render
      setAirports([])
      setRoutes([])
      
      // Use setTimeout to ensure state update
      setTimeout(() => {
        setAirports(newAirports)
        setRoutes(newRoutes)
        setLoading(false)
        console.log('Data set, map should update')
      }, 50)
    } catch (error: any) {
      console.error('Error loading data:', error)
      alert('Error: ' + (error.message || 'Failed to load data'))
      setLoading(false)
    }
  }

  async function loadAirportOptions() {
    try {
      const region = REGIONS[selectedRegion]
      const params: any = {}
      if (region.bbox) {
        params.minLat = region.bbox.minLat
        params.maxLat = region.bbox.maxLat
        params.minLon = region.bbox.minLon
        params.maxLon = region.bbox.maxLon
      }
      const res = await API.get('/airports/list', { params })
      const list = res.data.airports || []
      setAirportOptions(list)

      // Nếu chưa chọn country, set mặc định theo FRA/SGN nếu có
      if (!countryFrom) {
        const fra = list.find((a: any) => a.iata === 'FRA')
        if (fra) setCountryFrom(fra.country)
      }
      if (!countryTo) {
        const sgn = list.find((a: any) => a.iata === 'SGN')
        if (sgn) setCountryTo(sgn.country)
      }
    } catch (error: any) {
      console.error('Error loading airport options:', error)
    }
  }

  async function loadRemovedItems() {
    try {
      const res = await API.get('/attack/removed')
      const items = [
        ...(res.data.nodes || []).map((n: any) => ({ ...n, key: `node-${n.id}` })),
        ...(res.data.edges || []).map((e: any) => ({ ...e, key: `edge-${e.source}-${e.target}` }))
      ]
      setRemovedItems(items)
    } catch (error: any) {
      console.error('Error loading removed items:', error)
    }
  }

  async function handleRemoveNode(nodeId: number) {
    console.log('=== handleRemoveNode CALLED ===', nodeId)
    try {
      console.log('Removing node:', nodeId)
      const res = await API.post(`/attack/remove/node/${nodeId}`)
      console.log('Remove response:', res.data)
      
      // Wait a bit for backend to process
      await new Promise(resolve => setTimeout(resolve, 200))
      
      // Reload data immediately to update map in real-time
      console.log('Reloading data after remove...')
      await loadData()
      await loadRemovedItems()
      
      // Force map re-render
      setMapKey(prev => {
        const newKey = prev + 1
        console.log('Map key updated to:', newKey)
        return newKey
      })
      console.log('Data reloaded, map should update')
    } catch (error: any) {
      console.error('Error removing node:', error)
      alert('Error: ' + (error.response?.data?.detail || error.message))
    }
  }

  async function handleRemoveEdge(src: number, dst: number) {
    try {
      console.log('Removing edge:', src, '->', dst)
      const res = await API.post('/attack/remove/edge', null, { params: { src, dst } })
      console.log('Remove response:', res.data)
      
      // Wait a bit for backend to process
      await new Promise(resolve => setTimeout(resolve, 100))
      
      // Reload data immediately to update map in real-time
      console.log('Reloading data after remove...')
      await loadData()
      await loadRemovedItems()
      
      // Force map re-render
      setMapKey(prev => prev + 1)
      console.log('Data reloaded, map should update')
    } catch (error: any) {
      console.error('Error removing edge:', error)
      alert('Error: ' + (error.response?.data?.detail || error.message))
    }
  }

  async function handleRestore(item: any) {
    try {
      if (item.type === 'node') {
        await API.post(`/attack/restore/node/${item.id}`)
      } else if (item.type === 'edge') {
        await API.post('/attack/restore/edge', null, { params: { src: item.source, dst: item.target } })
      }
      // Reload data immediately to update map in real-time
      await Promise.all([loadData(), loadRemovedItems()])
      setMapKey(prev => prev + 1) // Force map re-render
    } catch (error: any) {
      console.error('Error restoring item:', error)
      alert('Error: ' + (error.response?.data?.detail || error.message))
    }
  }

  async function handleReset() {
    if (!confirm('Bạn có chắc muốn phục hồi tất cả?')) return
    try {
      await API.post('/attack/reset')
      await loadData()
      await loadRemovedItems()
    } catch (error: any) {
      console.error('Error resetting:', error)
      alert('Error: ' + (error.response?.data?.detail || error.message))
    }
  }

  async function runAttackAnalysis() {
    setLoadingAnalysis(true)
    try {
      const region = REGIONS[selectedRegion]
      const params: any = { 
        n_runs: 5 // Average over 5 runs for random attack
      }
      if (region.bbox) {
        params.minLat = region.bbox.minLat
        params.maxLat = region.bbox.maxLat
        params.minLon = region.bbox.minLon
        params.maxLon = region.bbox.maxLon
      }
      const res = await API.get('/attack/impact', { params })
      setRobustnessCurves(res.data)
      setShowCurvesPanel(true)
    } catch (error: any) {
      console.error('Error running attack analysis:', error)
      if (error.code === 'ECONNABORTED') {
        alert('Timeout: Phân tích mất quá nhiều thời gian.')
      } else {
        alert('Error: ' + (error.response?.data?.detail || error.message))
      }
    } finally {
      setLoadingAnalysis(false)
    }
  }

  async function runCustomAttackAnalysis() {
    setLoadingAnalysis(true)
    try {
      const region = REGIONS[selectedRegion]
      const params: any = { 
        strategy: attackStrategy,
        max_fraction: maxFraction,
        n_runs: nRuns
      }
      if (region.bbox) {
        params.minLat = region.bbox.minLat
        params.maxLat = region.bbox.maxLat
        params.minLon = region.bbox.minLon
        params.maxLon = region.bbox.maxLon
      }
      const res = await API.get('/attack/impact-custom', { params })
      setRobustnessCurves({
        baseline: res.data.baseline,
        [attackStrategy]: res.data.result
      })
      setShowCurvesPanel(true)
    } catch (error: any) {
      console.error('Error running custom attack analysis:', error)
      alert('Error: ' + (error.response?.data?.detail || error.message))
    } finally {
      setLoadingAnalysis(false)
    }
  }

  async function runTopKImpactAnalysis() {
    setLoadingAnalysis(true)
    try {
      const region = REGIONS[selectedRegion]
      const params: any = { 
        k: topK,
        strategy: topKStrategy
      }
      if (region.bbox) {
        params.minLat = region.bbox.minLat
        params.maxLat = region.bbox.maxLat
        params.minLon = region.bbox.minLon
        params.maxLon = region.bbox.maxLon
      }
      const res = await API.get('/attack/top-k-impact', { params })
      setTopKImpact(res.data)
      setShowCurvesPanel(true)
    } catch (error: any) {
      console.error('Error running top-k impact analysis:', error)
      alert('Error: ' + (error.response?.data?.detail || error.message))
    } finally {
      setLoadingAnalysis(false)
    }
  }

  async function runDefenseAnalysis() {
    setLoadingAnalysis(true)
    try {
      const region = REGIONS[selectedRegion]
      const params: any = { 
        k_hubs: 10,
        n_runs: 5
      }
      if (region.bbox) {
        params.minLat = region.bbox.minLat
        params.maxLat = region.bbox.maxLat
        params.minLon = region.bbox.minLon
        params.maxLon = region.bbox.maxLon
      }
      const res = await API.get('/defense/impact', { params })
      setRobustnessCurves(res.data)
      setShowCurvesPanel(true)
    } catch (error: any) {
      console.error('Error running defense analysis:', error)
      alert('Error: ' + (error.response?.data?.detail || error.message))
    } finally {
      setLoadingAnalysis(false)
    }
  }

  async function runCustomDefenseAnalysis() {
    setLoadingAnalysis(true)
    try {
      const region = REGIONS[selectedRegion]
      const params: any = { 
        k_hubs: kHubs,
        max_distance_km: maxDistance,
        attack_strategy: defenseAttackStrategy
      }
      if (region.bbox) {
        params.minLat = region.bbox.minLat
        params.maxLat = region.bbox.maxLat
        params.minLon = region.bbox.minLon
        params.maxLon = region.bbox.maxLon
      }
      const res = await API.get('/defense/impact-custom', { params })
      setRobustnessCurves(res.data)
      setShowCurvesPanel(true)
    } catch (error: any) {
      console.error('Error running custom defense analysis:', error)
      alert('Error: ' + (error.response?.data?.detail || error.message))
    } finally {
      setLoadingAnalysis(false)
    }
  }

  async function runSchneiderDefenseAnalysis() {
    setLoadingAnalysis(true)
    try {
      const region = REGIONS[selectedRegion]
      const params: any = { 
        max_trials: schneiderMaxTrials,
        patience: schneiderPatience,
        attack_strategy: schneiderAttackStrategy
      }
      if (region.bbox) {
        params.minLat = region.bbox.minLat
        params.maxLat = region.bbox.maxLat
        params.minLon = region.bbox.minLon
        params.maxLon = region.bbox.maxLon
      }
      const res = await API.get('/defense/impact-schneider', { params })
      console.log('Schneider Defense Response:', res.data)
      setSchneiderDefenseResult(res.data)
      setShowCurvesPanel(true)
      console.log('Schneider Defense Result set, showCurvesPanel:', true)
    } catch (error: any) {
      console.error('Error running Schneider defense analysis:', error)
      alert('Error: ' + (error.response?.data?.detail || error.message))
    } finally {
      setLoadingAnalysis(false)
    }
  }

  async function runRouteCaseStudy() {
    setLoadingAnalysis(true)
    try {
      const params: any = {
        src_iata: caseSrc,
        dst_iata: caseDst,
        with_defense: caseWithDefense
      }
      const res = await API.get('/case/route-metrics', { params })
      setCaseResult(res.data)
    } catch (error: any) {
      console.error('Error running route case study:', error)
      alert('Error: ' + (error.response?.data?.detail || error.message))
    } finally {
      setLoadingAnalysis(false)
    }
  }

  async function runAttackSimulation() {
    setLoadingAnalysis(true)
    try {
      const params: any = {
        src_iata: caseSrc,
        dst_iata: caseDst,
        with_defense: caseWithDefense,
        defense_method: caseDefenseMethod
      }
      const res = await API.get('/case/route-attack-simulation', { params })
      console.log('Attack Simulation Response:', res.data)
      setAttackSimResult(res.data)
    } catch (error: any) {
      console.error('Error running attack simulation:', error)
      alert('Error: ' + (error.response?.data?.detail || error.message))
    } finally {
      setLoadingAnalysis(false)
    }
  }

  async function loadTopHubs(k: number = 10) {
    try {
      const region = REGIONS[selectedRegion]
      const params: any = { k }
      if (region.bbox) {
        params.minLat = region.bbox.minLat
        params.maxLat = region.bbox.maxLat
        params.minLon = region.bbox.minLon
        params.maxLon = region.bbox.maxLon
      }
      const res = await API.get('/attack/top-hubs', { params })
      setTopHubs(res.data)
    } catch (error: any) {
      console.error('Error loading top hubs:', error)
    }
  }

  async function loadRedundancySuggestions(m: number = 10) {
    try {
      const region = REGIONS[selectedRegion]
      const params: any = { m, max_distance_km: 3000 }
      if (region.bbox) {
        params.minLat = region.bbox.minLat
        params.maxLat = region.bbox.maxLat
        params.minLon = region.bbox.minLon
        params.maxLon = region.bbox.maxLon
      }
      const res = await API.get('/defend/redundancy', { params })
      setRedundancySuggestions(res.data.suggestions || [])
      setShowRecommendationsPanel(true)
    } catch (error: any) {
      console.error('Error loading redundancy suggestions:', error)
      alert('Error: ' + (error.response?.data?.detail || error.message))
    }
  }

  // User-controlled: Tính số lượng routes/airports theo tỷ lệ user chọn
  const visibleRoutes = useMemo(() => {
    if (!showRoutes || routes.length === 0) return []
    const count = Math.floor((routes.length * routeRatio) / 100)
    return routes.slice(0, count)
  }, [routes, showRoutes, routeRatio])

  const visibleAirports = useMemo(() => {
    if (!showAirports || airports.length === 0) return []
    const count = Math.floor((airports.length * airportRatio) / 100)
    return airports.slice(0, count)
  }, [airports, showAirports, airportRatio])

  // Component để track zoom level với debounce để giảm lag
  function ZoomTracker({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
    const map = useMap()
    useEffect(() => {
      let timeoutId: number
      const updateZoom = () => {
        clearTimeout(timeoutId)
        timeoutId = window.setTimeout(() => {
          onZoomChange(map.getZoom())
        }, 100) // Debounce 100ms
      }
      map.on('zoomend', updateZoom)
      onZoomChange(map.getZoom()) // Initial zoom
      return () => {
        clearTimeout(timeoutId)
        map.off('zoomend', updateZoom)
      }
    }, [map, onZoomChange])
    return null
  }

  const region = REGIONS[selectedRegion]

  return (
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      display: 'flex', 
      flexDirection: 'row',
      overflow: 'hidden',
      fontFamily: 'Arial, sans-serif'
    }}>
      {/* Left Panel: Map */}
      <div style={{
        flex: '1 1 60%',
        minWidth: '600px',
        position: 'relative',
        background: '#f0f0f0',
        borderRight: '2px solid #ddd'
      }}>
        <MapContainer
          key={`${selectedRegion}-${mapKey}-${airports.length}-${routes.length}`}
          center={region.center}
          zoom={region.zoom}
          style={{ width: '100%', height: '100%' }}
          maxZoom={18}
          doubleClickZoom={false}
        >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='© OpenStreetMap'
        />
        
        <ZoomTracker onZoomChange={setZoom} />
        
        {/* Routes - màu cam, mờ, tối ưu performance */}
        {visibleRoutes.map((route, idx) => {
          if (route.geometry?.type === 'LineString' && route.geometry.coordinates) {
            const coords = route.geometry.coordinates.map(([lon, lat]: [number, number]) => [lat, lon])
            return (
              <Polyline
                key={`route-${route.properties?.source || idx}-${route.properties?.target || idx}`}
                positions={coords}
                color="#ff6600"
                weight={zoom < 4 ? 0.8 : 1}
                opacity={zoom < 3 ? 0.2 : 0.3}
                interactive={true}
                eventHandlers={{
                  dblclick: (e) => {
                    console.log('=== Polyline double-click detected ===')
                    e.originalEvent?.preventDefault()
                    e.originalEvent?.stopPropagation()
                    const src = route.properties?.source
                    const dst = route.properties?.target
                    console.log('Route:', src, '->', dst)
                    if (src && dst) {
                      console.log('Calling handleRemoveEdge...')
                      handleRemoveEdge(src, dst)
                    } else {
                      console.warn('Missing source or target!')
                    }
                  },
                  click: (e) => {
                    console.log('=== Polyline single-click ===')
                  }
                }}
              />
            )
          }
          return null
        })}
        
        {/* Airports - màu xanh lá, chấm nổi */}
        {visibleAirports.map((airport, idx) => {
          if (airport.geometry?.type === 'Point' && airport.geometry.coordinates) {
            const [lon, lat] = airport.geometry.coordinates
            const props = airport.properties || {}
            
            return (
              <Marker 
                key={`airport-${idx}`} 
                position={[lat, lon]}
                icon={airportIcon}
                eventHandlers={{
                  dblclick: (e) => {
                    console.log('=== Marker double-click detected ===', props.id)
                    e.originalEvent?.preventDefault()
                    e.originalEvent?.stopPropagation()
                    const nodeId = props.id
                    console.log('Node ID:', nodeId)
                    if (nodeId) {
                      console.log('Calling handleRemoveNode...')
                      handleRemoveNode(nodeId)
                    } else {
                      console.warn('No node ID found!')
                    }
                  },
                  click: (e) => {
                    console.log('=== Marker single-click ===', props.id)
                  }
                }}
              >
                <Popup>
                  <div>
                    <strong>{props.name}</strong><br/>
                    {props.city}, {props.country}<br/>
                    IATA: {props.iata || 'N/A'}<br/>
                    <br/>
                    <small style={{ color: '#666' }}>Double-click để xóa</small>
                  </div>
                </Popup>
              </Marker>
            )
          }
          return null
        })}
          </MapContainer>
          
          {/* Map Controls - Compact */}
          <div style={{
            position: 'absolute',
            top: '10px',
            left: '10px',
            background: 'white',
            padding: '12px',
            borderRadius: '8px',
            zIndex: 1000,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            minWidth: '220px',
            maxWidth: '250px'
          }}>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '16px' }}>Điều khiển</h3>
        
            <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold' }}>Map Controls</h3>
            
            {/* Khu vực */}
            <div style={{ marginBottom: '10px', padding: '8px', background: '#e8f4f8', borderRadius: '4px' }}>
              <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#0066cc', marginBottom: '3px' }}>
                Khu vực phân tích
              </div>
              <select
                value={selectedRegion}
                onChange={(e) => setSelectedRegion(e.target.value as keyof typeof REGIONS)}
                style={{ width: '100%', padding: '6px', fontSize: '12px', borderRadius: '4px', border: '1px solid #ccc' }}
              >
                {Object.entries(REGIONS).map(([key, r]) => (
                  <option key={key} value={key}>
                    {r.name}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: '10px', color: '#666', marginTop: '4px' }}>
                Chọn Global để xem toàn bộ mạng bay, hoặc zoom vào từng khu vực.
              </div>
            </div>
            
            {/* Sân bay */}
            <div style={{ marginBottom: '10px' }}>
              <div style={{ marginBottom: '5px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', fontSize: '12px' }}>
                  <input
                    type="checkbox"
                    checked={showAirports}
                    onChange={(e) => setShowAirports(e.target.checked)}
                    style={{ marginRight: '5px' }}
                  />
                  <strong>Airports</strong>
                </label>
                <span style={{ fontSize: '11px', color: '#666' }}>
                  {visibleAirports.length}/{airports.length}
                </span>
              </div>
              {showAirports && (
                <div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={airportRatio}
                    onChange={(e) => setAirportRatio(Number(e.target.value))}
                    style={{ width: '100%' }}
                  />
                  <div style={{ fontSize: '10px', color: '#666', textAlign: 'center', marginTop: '2px' }}>
                    {airportRatio}%
                  </div>
                </div>
              )}
            </div>

            {/* Tuyến bay */}
            <div style={{ marginBottom: '10px' }}>
              <div style={{ marginBottom: '5px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', fontSize: '12px' }}>
                  <input
                    type="checkbox"
                    checked={showRoutes}
                    onChange={(e) => setShowRoutes(e.target.checked)}
                    style={{ marginRight: '5px' }}
                  />
                  <strong>Routes</strong>
                </label>
                <span style={{ fontSize: '11px', color: '#666' }}>
                  {visibleRoutes.length}/{routes.length}
                </span>
              </div>
              {showRoutes && (
                <div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={routeRatio}
                    onChange={(e) => setRouteRatio(Number(e.target.value))}
                    style={{ width: '100%' }}
                  />
                  <div style={{ fontSize: '10px', color: '#666', textAlign: 'center', marginTop: '2px' }}>
                    {routeRatio}%
                  </div>
                </div>
              )}
            </div>

            <div style={{ fontSize: '10px', color: '#666', borderTop: '1px solid #eee', paddingTop: '8px' }}>
              Zoom: {zoom.toFixed(1)}
            </div>
            {loading && <div style={{ color: '#ff6600', marginTop: '8px', fontSize: '11px' }}>Loading...</div>}
          </div>

        {/* Removed Items Button - Compact */}
        {!showRemovedPanel && removedItems.length > 0 && (
          <button
            onClick={() => setShowRemovedPanel(true)}
            style={{
              position: 'absolute',
              top: '10px',
              right: '10px',
              background: '#ff0000',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              padding: '8px 12px',
              cursor: 'pointer',
              zIndex: 1000,
              boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
              fontWeight: 'bold',
              fontSize: '12px'
            }}
          >
            Removed ({removedItems.length})
          </button>
        )}
      </div>

      {/* Right Panel: Controls & Analysis */}
      <div style={{
        flex: '0 0 400px',
        display: 'flex',
        flexDirection: 'column',
        background: '#f8f9fa',
        borderLeft: '1px solid #ddd',
        overflow: 'hidden'
      }}>
        {/* Controls Section */}
        <div style={{
          flex: '0 0 auto',
          padding: '15px',
          background: 'white',
          borderBottom: '2px solid #ddd',
          maxHeight: '50vh',
          overflowY: 'auto'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold', color: '#0066cc' }}>Analysis & Controls</h2>
            <button
              onClick={() => setShowOverview(true)}
              style={{
                padding: '6px 10px',
                background: '#f5f5f5',
                border: '1px solid #ccc',
                borderRadius: '4px',
                fontSize: '11px',
                cursor: 'pointer'
              }}
            >
              Overview / Report
            </button>
          </div>
        
          {/* Quick Analysis */}
          <div style={{ marginBottom: '15px' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold', color: '#0066cc' }}>Quick Analysis</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
              <button
                onClick={() => runTopKImpactAnalysis()}
                disabled={loadingAnalysis}
                style={{
                  padding: '10px',
                  background: '#cc0066',
                  color: 'white',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: loadingAnalysis ? 'not-allowed' : 'pointer',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                }}
              >
                {loadingAnalysis ? '...' : `Top-${topK} Impact`}
              </button>
            </div>
            <button
              onClick={() => loadRedundancySuggestions(10)}
              style={{
                width: '100%',
                padding: '10px',
                background: '#00cc66',
                color: 'white',
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 'bold',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
            >
              Where to Add Redundancy?
            </button>
          </div>

          {/* Custom Attack Strategy */}
          <div style={{ marginBottom: '15px', paddingBottom: '15px', borderBottom: '1px solid #eee' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold', color: '#ff6600' }}>Custom Attack</h3>
            <div style={{ marginBottom: '8px' }}>
              <label style={{ fontSize: '11px', display: 'block', marginBottom: '3px', color: '#666' }}>Strategy:</label>
              <select
                value={attackStrategy}
                onChange={(e) => setAttackStrategy(e.target.value)}
                style={{ width: '100%', padding: '6px', fontSize: '12px', border: '1px solid #ccc', borderRadius: '4px' }}
              >
                <option value="random_attack">Random Attack</option>
                <option value="degree_targeted_attack">Degree Targeted</option>
                <option value="pagerank_targeted_attack">PageRank Targeted</option>
                <option value="betweenness_targeted_attack">Betweenness Targeted</option>
              </select>
            </div>
            <div style={{ marginBottom: '8px' }}>
              <label style={{ fontSize: '11px', display: 'block', marginBottom: '3px', color: '#666' }}>
                Max Fraction: {maxFraction}
              </label>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.1"
                value={maxFraction}
                onChange={(e) => setMaxFraction(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
            {attackStrategy === 'random_attack' && (
              <div style={{ marginBottom: '8px' }}>
                <label style={{ fontSize: '11px', display: 'block', marginBottom: '3px', color: '#666' }}>
                  N Runs: {nRuns}
                </label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={nRuns}
                  onChange={(e) => setNRuns(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>
            )}
            <button
              onClick={() => runCustomAttackAnalysis()}
              disabled={loadingAnalysis}
              style={{
                width: '100%',
                padding: '8px',
                background: '#ff6600',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: loadingAnalysis ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                fontWeight: 'bold',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
            >
              Run Custom Attack
            </button>
          </div>

          {/* Custom Defense Strategy */}
          <div style={{ marginBottom: '15px', paddingBottom: '15px', borderBottom: '1px solid #eee' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 'bold', color: '#00cc66' }}>
              🛡️ TER Defense (Effective Resistance)
            </h3>
            <div style={{ 
              fontSize: '10px', 
              color: '#666', 
              marginBottom: '10px', 
              padding: '8px', 
              background: '#f0f8f4', 
              borderRadius: '4px',
              lineHeight: '1.4'
            }}>
              <strong>Phương pháp:</strong> Thêm cạnh backup dựa trên <strong>Effective Resistance</strong> (TER - TITS2018). 
              Chọn k cạnh có R_eff cao nhất trong giới hạn khoảng cách để tăng robustness.
            </div>
            <div style={{ marginBottom: '8px' }}>
              <label style={{ fontSize: '11px', display: 'block', marginBottom: '3px', color: '#666' }}>
                Số cạnh backup (k): {kHubs}
              </label>
              <input
                type="range"
                min="5"
                max="200"
                value={kHubs}
                onChange={(e) => setKHubs(Number(e.target.value))}
                style={{ width: '100%' }}
              />
              <div style={{ fontSize: '10px', color: '#999', marginTop: '2px' }}>
                Số cạnh backup sẽ được thêm vào graph (không xóa cạnh cũ)
              </div>
            </div>
            <div style={{ marginBottom: '8px' }}>
              <label style={{ fontSize: '11px', display: 'block', marginBottom: '3px', color: '#666' }}>
                Max Distance: {maxDistance}km
              </label>
              <input
                type="range"
                min="1000"
                max="5000"
                step="500"
                value={maxDistance}
                onChange={(e) => setMaxDistance(Number(e.target.value))}
                style={{ width: '100%' }}
              />
              <div style={{ fontSize: '10px', color: '#999', marginTop: '2px' }}>
                Chỉ xét các cặp sân bay trong phạm vi này
              </div>
            </div>
            <div style={{ marginBottom: '8px' }}>
              <label style={{ fontSize: '11px', display: 'block', marginBottom: '3px', color: '#666' }}>Test Attack:</label>
              <select
                value={defenseAttackStrategy}
                onChange={(e) => setDefenseAttackStrategy(e.target.value)}
                style={{ width: '100%', padding: '6px', fontSize: '12px', border: '1px solid #ccc', borderRadius: '4px' }}
              >
                <option value="degree_targeted_attack">Degree Targeted</option>
                <option value="random_attack">Random Attack</option>
                <option value="pagerank_targeted_attack">PageRank Targeted</option>
                <option value="betweenness_targeted_attack">Betweenness Targeted</option>
              </select>
              <div style={{ fontSize: '10px', color: '#999', marginTop: '2px' }}>
                Chiến lược tấn công để đánh giá hiệu quả defense
              </div>
            </div>
            <button
              onClick={() => runCustomDefenseAnalysis()}
              disabled={loadingAnalysis}
              style={{
                width: '100%',
                padding: '8px',
                background: '#00cc66',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: loadingAnalysis ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                fontWeight: 'bold',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
            >
              {loadingAnalysis ? 'Running...' : 'Run TER Defense'}
            </button>
          </div>

          {/* Schneider Defense Strategy */}
          <div style={{ marginBottom: '15px', paddingBottom: '15px', borderBottom: '1px solid #eee' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 'bold', color: '#ff9900' }}>
              🔄 Schneider Defense (Edge Swapping)
            </h3>
            <div style={{ 
              fontSize: '10px', 
              color: '#666', 
              marginBottom: '10px', 
              padding: '8px', 
              background: '#fff8f0', 
              borderRadius: '4px',
              lineHeight: '1.4'
            }}>
              <strong>Phương pháp:</strong> Swap edges để tạo cấu trúc "onion-like" (kết nối nodes có degree tương tự). 
              Giữ nguyên số lượng nodes và edges (chỉ swap, không thêm/xóa). Tối ưu R-index để tăng robustness.
            </div>
            <div style={{ marginBottom: '8px' }}>
              <label style={{ fontSize: '11px', display: 'block', marginBottom: '3px', color: '#666' }}>
                Max Trials: {schneiderMaxTrials.toLocaleString()}
              </label>
              <input
                type="range"
                min="5000"
                max="50000"
                step="5000"
                value={schneiderMaxTrials}
                onChange={(e) => setSchneiderMaxTrials(Number(e.target.value))}
                style={{ width: '100%' }}
              />
              <div style={{ fontSize: '10px', color: '#999', marginTop: '2px' }}>
                Số lần thử swap tối đa (càng nhiều càng tốt nhưng chậm hơn)
              </div>
            </div>
            <div style={{ marginBottom: '8px' }}>
              <label style={{ fontSize: '11px', display: 'block', marginBottom: '3px', color: '#666' }}>
                Patience: {schneiderPatience.toLocaleString()}
              </label>
              <input
                type="range"
                min="1000"
                max="10000"
                step="1000"
                value={schneiderPatience}
                onChange={(e) => setSchneiderPatience(Number(e.target.value))}
                style={{ width: '100%' }}
              />
              <div style={{ fontSize: '10px', color: '#999', marginTop: '2px' }}>
                Dừng nếu không cải thiện sau N lần thử liên tiếp
              </div>
            </div>
            <div style={{ marginBottom: '8px' }}>
              <label style={{ fontSize: '11px', display: 'block', marginBottom: '3px', color: '#666' }}>Test Attack:</label>
              <select
                value={schneiderAttackStrategy}
                onChange={(e) => setSchneiderAttackStrategy(e.target.value)}
                style={{ width: '100%', padding: '6px', fontSize: '12px', border: '1px solid #ccc', borderRadius: '4px' }}
              >
                <option value="degree_targeted_attack">Degree Targeted</option>
                <option value="random_attack">Random Attack</option>
                <option value="pagerank_targeted_attack">PageRank Targeted</option>
                <option value="betweenness_targeted_attack">Betweenness Targeted</option>
              </select>
              <div style={{ fontSize: '10px', color: '#999', marginTop: '2px' }}>
                Chiến lược tấn công để đánh giá hiệu quả defense
              </div>
            </div>
            <button
              onClick={() => runSchneiderDefenseAnalysis()}
              disabled={loadingAnalysis}
              style={{
                width: '100%',
                padding: '8px',
                background: '#ff9900',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: loadingAnalysis ? 'not-allowed' : 'pointer',
                fontSize: '12px',
                fontWeight: 'bold',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
            >
              {loadingAnalysis ? 'Running...' : 'Run Schneider Defense'}
            </button>
          </div>

          {/* Route Case Study */}
          <div style={{ marginBottom: '10px' }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 'bold', color: '#9933cc' }}>Route Case Study</h3>
            <div style={{ fontSize: '11px', color: '#666', marginBottom: '6px' }}>
              Chọn <strong>quốc gia</strong> và <strong>sân bay</strong> cho điểm đi/đến. Ví dụ: Đức (FRA) → Việt Nam (SGN).
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '6px' }}>
              <div>
                <label style={{ fontSize: '11px', display: 'block', marginBottom: '2px', color: '#666' }}>From – Country</label>
                <select
                  value={countryFrom}
                  onChange={(e) => setCountryFrom(e.target.value)}
                  style={{ width: '100%', padding: '5px', fontSize: '12px', borderRadius: '4px', border: '1px solid #ccc', marginBottom: '4px' }}
                >
                  <option value="">-- All countries --</option>
                  {[...new Set(airportOptions.map((a: any) => a.country).filter((c: any) => c))]
                    .sort()
                    .map((c: any) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                </select>
                <label style={{ fontSize: '11px', display: 'block', marginBottom: '2px', color: '#666' }}>From – Airport</label>
                <select
                  value={caseSrc}
                  onChange={(e) => setCaseSrc(e.target.value)}
                  style={{ width: '100%', padding: '5px', fontSize: '12px', borderRadius: '4px', border: '1px solid #ccc' }}
                >
                  {airportOptions
                    .filter((a: any) => !countryFrom || a.country === countryFrom)
                    .sort((a: any, b: any) => (a.city || '').localeCompare(b.city || ''))
                    .map((a: any) => (
                      <option key={a.id} value={a.iata}>
                        {a.country} – {a.city} ({a.iata})
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label style={{ fontSize: '11px', display: 'block', marginBottom: '2px', color: '#666' }}>To – Country</label>
                <select
                  value={countryTo}
                  onChange={(e) => setCountryTo(e.target.value)}
                  style={{ width: '100%', padding: '5px', fontSize: '12px', borderRadius: '4px', border: '1px solid #ccc', marginBottom: '4px' }}
                >
                  <option value="">-- All countries --</option>
                  {[...new Set(airportOptions.map((a: any) => a.country).filter((c: any) => c))]
                    .sort()
                    .map((c: any) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                </select>
                <label style={{ fontSize: '11px', display: 'block', marginBottom: '2px', color: '#666' }}>To – Airport</label>
                <select
                  value={caseDst}
                  onChange={(e) => setCaseDst(e.target.value)}
                  style={{ width: '100%', padding: '5px', fontSize: '12px', borderRadius: '4px', border: '1px solid #ccc' }}
                >
                  {airportOptions
                    .filter((a: any) => !countryTo || a.country === countryTo)
                    .sort((a: any, b: any) => (a.city || '').localeCompare(b.city || ''))
                    .map((a: any) => (
                      <option key={a.id} value={a.iata}>
                        {a.country} – {a.city} ({a.iata})
                      </option>
                    ))}
                </select>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
              <input
                id="case-with-defense"
                type="checkbox"
                checked={caseWithDefense}
                onChange={(e) => setCaseWithDefense(e.target.checked)}
                style={{ marginRight: '6px' }}
              />
              <label htmlFor="case-with-defense" style={{ fontSize: '11px', color: '#666' }}>
                Compare with Defense
              </label>
            </div>
            {caseWithDefense && (
              <div style={{ marginBottom: '8px' }}>
                <label style={{ fontSize: '11px', display: 'block', marginBottom: '3px', color: '#666' }}>Defense Method:</label>
                <select
                  value={caseDefenseMethod}
                  onChange={(e) => setCaseDefenseMethod(e.target.value)}
                  style={{ width: '100%', padding: '5px', fontSize: '12px', borderRadius: '4px', border: '1px solid #ccc' }}
                >
                  <option value="TER">TER Defense (Effective Resistance)</option>
                  <option value="Schneider">Schneider Defense (Edge Swapping)</option>
                </select>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
              <button
                onClick={() => runRouteCaseStudy()}
                disabled={loadingAnalysis}
                style={{
                  padding: '8px',
                  background: '#9933cc',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: loadingAnalysis ? 'not-allowed' : 'pointer',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                }}
              >
                {loadingAnalysis ? 'Running...' : 'Analyze Route'}
              </button>
              <button
                onClick={() => runAttackSimulation()}
                disabled={loadingAnalysis}
                style={{
                  padding: '8px',
                  background: '#ff6600',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: loadingAnalysis ? 'not-allowed' : 'pointer',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                }}
              >
                {loadingAnalysis ? 'Running...' : 'Attack Simulation'}
              </button>
            </div>

            {/* Kết quả tóm tắt ngay dưới nút để dễ nhìn */}
            {caseResult && (
              <div style={{ marginTop: '8px', padding: '8px', background: '#f9f5ff', borderRadius: '4px', border: '1px solid #e0d5ff', fontSize: '11px' }}>
                <div style={{ fontWeight: 'bold', marginBottom: '4px', color: '#6600cc' }}>
                  {caseResult.src_iata} → {caseResult.dst_iata}
                </div>
                <div>
                  <strong>Baseline</strong> — Connected: {caseResult.baseline?.connected ? 'YES' : 'NO'}, 
                  Hops: {caseResult.baseline?.hops ?? 'N/A'}, 
                  Shortest paths: {caseResult.baseline?.num_shortest_paths ?? 0}
                </div>
                {caseResult.with_defense && (
                  <div>
                    <strong>With Defense</strong> — Connected: {caseResult.with_defense?.connected ? 'YES' : 'NO'}, 
                    Hops: {caseResult.with_defense?.hops ?? 'N/A'}, 
                    Shortest paths: {caseResult.with_defense?.num_shortest_paths ?? 0}, 
                    Added edges: {caseResult.added_edges}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Top-K Impact Settings */}
          <div>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold', color: '#cc0066' }}>Top-K Impact</h3>
            <div style={{ marginBottom: '8px' }}>
              <label style={{ fontSize: '11px', display: 'block', marginBottom: '3px', color: '#666' }}>
                K: {topK}
              </label>
              <input
                type="range"
                min="5"
                max="20"
                value={topK}
                onChange={(e) => setTopK(Number(e.target.value))}
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ marginBottom: '8px' }}>
              <label style={{ fontSize: '11px', display: 'block', marginBottom: '3px', color: '#666' }}>Strategy:</label>
              <select
                value={topKStrategy}
                onChange={(e) => setTopKStrategy(e.target.value)}
                style={{ width: '100%', padding: '6px', fontSize: '12px', border: '1px solid #ccc', borderRadius: '4px' }}
              >
                <option value="degree">By Degree</option>
                <option value="betweenness">By Betweenness</option>
              </select>
            </div>
          </div>
        </div>

          {/* Charts Section */}
        <div style={{
          flex: '1 1 auto',
          padding: '20px',
          background: '#f8f9fa',
          overflowY: 'auto',
          minHeight: 0
        }}>

          {/* Robustness Curves */}
          {showCurvesPanel && (robustnessCurves || schneiderDefenseResult) && (
            <div>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                marginBottom: '20px',
                paddingBottom: '15px',
                borderBottom: '2px solid #0066cc'
              }}>
                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold', color: '#0066cc' }}>📊 Robustness Analysis</h3>
                <button
                  onClick={() => {
                    setShowCurvesPanel(false)
                    setSchneiderDefenseResult(null) // Clear Schneider result when closing
                  }}
                  style={{
                    background: '#f0f0f0',
                    border: '1px solid #ccc',
                    borderRadius: '5px',
                    padding: '6px 12px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 'bold'
                  }}
                >
                  ✕ Close
                </button>
              </div>
              
              {robustnessCurves && robustnessCurves.baseline && (
                <div style={{ 
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '15px',
                  marginBottom: '20px'
                }}>
                  {/* LCC Table */}
                  <div style={{ 
                    fontSize: '12px', 
                    color: '#666', 
                    padding: '12px', 
                    background: 'white',
                    borderRadius: '8px',
                    border: '1px solid #e0e0e0',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                  }}>
                    <strong style={{ color: '#0066cc', fontSize: '13px' }}>📊 LCC Metrics</strong><br/>
                    <div style={{ marginTop: '8px' }}>
                      <div>Nodes: <strong>{robustnessCurves.baseline.nodes}</strong></div>
                      <div>Edges: <strong>{robustnessCurves.baseline.edges}</strong></div>
                      <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid #eee' }}>
                        LCC Size: <strong style={{ color: '#0066cc', fontSize: '14px' }}>{robustnessCurves.baseline.lcc_norm?.toFixed(3)}</strong>
                      </div>
                    </div>
                  </div>
                  
                  {/* Diameter Table */}
                  <div style={{ 
                    fontSize: '12px', 
                    color: '#666', 
                    padding: '12px', 
                    background: 'white',
                    borderRadius: '8px',
                    border: '1px solid #e0e0e0',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                  }}>
                    <strong style={{ color: '#0066cc', fontSize: '13px' }}>📏 Diameter Metrics</strong><br/>
                    <div style={{ marginTop: '8px' }}>
                      <div>Nodes: <strong>{robustnessCurves.baseline.nodes}</strong></div>
                      <div>Edges: <strong>{robustnessCurves.baseline.edges}</strong></div>
                      <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid #eee' }}>
                        Diameter: <strong style={{ color: '#ff6600', fontSize: '14px' }}>{robustnessCurves.baseline.diameter?.toFixed(1)}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Chart 1: Fraction Removed vs Relative LCC Size */}
              {(() => {
                const ref =
                  robustnessCurves.random_attack ||
                  robustnessCurves.degree_targeted_attack ||
                  robustnessCurves.pagerank_targeted_attack ||
                  robustnessCurves.betweenness_targeted_attack

                if (!ref) return null

                const fractions = ref.fraction_removed || []

                return (
                <div style={{ 
                  marginBottom: '30px',
                  padding: '15px',
                  background: 'white',
                  borderRadius: '8px',
                  border: '1px solid #e0e0e0',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.08)'
                }}>
                  <h4 style={{ margin: '0 0 15px 0', fontSize: '15px', fontWeight: 'bold', color: '#0066cc' }}>
                    📈 Fraction Removed vs Relative LCC Size
                  </h4>
                  <div 
                    onClick={() => setZoomedChart({
                      title: 'Fraction Removed vs Relative LCC Size',
                      data: fractions.map((f: number, i: number) => ({
                        fraction: f,
                        ...(robustnessCurves.random_attack && {
                          'Random Attack': robustnessCurves.random_attack.relative_lcc_size[i],
                        }),
                        ...(robustnessCurves.degree_targeted_attack && {
                          'Degree Targeted': robustnessCurves.degree_targeted_attack.relative_lcc_size[i],
                        }),
                        ...(robustnessCurves.pagerank_targeted_attack && {
                          'PageRank Targeted': robustnessCurves.pagerank_targeted_attack.relative_lcc_size[i],
                        }),
                        ...(robustnessCurves.betweenness_targeted_attack && {
                          'Betweenness Targeted': robustnessCurves.betweenness_targeted_attack.relative_lcc_size[i],
                        }),
                      })),
                      config: {
                        xKey: 'fraction',
                        xLabel: 'Fraction Removed',
                        yLabel: 'Relative LCC Size',
                        lines: [
                          ...(robustnessCurves.random_attack ? [{ key: 'Random Attack', stroke: '#8884d8' }] : []),
                          ...(robustnessCurves.degree_targeted_attack ? [{ key: 'Degree Targeted', stroke: '#82ca9d' }] : []),
                          ...(robustnessCurves.pagerank_targeted_attack ? [{ key: 'PageRank Targeted', stroke: '#9933cc' }] : []),
                          ...(robustnessCurves.betweenness_targeted_attack ? [{ key: 'Betweenness Targeted', stroke: '#ff7300' }] : []),
                        ]
                      }
                    })}
                    style={{ cursor: 'pointer' }}
                  >
                    <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={fractions.map((f: number, i: number) => ({
                        fraction: f,
                        ...(robustnessCurves.random_attack && {
                          'Random Attack': robustnessCurves.random_attack.relative_lcc_size[i],
                        }),
                        ...(robustnessCurves.degree_targeted_attack && {
                          'Degree Targeted': robustnessCurves.degree_targeted_attack.relative_lcc_size[i],
                        }),
                        ...(robustnessCurves.pagerank_targeted_attack && {
                          'PageRank Targeted': robustnessCurves.pagerank_targeted_attack.relative_lcc_size[i],
                        }),
                        ...(robustnessCurves.betweenness_targeted_attack && {
                          'Betweenness Targeted': robustnessCurves.betweenness_targeted_attack.relative_lcc_size[i],
                        }),
                      }))}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="fraction" label={{ value: 'Fraction Removed', position: 'insideBottom', offset: -5 }} />
                        <YAxis label={{ value: 'Relative LCC Size', angle: -90, position: 'insideLeft' }} />
                        <Tooltip />
                        <Legend />
                        {robustnessCurves.random_attack && (
                          <Line type="monotone" dataKey="Random Attack" stroke="#8884d8" strokeWidth={2} dot={{ r: 3 }} />
                        )}
                        {robustnessCurves.degree_targeted_attack && (
                          <Line type="monotone" dataKey="Degree Targeted" stroke="#82ca9d" strokeWidth={2} dot={{ r: 3 }} />
                        )}
                        {robustnessCurves.pagerank_targeted_attack && (
                          <Line type="monotone" dataKey="PageRank Targeted" stroke="#9933cc" strokeWidth={2} dot={{ r: 3 }} />
                        )}
                        {robustnessCurves.betweenness_targeted_attack && (
                          <Line type="monotone" dataKey="Betweenness Targeted" stroke="#ff7300" strokeWidth={2} dot={{ r: 3 }} />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ fontSize: '11px', color: '#999', marginTop: '8px', textAlign: 'center' }}>
                    Click để phóng to
                  </div>
                </div>
                )
              })()}

              {/* Chart 2: Fraction Removed vs Diameter */}
              {(() => {
                const ref =
                  robustnessCurves.random_attack ||
                  robustnessCurves.degree_targeted_attack ||
                  robustnessCurves.pagerank_targeted_attack ||
                  robustnessCurves.betweenness_targeted_attack

                if (!ref) return null

                const fractions = ref.fraction_removed || []

                return (
                <div style={{ 
                  marginBottom: '30px',
                  padding: '15px',
                  background: 'white',
                  borderRadius: '8px',
                  border: '1px solid #e0e0e0',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.08)'
                }}>
                  <h4 style={{ margin: '0 0 15px 0', fontSize: '15px', fontWeight: 'bold', color: '#0066cc' }}>
                    📉 Fraction Removed vs Diameter
                  </h4>
                  <div 
                    onClick={() => setZoomedChart({
                      title: 'Fraction Removed vs Diameter',
                      data: fractions.map((f: number, i: number) => ({
                        fraction: f,
                        ...(robustnessCurves.random_attack && {
                          'Random Attack': robustnessCurves.random_attack.diameter[i],
                        }),
                        ...(robustnessCurves.degree_targeted_attack && {
                          'Degree Targeted': robustnessCurves.degree_targeted_attack.diameter[i],
                        }),
                        ...(robustnessCurves.pagerank_targeted_attack && {
                          'PageRank Targeted': robustnessCurves.pagerank_targeted_attack.diameter[i],
                        }),
                        ...(robustnessCurves.betweenness_targeted_attack && {
                          'Betweenness Targeted': robustnessCurves.betweenness_targeted_attack.diameter[i],
                        }),
                      })),
                      config: {
                        xKey: 'fraction',
                        xLabel: 'Fraction Removed',
                        yLabel: 'Diameter',
                        lines: [
                          ...(robustnessCurves.random_attack ? [{ key: 'Random Attack', stroke: '#8884d8' }] : []),
                          ...(robustnessCurves.degree_targeted_attack ? [{ key: 'Degree Targeted', stroke: '#82ca9d' }] : []),
                          ...(robustnessCurves.pagerank_targeted_attack ? [{ key: 'PageRank Targeted', stroke: '#9933cc' }] : []),
                          ...(robustnessCurves.betweenness_targeted_attack ? [{ key: 'Betweenness Targeted', stroke: '#ff7300' }] : []),
                        ]
                      }
                    })}
                    style={{ cursor: 'pointer' }}
                  >
                    <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={fractions.map((f: number, i: number) => ({
                        fraction: f,
                        ...(robustnessCurves.random_attack && {
                          'Random Attack': robustnessCurves.random_attack.diameter[i],
                        }),
                        ...(robustnessCurves.degree_targeted_attack && {
                          'Degree Targeted': robustnessCurves.degree_targeted_attack.diameter[i],
                        }),
                        ...(robustnessCurves.pagerank_targeted_attack && {
                          'PageRank Targeted': robustnessCurves.pagerank_targeted_attack.diameter[i],
                        }),
                        ...(robustnessCurves.betweenness_targeted_attack && {
                          'Betweenness Targeted': robustnessCurves.betweenness_targeted_attack.diameter[i],
                        }),
                      }))}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="fraction" label={{ value: 'Fraction Removed', position: 'insideBottom', offset: -5 }} />
                        <YAxis label={{ value: 'Diameter', angle: -90, position: 'insideLeft' }} />
                        <Tooltip />
                        <Legend />
                        {robustnessCurves.random_attack && (
                          <Line type="monotone" dataKey="Random Attack" stroke="#8884d8" strokeWidth={2} dot={{ r: 3 }} />
                        )}
                        {robustnessCurves.degree_targeted_attack && (
                          <Line type="monotone" dataKey="Degree Targeted" stroke="#82ca9d" strokeWidth={2} dot={{ r: 3 }} />
                        )}
                        {robustnessCurves.pagerank_targeted_attack && (
                          <Line type="monotone" dataKey="PageRank Targeted" stroke="#9933cc" strokeWidth={2} dot={{ r: 3 }} />
                        )}
                        {robustnessCurves.betweenness_targeted_attack && (
                          <Line type="monotone" dataKey="Betweenness Targeted" stroke="#ff7300" strokeWidth={2} dot={{ r: 3 }} />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ fontSize: '11px', color: '#999', marginTop: '8px', textAlign: 'center' }}>
                    Click để phóng to
                  </div>
                </div>
                )
              })()}

              {/* Defense comparison if available */}
              {robustnessCurves.degree_attack_original && (
                <div style={{ 
                  marginTop: '30px',
                  marginBottom: '30px',
                  padding: '15px',
                  background: 'white',
                  borderRadius: '8px',
                  border: '2px solid #00cc66',
                  boxShadow: '0 2px 6px rgba(0,204,102,0.15)'
                }}>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: 'bold', color: '#00cc66' }}>
                    🛡️ TER Defense: Reinforced vs Original
                  </h4>
                  <div style={{ 
                    fontSize: '12px', 
                    color: '#666', 
                    marginBottom: '15px',
                    padding: '10px',
                    background: '#f0f8f4',
                    borderRadius: '5px'
                  }}>
                    <div style={{ marginBottom: '6px' }}>
                      <strong>Phương pháp:</strong> TER (Topological Effective Resistance) - Thêm cạnh backup dựa trên Effective Resistance
                    </div>
                    <div><strong>Original:</strong> {robustnessCurves.baseline_original?.edges} edges</div>
                    <div><strong>Reinforced:</strong> {robustnessCurves.baseline_reinforced?.edges} edges (+{robustnessCurves.baseline_reinforced?.edges - robustnessCurves.baseline_original?.edges} backup edges)</div>
                  </div>
                  <div 
                    onClick={() => setZoomedChart({
                      title: 'TER Defense: Reinforced vs Original',
                      data: robustnessCurves.degree_attack_original.fraction_removed.map((f: number, i: number) => ({
                        fraction: f,
                        'Original (Degree Attack)': robustnessCurves.degree_attack_original.relative_lcc_size[i],
                        'Reinforced (Degree Attack)': robustnessCurves.degree_attack_reinforced?.relative_lcc_size[i] || null
                      })),
                      config: {
                        xKey: 'fraction',
                        xLabel: 'Fraction Removed',
                        yLabel: 'Relative LCC Size',
                        lines: [
                          { key: 'Original (Degree Attack)', stroke: '#ff0000' },
                          { key: 'Reinforced (Degree Attack)', stroke: '#00cc00' }
                        ]
                      }
                    })}
                    style={{ cursor: 'pointer' }}
                  >
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={robustnessCurves.degree_attack_original.fraction_removed.map((f: number, i: number) => ({
                        fraction: f,
                        'Original (Degree Attack)': robustnessCurves.degree_attack_original.relative_lcc_size[i],
                        'Reinforced (Degree Attack)': robustnessCurves.degree_attack_reinforced?.relative_lcc_size[i] || null
                      }))}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="fraction" label={{ value: 'Fraction Removed', position: 'insideBottom', offset: -5 }} />
                        <YAxis label={{ value: 'Relative LCC Size', angle: -90, position: 'insideLeft' }} />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="Original (Degree Attack)" stroke="#ff0000" strokeWidth={2} dot={{ r: 3 }} />
                        <Line type="monotone" dataKey="Reinforced (Degree Attack)" stroke="#00cc00" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ fontSize: '11px', color: '#999', marginTop: '8px', textAlign: 'center' }}>
                    Click để phóng to
                  </div>
                </div>
              )}

              {/* Custom defense comparison */}
              {robustnessCurves.attack_original && (
                <div style={{ 
                  marginTop: '30px',
                  marginBottom: '30px',
                  padding: '15px',
                  background: 'white',
                  borderRadius: '8px',
                  border: '2px solid #00cc66',
                  boxShadow: '0 2px 6px rgba(0,204,102,0.15)'
                }}>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: 'bold', color: '#00cc66' }}>
                    🛡️ TER Defense (Effective Resistance): {robustnessCurves.attack_strategy?.replace('_', ' ').replace('attack', '').trim()}
                  </h4>
                  <div style={{ 
                    fontSize: '12px', 
                    color: '#666', 
                    marginBottom: '15px',
                    padding: '10px',
                    background: '#f0f8f4',
                    borderRadius: '5px'
                  }}>
                    <div style={{ marginBottom: '6px' }}>
                      <strong>Phương pháp:</strong> TER (Topological Effective Resistance) - Thêm cạnh backup dựa trên Effective Resistance
                    </div>
                    <div><strong>Original:</strong> {robustnessCurves.baseline_original?.edges} edges</div>
                    <div><strong>Reinforced:</strong> {robustnessCurves.baseline_reinforced?.edges} edges (+{robustnessCurves.added_edges} backup edges)</div>
                    <div style={{ marginTop: '6px', fontSize: '11px', color: '#555' }}>
                      <strong>Configuration:</strong> k={robustnessCurves.k_hubs} backup edges, Max distance: {robustnessCurves.max_distance_km}km
                    </div>
                  </div>
                  <div 
                    onClick={() => setZoomedChart({
                      title: `Custom Defense: ${robustnessCurves.attack_strategy?.replace('_', ' ').replace('attack', '').trim()}`,
                      data: robustnessCurves.attack_original.fraction_removed.map((f: number, i: number) => ({
                        fraction: f,
                        'Original': robustnessCurves.attack_original.relative_lcc_size[i],
                        'Reinforced': robustnessCurves.attack_reinforced?.relative_lcc_size[i] || null
                      })),
                      config: {
                        xKey: 'fraction',
                        xLabel: 'Fraction Removed',
                        yLabel: 'Relative LCC Size',
                        lines: [
                          { key: 'Original', stroke: '#ff0000' },
                          { key: 'Reinforced', stroke: '#00cc00' }
                        ]
                      }
                    })}
                    style={{ cursor: 'pointer' }}
                  >
                    <ResponsiveContainer width="100%" height={280}>
                      <LineChart data={robustnessCurves.attack_original.fraction_removed.map((f: number, i: number) => ({
                        fraction: f,
                        'Original': robustnessCurves.attack_original.relative_lcc_size[i],
                        'Reinforced': robustnessCurves.attack_reinforced?.relative_lcc_size[i] || null
                      }))}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="fraction" label={{ value: 'Fraction Removed', position: 'insideBottom', offset: -5 }} />
                        <YAxis label={{ value: 'Relative LCC Size', angle: -90, position: 'insideLeft' }} />
                        <Tooltip />
                        <Legend />
                        <Line type="monotone" dataKey="Original" stroke="#ff0000" strokeWidth={2} dot={{ r: 3 }} />
                        <Line type="monotone" dataKey="Reinforced" stroke="#00cc00" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div style={{ fontSize: '11px', color: '#999', marginTop: '8px', textAlign: 'center' }}>
                    Click để phóng to
                  </div>
                </div>
              )}

              {/* Schneider Defense comparison */}
              {schneiderDefenseResult && schneiderDefenseResult.attack_original && (
                <div style={{ 
                  marginTop: '30px',
                  marginBottom: '30px',
                  padding: '15px',
                  background: 'white',
                  borderRadius: '8px',
                  border: '2px solid #ff9900',
                  boxShadow: '0 2px 6px rgba(255,153,0,0.15)'
                }}>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: 'bold', color: '#ff9900' }}>
                    🔄 Schneider Defense (Edge Swapping): {schneiderDefenseResult.attack_strategy?.replace('_', ' ').replace('attack', '').trim()}
                  </h4>
                  <div style={{ 
                    fontSize: '12px', 
                    color: '#666', 
                    marginBottom: '15px',
                    padding: '10px',
                    background: '#fff8f0',
                    borderRadius: '5px',
                    lineHeight: '1.6'
                  }}>
                    <div style={{ marginBottom: '8px' }}>
                      <strong>Phương pháp:</strong> Schneider Defense (Edge Swapping) - Swap edges để tạo cấu trúc "onion-like"
                    </div>
                    <div style={{ marginBottom: '4px', fontSize: '11px', color: '#555', paddingLeft: '8px' }}>
                      • <strong>Onion-like structure:</strong> Kết nối nodes có degree tương tự (hubs với hubs, nodes với nodes)
                    </div>
                    <div style={{ marginBottom: '4px', fontSize: '11px', color: '#555', paddingLeft: '8px' }}>
                      • <strong>Giữ nguyên số edges:</strong> Chỉ swap, không thêm/xóa edges (khác với TER Defense)
                    </div>
                    <div style={{ marginBottom: '4px', fontSize: '11px', color: '#555', paddingLeft: '8px' }}>
                      • <strong>Tối ưu R-index:</strong> Chọn swap làm tăng robustness index (R-index) nhất
                    </div>
                    <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid #ffe0b3' }}>
                      <div><strong>Original Graph:</strong> {schneiderDefenseResult.baseline_original?.edges} edges, {schneiderDefenseResult.baseline_original?.nodes} nodes</div>
                      <div><strong>Optimized Graph:</strong> {schneiderDefenseResult.baseline_optimized?.edges} edges, {schneiderDefenseResult.baseline_optimized?.nodes} nodes</div>
                      <div style={{ marginTop: '6px', fontSize: '11px', color: '#555' }}>
                        <strong>Swaps:</strong> {schneiderDefenseResult.swapped_edges_info?.accepted_swaps || 0} accepted swaps (từ {schneiderDefenseResult.schneider_info?.trials_done || 0} trials)
                      </div>
                      <div style={{ marginTop: '4px', fontSize: '11px', color: '#555' }}>
                        <strong>R-index:</strong> {schneiderDefenseResult.schneider_info?.R_best_static?.toFixed(4) || 'N/A'} 
                        (càng cao = càng robust)
                      </div>
                      <div style={{ marginTop: '4px', fontSize: '11px', color: '#555' }}>
                        <strong>Configuration:</strong> Max trials: {schneiderDefenseResult.schneider_info?.trials_done?.toLocaleString() || 'N/A'}, 
                        Patience: {schneiderDefenseResult.schneider_info?.patience?.toLocaleString() || 'N/A'}
                      </div>
                    </div>
                  </div>
                  
                  {/* LCC Size Chart */}
                  <div style={{ marginBottom: '20px' }}>
                    <h5 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 'bold', color: '#666' }}>
                      Relative LCC Size
                    </h5>
                    <div 
                      onClick={() => {
                        if (schneiderDefenseResult.attack_original && schneiderDefenseResult.attack_original.fraction_removed) {
                          setZoomedChart({
                            title: `Schneider Defense: ${schneiderDefenseResult.attack_strategy?.replace('_', ' ').replace('attack', '').trim()}`,
                            data: schneiderDefenseResult.attack_original.fraction_removed.map((f: number, i: number) => ({
                              fraction: f,
                              'Original': schneiderDefenseResult.attack_original.relative_lcc_size[i],
                              'Optimized': schneiderDefenseResult.attack_optimized?.relative_lcc_size[i] || null
                            })),
                            config: {
                              xKey: 'fraction',
                              xLabel: 'Fraction Removed',
                              yLabel: 'Relative LCC Size',
                              lines: [
                                { key: 'Original', stroke: '#ff0000' },
                                { key: 'Optimized', stroke: '#ff9900' }
                              ]
                            }
                          });
                        }
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <ResponsiveContainer width="100%" height={280}>
                        <LineChart data={schneiderDefenseResult.attack_original.fraction_removed.map((f: number, i: number) => ({
                          fraction: f,
                          'Original': schneiderDefenseResult.attack_original.relative_lcc_size[i],
                          'Optimized': schneiderDefenseResult.attack_optimized?.relative_lcc_size[i] || null
                        }))}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="fraction" label={{ value: 'Fraction Removed', position: 'insideBottom', offset: -5 }} />
                          <YAxis label={{ value: 'Relative LCC Size', angle: -90, position: 'insideLeft' }} />
                          <Tooltip />
                          <Legend />
                          <Line type="monotone" dataKey="Original" stroke="#ff0000" strokeWidth={2} dot={{ r: 3 }} />
                          <Line type="monotone" dataKey="Optimized" stroke="#ff9900" strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={{ fontSize: '11px', color: '#999', marginTop: '8px', textAlign: 'center' }}>
                      Click để phóng to
                    </div>
                  </div>

                  {/* Diameter Chart */}
                  <div>
                    <h5 style={{ margin: '0 0 10px 0', fontSize: '13px', fontWeight: 'bold', color: '#666' }}>
                      Diameter
                    </h5>
                    <div 
                      onClick={() => {
                        if (schneiderDefenseResult.attack_original && schneiderDefenseResult.attack_original.fraction_removed) {
                          setZoomedChart({
                            title: `Schneider Defense - Diameter: ${schneiderDefenseResult.attack_strategy?.replace('_', ' ').replace('attack', '').trim()}`,
                            data: schneiderDefenseResult.attack_original.fraction_removed.map((f: number, i: number) => ({
                              fraction: f,
                              'Original': schneiderDefenseResult.attack_original.diameter[i],
                              'Optimized': schneiderDefenseResult.attack_optimized?.diameter[i] || null
                            })),
                            config: {
                              xKey: 'fraction',
                              xLabel: 'Fraction Removed',
                              yLabel: 'Diameter',
                              lines: [
                                { key: 'Original', stroke: '#ff0000' },
                                { key: 'Optimized', stroke: '#ff9900' }
                              ]
                            }
                          });
                        }
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <ResponsiveContainer width="100%" height={280}>
                        <LineChart data={schneiderDefenseResult.attack_original.fraction_removed.map((f: number, i: number) => ({
                          fraction: f,
                          'Original': schneiderDefenseResult.attack_original.diameter[i],
                          'Optimized': schneiderDefenseResult.attack_optimized?.diameter[i] || null
                        }))}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="fraction" label={{ value: 'Fraction Removed', position: 'insideBottom', offset: -5 }} />
                          <YAxis label={{ value: 'Diameter', angle: -90, position: 'insideLeft' }} />
                          <Tooltip />
                          <Legend />
                          <Line type="monotone" dataKey="Original" stroke="#ff0000" strokeWidth={2} dot={{ r: 3 }} />
                          <Line type="monotone" dataKey="Optimized" stroke="#ff9900" strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={{ fontSize: '11px', color: '#999', marginTop: '8px', textAlign: 'center' }}>
                      Click để phóng to
                    </div>
                  </div>
                </div>
              )}

              {/* Top-K Impact Analysis */}
              {topKImpact && (
                <>
                  {/* Top Hubs Info */}
                  <div style={{ 
                    marginTop: '30px',
                    marginBottom: '20px',
                    padding: '15px',
                    background: 'white',
                    borderRadius: '8px',
                    border: '2px solid #cc0066',
                    boxShadow: '0 2px 6px rgba(204,0,102,0.15)'
                  }}>
                    <h4 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: 'bold', color: '#cc0066' }}>
                      🎯 Top-{topKImpact.k} Hubs Impact ({topKImpact.strategy})
                    </h4>
                    <div style={{ 
                      fontSize: '12px', 
                      color: '#666', 
                      maxHeight: '120px', 
                      overflowY: 'auto', 
                      padding: '12px', 
                      background: '#fff5f8',
                      borderRadius: '6px',
                      border: '1px solid #ffe0e8'
                    }}>
                      <strong style={{ color: '#cc0066' }}>Top Hubs:</strong>
                      {topKImpact.hubs?.slice(0, 5).map((hub: any, idx: number) => (
                        <div key={idx} style={{ marginTop: '5px', paddingLeft: '5px' }}>
                          <span style={{ fontWeight: 'bold', color: '#cc0066' }}>{idx + 1}.</span> {hub.name} ({hub.iata}) - {hub.city}
                        </div>
                      ))}
                      {topKImpact.hubs?.length > 5 && (
                        <div style={{ marginTop: '5px', fontStyle: 'italic', color: '#999', paddingLeft: '5px' }}>
                          ... and {topKImpact.hubs.length - 5} more hubs
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Chart 1: LCC Size */}
                  <div style={{ 
                    marginBottom: '30px',
                    padding: '15px',
                    background: 'white',
                    borderRadius: '8px',
                    border: '1px solid #e0e0e0',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.08)'
                  }}>
                    <h4 style={{ margin: '0 0 15px 0', fontSize: '15px', fontWeight: 'bold', color: '#0066cc' }}>
                      📊 Top-{topKImpact.k} Hubs Impact: LCC Size
                    </h4>
                    <div 
                      onClick={() => setZoomedChart({
                        title: `Top-${topKImpact.k} Hubs Impact - LCC Size (${topKImpact.strategy})`,
                        data: topKImpact.impact_curve.map((point: any) => ({
                          step: point.step,
                          'LCC Size': point.lcc_norm
                        })),
                        config: {
                          xKey: 'step',
                          xLabel: 'Hubs Removed',
                          yLabel: 'LCC Size (normalized)',
                          lines: [
                            { key: 'LCC Size', stroke: '#8884d8' }
                          ]
                        }
                      })}
                      style={{ cursor: 'pointer' }}
                    >
                      <ResponsiveContainer width="100%" height={280}>
                        <LineChart data={topKImpact.impact_curve.map((point: any) => ({
                          step: point.step,
                          'LCC Size': point.lcc_norm
                        }))}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="step" label={{ value: 'Hubs Removed', position: 'insideBottom', offset: -5 }} />
                          <YAxis label={{ value: 'LCC Size (normalized)', angle: -90, position: 'insideLeft' }} />
                          <Tooltip />
                          <Legend />
                          <Line type="monotone" dataKey="LCC Size" stroke="#8884d8" strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={{ fontSize: '11px', color: '#999', marginTop: '8px', textAlign: 'center' }}>
                      Click để phóng to
                    </div>
                  </div>

                  {/* Chart 2: Diameter */}
                  <div style={{ 
                    marginBottom: '30px',
                    padding: '15px',
                    background: 'white',
                    borderRadius: '8px',
                    border: '1px solid #e0e0e0',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.08)'
                  }}>
                    <h4 style={{ margin: '0 0 15px 0', fontSize: '15px', fontWeight: 'bold', color: '#0066cc' }}>
                      📉 Top-{topKImpact.k} Hubs Impact: Diameter
                    </h4>
                    <div 
                      onClick={() => setZoomedChart({
                        title: `Top-${topKImpact.k} Hubs Impact - Diameter (${topKImpact.strategy})`,
                        data: topKImpact.impact_curve.map((point: any) => ({
                          step: point.step,
                          'Diameter': point.diameter
                        })),
                        config: {
                          xKey: 'step',
                          xLabel: 'Hubs Removed',
                          yLabel: 'Diameter',
                          lines: [
                            { key: 'Diameter', stroke: '#82ca9d' }
                          ]
                        }
                      })}
                      style={{ cursor: 'pointer' }}
                    >
                      <ResponsiveContainer width="100%" height={280}>
                        <LineChart data={topKImpact.impact_curve.map((point: any) => ({
                          step: point.step,
                          'Diameter': point.diameter
                        }))}>
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="step" label={{ value: 'Hubs Removed', position: 'insideBottom', offset: -5 }} />
                          <YAxis label={{ value: 'Diameter', angle: -90, position: 'insideLeft' }} />
                          <Tooltip />
                          <Legend />
                          <Line type="monotone" dataKey="Diameter" stroke="#82ca9d" strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={{ fontSize: '11px', color: '#999', marginTop: '8px', textAlign: 'center' }}>
                      Click để phóng to
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Route Case Study Result */}
          {caseResult && (
            <div style={{ 
              marginTop: '30px', 
              padding: '15px', 
              background: 'white', 
              borderRadius: '8px',
              border: '2px solid #9933cc',
              boxShadow: '0 2px 6px rgba(153,51,204,0.15)'
            }}>
              <h4 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: 'bold', color: '#9933cc' }}>
                📍 Route Case Study: {caseResult.src_iata} → {caseResult.dst_iata}
              </h4>
              <div style={{ fontSize: '12px', color: '#444', marginBottom: '12px' }}>
                Phân tích số đường đi ngắn nhất (unweighted) giữa hai sân bay, trước và sau khi thêm <strong>TER Defense</strong> (Effective Resistance - thêm cạnh backup).
              </div>
              <div style={{ display: 'flex', gap: '16px', fontSize: '12px' }}>
                <div style={{ flex: 1, background: '#f9f9f9', padding: '10px', borderRadius: '6px', border: '1px solid #e0e0e0' }}>
                  <strong style={{ color: '#333' }}>Baseline (không defense)</strong>
                  {caseResult.baseline?.connected ? (
                    <>
                      <div style={{ marginTop: '6px' }}>Connected: <strong style={{ color: '#00aa00' }}>YES</strong></div>
                      <div>Hops (số chặng): <strong>{caseResult.baseline.hops}</strong></div>
                      <div>Số đường đi ngắn nhất: <strong>{caseResult.baseline.num_shortest_paths}</strong></div>
                      <div style={{ marginTop: '4px', fontSize: '11px', color: '#666' }}>Đường đi: <span>{(caseResult.baseline.path_iata || []).join(' → ')}</span></div>
                    </>
                  ) : (
                    <div style={{ marginTop: '6px' }}>Connected: <strong style={{ color: '#cc0000' }}>NO</strong></div>
                  )}
                </div>
                {caseResult.with_defense && (
                  <div style={{ flex: 1, background: '#f0f8f0', padding: '10px', borderRadius: '6px', border: '1px solid #c0e0c0' }}>
                    <strong style={{ color: '#00aa66' }}>With TER Defense (reinforced)</strong>
                    <div style={{ fontSize: '10px', color: '#888', marginBottom: '4px' }}>
                      Phương pháp: Effective Resistance - thêm cạnh backup
                    </div>
                    {caseResult.with_defense?.connected ? (
                      <>
                        <div style={{ marginTop: '6px' }}>Connected: <strong style={{ color: '#00aa00' }}>YES</strong></div>
                        <div>Hops (số chặng): <strong>{caseResult.with_defense.hops}</strong></div>
                        <div>Số đường đi ngắn nhất: <strong>{caseResult.with_defense.num_shortest_paths}</strong></div>
                        <div style={{ marginTop: '4px', fontSize: '11px', color: '#666' }}>Đường đi: <span>{(caseResult.with_defense.path_iata || []).join(' → ')}</span></div>
                      </>
                    ) : (
                      <div style={{ marginTop: '6px' }}>Connected: <strong style={{ color: '#cc0000' }}>NO</strong></div>
                    )}
                    <div style={{ marginTop: '6px', fontSize: '11px', color: '#666' }}>
                      Số cạnh backup thêm: <strong>{caseResult.added_edges}</strong>
                    </div>
                  </div>
                )}
              </div>
              <div style={{ marginTop: '10px', fontSize: '11px', color: '#666', padding: '8px', background: '#fff8f0', borderRadius: '4px' }}>
                <strong>Gợi ý đọc</strong>:{' '}
                Nếu <em>số đường đi ngắn nhất</em> tăng sau defense, mạng có nhiều lựa chọn tuyến hơn khi một số hub bị tấn công;{' '}
                nếu mạng bị ngắt kết nối (Connected = NO), đây là kịch bản failure nghiêm trọng.
              </div>
            </div>
          )}

          {/* Attack Simulation Results */}
          {attackSimResult && (
            <div style={{ 
              marginTop: '30px', 
              padding: '15px', 
              background: 'white', 
              borderRadius: '8px',
              border: '2px solid #ff6600',
              boxShadow: '0 2px 6px rgba(255,102,0,0.15)'
            }}>
              <h4 style={{ margin: '0 0 10px 0', fontSize: '16px', fontWeight: 'bold', color: '#ff6600' }}>
                🎯 Attack Simulation: {attackSimResult.src_iata} → {attackSimResult.dst_iata}
              </h4>
              <div style={{ fontSize: '11px', color: '#666', marginBottom: '12px' }}>
                <div>
                  <strong>Baseline:</strong> {attackSimResult.baseline_original?.path_iata?.join(' → ') || 'N/A'} 
                  ({attackSimResult.baseline_original?.distance_km?.toFixed(0) || 'N/A'} km)
                </div>
                {attackSimResult.baseline_defended && (
                  <div>
                    <strong>Defended ({attackSimResult.defense_method}):</strong> {attackSimResult.baseline_defended?.path_iata?.join(' → ') || 'N/A'}
                    ({attackSimResult.baseline_defended?.distance_km?.toFixed(0) || 'N/A'} km)
                  </div>
                )}
                {attackSimResult.transit_nodes && attackSimResult.transit_nodes.length > 0 && (
                  <div style={{ marginTop: '4px' }}>
                    <strong>Transit Nodes:</strong> {attackSimResult.transit_nodes.join(', ')}
                  </div>
                )}
              </div>

              {/* Compact Bar Chart */}
              {attackSimResult.chart_data && attackSimResult.chart_data.length > 0 && (
                <div 
                  onClick={() => setShowAttackSimModal(true)}
                  style={{ cursor: 'pointer', marginTop: '8px' }}
                >
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart 
                      data={attackSimResult.chart_data.map((d: any) => {
                        const vals = attackSimResult.chart_data
                          .filter((dd: any) => (dd.original_connected && dd.original_km) || (dd.defended_connected && dd.defended_km))
                          .map((dd: any) => Math.max(dd.original_km || 0, dd.defended_km || 0));
                        const baseMax = vals.length > 0 ? Math.max(...vals) : 10000;
                        const placeholder = baseMax * 1.12;
                        return {
                          scenario: d.scenario,
                          Original: d.original_connected ? (d.original_km || 0) : placeholder,
                          Defended: d.defended_connected ? (d.defended_km || 0) : (d.defended_connected === false ? placeholder : null),
                          OriginalDisconnected: !d.original_connected,
                          DefendedDisconnected: d.defended_connected === false,
                          __placeholder: placeholder
                        };
                      })}
                      margin={{ top: 40, right: 20, left: 10, bottom: 60 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis 
                        dataKey="scenario" 
                        angle={-45}
                        textAnchor="end"
                        height={70}
                        interval={0}
                        tick={{ fontSize: 10 }}
                      />
                      <YAxis 
                        domain={[0, 'dataMax + 2000']}
                        tick={{ fontSize: 10 }}
                      />
                      <Tooltip 
                        formatter={(value: any, name: string, props: any) => {
                          const p = props?.payload || {};
                          const isDisc = name === 'Original' ? p.OriginalDisconnected : (name === 'Defended' ? p.DefendedDisconnected : false);
                          return isDisc ? ['DISCONNECTED', name] : [`${(value ?? 0).toFixed(0)} km`, name];
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: '11px' }} />
                      <Bar dataKey="Original" fill="#ff9999" name="Original"
                        label={(props: any) => {
                          const p = props?.payload || {};
                          if (p.OriginalDisconnected) {
                            return (
                              <text x={props.x + props.width / 2} y={props.y - 6} fill="red" fontSize={16} fontWeight="bold" textAnchor="middle">✗</text>
                            );
                          }
                          return null;
                        }}
                      />
                      <Bar dataKey="Defended" fill="#66b3ff" name="Defended"
                        label={(props: any) => {
                          const p = props?.payload || {};
                          if (p.DefendedDisconnected) {
                            return (
                              <text x={props.x + props.width / 2} y={props.y - 6} fill="red" fontSize={16} fontWeight="bold" textAnchor="middle">✗</text>
                            );
                          }
                          return null;
                        }}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                  <div style={{ fontSize: '11px', color: '#999', marginTop: '8px', textAlign: 'center' }}>
                    Click để xem chi tiết
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Removed Items Panel - Sidebar */}
      {showRemovedPanel && (
        <div style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: '350px',
          height: '100vh',
          background: 'white',
          padding: '20px',
          borderRadius: '0',
          zIndex: 2000,
          boxShadow: '-2px 0 8px rgba(0,0,0,0.15)',
          overflowY: 'auto',
          borderLeft: '2px solid #ddd'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold', color: '#ff0000' }}>Removed Items ({removedItems.length})</h3>
            <button
              onClick={() => setShowRemovedPanel(false)}
              style={{
                background: '#f0f0f0',
                border: '1px solid #ccc',
                borderRadius: '4px',
                padding: '5px 10px',
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              ✕ Close
            </button>
          </div>
          
          {removedItems.length === 0 ? (
            <div style={{ color: '#666', fontSize: '13px', textAlign: 'center', padding: '40px 20px' }}>
              No items removed yet
            </div>
          ) : (
            <>
              <div style={{ marginBottom: '15px' }}>
                <button
                  onClick={handleReset}
                  style={{
                    width: '100%',
                    padding: '10px',
                    background: '#ff6600',
                    color: 'white',
                    border: 'none',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 'bold',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                  }}
                >
                  Restore All
                </button>
              </div>
              <div style={{ maxHeight: 'calc(100vh - 200px)', overflowY: 'auto' }}>
                {removedItems.map((item) => (
                  <div
                    key={item.key}
                    onClick={() => handleRestore(item)}
                    style={{
                      padding: '12px',
                      marginBottom: '8px',
                      background: '#f9f9f9',
                      border: '1px solid #ddd',
                      borderRadius: '5px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#f0f0f0'
                      e.currentTarget.style.borderColor = '#ff6600'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#f9f9f9'
                      e.currentTarget.style.borderColor = '#ddd'
                    }}
                  >
                    {item.type === 'node' ? (
                      <div>
                        <strong style={{ color: '#ff0000', fontSize: '13px' }}>✈ Airport</strong><br/>
                        <strong style={{ fontSize: '13px' }}>{item.name}</strong><br/>
                        {item.city}, {item.country}<br/>
                        IATA: {item.iata || 'N/A'}<br/>
                        <small style={{ color: '#666', fontSize: '11px' }}>Click to restore</small>
                      </div>
                    ) : (
                      <div>
                        <strong style={{ color: '#ff0000', fontSize: '13px' }}>🛫 Route</strong><br/>
                        <strong>{item.source_name}</strong> ({item.source_iata || 'N/A'})<br/>
                        → <strong>{item.target_name}</strong> ({item.target_iata || 'N/A'})<br/>
                        <small style={{ color: '#666', fontSize: '11px' }}>Click to restore</small>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Recommendations Panel - Modal */}
      {showRecommendationsPanel && redundancySuggestions.length > 0 && (
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'white',
          padding: '25px',
          borderRadius: '10px',
          zIndex: 3000,
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
          width: '600px',
          maxWidth: '90vw',
          maxHeight: '80vh',
          overflow: 'auto'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', color: '#00cc66' }}>
              🛡️ Where to Add Redundancy? (TER Method)
            </h3>
            <button
              onClick={() => setShowRecommendationsPanel(false)}
              style={{
                background: '#f0f0f0',
                border: '1px solid #ccc',
                borderRadius: '5px',
                padding: '8px 12px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: 'bold'
              }}
            >
              ✕ Close
            </button>
          </div>
          <div style={{ fontSize: '13px', color: '#666', marginBottom: '20px', padding: '12px', background: '#f0f8f0', borderRadius: '6px' }}>
            <div style={{ marginBottom: '6px' }}>
              <strong>Phương pháp:</strong> TER (Topological Effective Resistance) - Đề xuất các cạnh backup dựa trên Effective Resistance cao nhất
            </div>
            <div>
              <strong>Recommendations:</strong> Top {redundancySuggestions.length} backup routes để cải thiện network robustness
            </div>
          </div>
          <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {redundancySuggestions.map((sug, idx) => (
              <div
                key={idx}
                style={{
                  padding: '12px',
                  marginBottom: '8px',
                  background: idx < 3 ? '#e8f5e9' : '#f9f9f9',
                  border: idx < 3 ? '2px solid #4caf50' : '1px solid #ddd',
                  borderRadius: '5px',
                  fontSize: '13px'
                }}
              >
                {idx < 3 && (
                  <div style={{ fontSize: '11px', color: '#4caf50', fontWeight: 'bold', marginBottom: '5px' }}>
                    ⭐ Top {idx + 1} Priority
                  </div>
                )}
                <div style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '14px' }}>
                  <span style={{ color: '#0066cc' }}>{sug.source_name}</span> ({sug.source_iata})
                </div>
                <div style={{ marginBottom: '5px', fontSize: '14px' }}>
                  → <span style={{ color: '#0066cc', fontWeight: 'bold' }}>{sug.target_name}</span> ({sug.target_iata})
                </div>
                <div style={{ fontSize: '12px', color: '#666', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #eee' }}>
                  <div>📏 Distance: <strong>{sug.distance_km?.toFixed(0)} km</strong></div>
                  {sug.lcc_gain > 0 && (
                    <div>📈 LCC Gain: <strong style={{ color: '#4caf50' }}>+{sug.lcc_gain?.toFixed(4)}</strong></div>
                  )}
                  {sug.aspl_gain > 0 && (
                    <div>📉 ASPL Reduction: <strong style={{ color: '#4caf50' }}>-{sug.aspl_gain?.toFixed(4)}</strong></div>
                  )}
                  {sug.score && (
                    <div style={{ marginTop: '5px', fontSize: '11px', color: '#999' }}>
                      Score: {sug.score?.toFixed(2)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Overview / Report Panel */}
      {showOverview && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100vw',
          height: '100vh',
          background: 'rgba(0,0,0,0.4)',
          zIndex: 4000,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center'
        }}>
          <div style={{
            background: 'white',
            width: '900px',
            maxWidth: '95vw',
            maxHeight: '90vh',
            borderRadius: '10px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 'bold', color: '#0066cc' }}>Airline Network Robustness – Overview</h2>
                <div style={{ fontSize: '12px', color: '#666' }}>Object & Scope • Research Questions • Contributions • Pipeline</div>
              </div>
              <button
                onClick={() => setShowOverview(false)}
                style={{
                  background: '#f0f0f0',
                  border: '1px solid #ccc',
                  borderRadius: '5px',
                  padding: '6px 10px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  fontWeight: 'bold'
                }}
              >
                ✕ Close
              </button>
            </div>
            <div style={{ padding: '16px 20px', overflowY: 'auto' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 'bold', color: '#333' }}>1. Object & Scope</h3>
              <ul style={{ paddingLeft: '18px', fontSize: '12px', color: '#444', marginTop: 0 }}>
                <li><strong>Đối tượng</strong>: Mạng lưới hàng không OpenFlights (node = sân bay, edge = tuyến bay).</li>
                <li><strong>Robustness</strong>: Khả năng mạng vẫn kết nối khi một phần sân bay/hub bị hỏng hoặc tấn công.</li>
                <li><strong>Mục tiêu</strong>: Đo lường robustness, mô phỏng các chiến lược tấn công (random / degree / PageRank / betweenness) và đánh giá chiến lược phòng thủ <strong>TER (Effective Resistance - thêm cạnh backup)</strong>.</li>
              </ul>

              <h3 style={{ margin: '12px 0 8px 0', fontSize: '14px', fontWeight: 'bold', color: '#333' }}>2. Research Questions</h3>
              <ul style={{ paddingLeft: '18px', fontSize: '12px', color: '#444', marginTop: 0 }}>
                <li><strong>Q1</strong>: Robustness hiện tại của mạng bay là gì (LCC, đường kính) dưới tấn công ngẫu nhiên?</li>
                <li><strong>Q2</strong>: Các chiến lược tấn công có mục tiêu (degree / PageRank / betweenness) làm suy giảm mạng nhanh đến mức nào so với random?</li>
                <li><strong>Q3</strong>: Chiến lược phòng thủ <strong>TER (Effective Resistance)</strong> - thêm cạnh backup dựa trên R_eff cao nhất - cải thiện robustness ra sao, đặc biệt trên các tuyến thực tế A → B?</li>
              </ul>

              <h3 style={{ margin: '12px 0 8px 0', fontSize: '14px', fontWeight: 'bold', color: '#333' }}>3. Contributions (tóm tắt)</h3>
              <ul style={{ paddingLeft: '18px', fontSize: '12px', color: '#444', marginTop: 0 }}>
                <li>Xây dựng pipeline end-to-end từ dữ liệu OpenFlights → đồ thị → mô phỏng attack/defense → robustness curves.</li>
                <li>Triển khai và so sánh nhiều chiến lược tấn công node (random, degree, PageRank, betweenness) bằng các metric LCC, đường kính và đường cong suy giảm.</li>
                <li>Triển khai chiến lược phòng thủ <strong>TER (Topological Effective Resistance)</strong> - thêm k cạnh backup có Effective Resistance cao nhất trong giới hạn khoảng cách địa lý để cải thiện robustness.</li>
                <li>Xây dựng web demo tương tác trên bản đồ địa lý, cho phép xoá/khôi phục sân bay & tuyến bay, chạy phân tích tấn công/phòng thủ và case-study đường bay cụ thể.</li>
              </ul>

              <h3 style={{ margin: '12px 0 8px 0', fontSize: '14px', fontWeight: 'bold', color: '#333' }}>4. Analysis Pipeline (Overview)</h3>
              <ol style={{ paddingLeft: '18px', fontSize: '12px', color: '#444', marginTop: 0 }}>
                <li><strong>Data Ingestion</strong>: Đọc airports.dat và routes.dat, tiền xử lý ID, toạ độ, thuộc tính sân bay.</li>
                <li><strong>Graph Building</strong>: Xây đồ thị vô hướng (node = airport, edge = route), chọn LCC và (tuỳ chọn) lọc theo vùng địa lý.</li>
                <li><strong>Attack Simulation</strong>: Mô phỏng random / degree / PageRank / betweenness với nhiều tỉ lệ xoá node, thu thập LCC và đường kính.</li>
                <li><strong>Defense Design</strong>: Sử dụng phương pháp <strong>TER (Topological Effective Resistance)</strong> - thêm k cạnh backup có Effective Resistance cao nhất trong giới hạn khoảng cách địa lý, và phân tích lại robustness.</li>
                <li><strong>Case Studies</strong>: Phân tích chi tiết các tuyến A → B (ví dụ FRA → SGN, SGN → CFN) trước và sau tấn công/phòng thủ.</li>
              </ol>

              <h3 style={{ margin: '12px 0 8px 0', fontSize: '14px', fontWeight: 'bold', color: '#333' }}>5. Metrics & Experiments</h3>
              <ul style={{ paddingLeft: '18px', fontSize: '12px', color: '#444', marginTop: 0 }}>
                <li><strong>Metrics chính</strong>: Kích thước LCC tương đối, đường kính LCC; số đường đi ngắn nhất và số bước (hops) giữa các sân bay A → B.</li>
                <li><strong>Experiments</strong>: Vẽ các đường cong robustness (fraction removed vs LCC / diameter), so sánh attack/defense trên cùng biểu đồ.</li>
                <li><strong>Demo</strong>: Web app cho phép người dùng thao tác trực tiếp trên bản đồ để kiểm thử các kịch bản tấn công và bảo vệ khác nhau.</li>
              </ul>
            </div>
              </div>
            </div>
          )}


          {/* Attack Simulation Modal */}
          {showAttackSimModal && attackSimResult && (
            <div
              onClick={() => setShowAttackSimModal(false)}
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100vw',
                height: '100vh',
                background: 'rgba(0,0,0,0.75)',
                zIndex: 6000,
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                cursor: 'pointer',
                padding: '20px'
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: 'white',
                  borderRadius: '12px',
                  padding: '30px',
                  width: '95vw',
                  maxWidth: '1400px',
                  maxHeight: '95vh',
                  overflowY: 'auto',
                  boxShadow: '0 10px 50px rgba(0,0,0,0.5)',
                  cursor: 'default'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px', borderBottom: '2px solid #ff6600', paddingBottom: '15px' }}>
                  <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 'bold', color: '#ff6600' }}>
                    🎯 Attack Simulation Report: {attackSimResult.src_iata} → {attackSimResult.dst_iata}
                  </h2>
                  <button
                    onClick={() => setShowAttackSimModal(false)}
                    style={{
                      background: '#f0f0f0',
                      border: '1px solid #ccc',
                      borderRadius: '5px',
                      padding: '8px 15px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      fontWeight: 'bold'
                    }}
                  >
                    ✕ Close
                  </button>
                </div>

                {/* Baseline Info */}
                <div style={{ 
                  fontSize: '14px', 
                  color: '#333', 
                  marginBottom: '25px',
                  padding: '15px',
                  background: '#fff8f0',
                  borderRadius: '8px',
                  border: '1px solid #ffe0b3'
                }}>
                  <h3 style={{ margin: '0 0 12px 0', fontSize: '18px', fontWeight: 'bold', color: '#ff6600' }}>
                    📍 Baseline Route Information
                  </h3>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                    <div>
                      <div style={{ marginBottom: '8px' }}>
                        <strong>Original Route:</strong> {attackSimResult.baseline_original?.path_iata?.join(' → ') || 'N/A'}
                      </div>
                      <div style={{ marginBottom: '8px' }}>
                        <strong>Distance:</strong> <span style={{ color: '#ff6600', fontWeight: 'bold' }}>
                          {attackSimResult.baseline_original?.distance_km?.toFixed(2) || 'N/A'} km
                        </span>
                      </div>
                      <div>
                        <strong>Hops:</strong> {attackSimResult.baseline_original?.hops || 'N/A'}
                      </div>
                    </div>
                    {attackSimResult.baseline_defended && (
                      <div>
                        <div style={{ marginBottom: '8px' }}>
                          <strong>Defended Route ({attackSimResult.defense_method}):</strong> {attackSimResult.baseline_defended?.path_iata?.join(' → ') || 'N/A'}
                        </div>
                        <div style={{ marginBottom: '8px' }}>
                          <strong>Distance:</strong> <span style={{ color: '#66b3ff', fontWeight: 'bold' }}>
                            {attackSimResult.baseline_defended?.distance_km?.toFixed(2) || 'N/A'} km
                          </span>
                        </div>
                        <div>
                          <strong>Hops:</strong> {attackSimResult.baseline_defended?.hops || 'N/A'}
                        </div>
                      </div>
                    )}
                  </div>
                  {attackSimResult.transit_nodes && attackSimResult.transit_nodes.length > 0 && (
                    <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid #ffe0b3' }}>
                      <strong>Critical Transit Nodes:</strong> {attackSimResult.transit_nodes.join(', ')}
                    </div>
                  )}
                </div>

                {/* Bar Chart */}
                {attackSimResult.chart_data && attackSimResult.chart_data.length > 0 && (
                  <div style={{ marginBottom: '30px' }}>
                    <h3 style={{ margin: '0 0 15px 0', fontSize: '18px', fontWeight: 'bold', color: '#333' }}>
                      📊 Path Length Comparison
                    </h3>
                    <div style={{ background: '#f9f9f9', padding: '20px', borderRadius: '8px' }}>
                      <ResponsiveContainer width="100%" height={400}>
                        <BarChart 
                          data={attackSimResult.chart_data.map((d: any) => ({
                            scenario: d.scenario,
                            'Original': d.original_connected ? (d.original_km || 0) : null,
                            'Defended': d.defended_connected ? (d.defended_km || 0) : null
                          }))}
                          margin={{ top: 20, right: 30, left: 20, bottom: 100 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis 
                            dataKey="scenario" 
                            angle={-45}
                            textAnchor="end"
                            height={120}
                            label={{ value: 'Attack Scenario', position: 'insideBottom', offset: -5 }}
                            interval={0}
                          />
                          <YAxis 
                            label={{ value: 'Path Length (km)', angle: -90, position: 'insideLeft' }}
                            domain={[0, 'dataMax + 2000']}
                          />
                          <Tooltip 
                            formatter={(value: any, name: string) => {
                              if (value === null || value === undefined) return ['DISCONNECTED', name];
                              return [`${value?.toFixed(2)} km`, name];
                            }}
                            labelFormatter={(label) => `Scenario: ${label}`}
                            contentStyle={{ backgroundColor: 'rgba(255,255,255,0.95)', border: '1px solid #ccc', borderRadius: '4px' }}
                          />
                          <Legend />
                          <Bar dataKey="Original" fill="#ff9999" name="Original" />
                          <Bar dataKey="Defended" fill="#66b3ff" name="Defended" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div style={{ marginTop: '15px', fontSize: '12px', color: '#666', textAlign: 'center' }}>
                      <strong>Note:</strong> Disconnected scenarios (no path found) are shown as empty bars. 
                      Original = Light Red, Defended = Light Blue
                    </div>
                  </div>
                )}

                {/* Detailed Results Table */}
                {attackSimResult.attack_results && attackSimResult.attack_results.length > 0 && (
                  <div>
                    <h3 style={{ margin: '0 0 15px 0', fontSize: '18px', fontWeight: 'bold', color: '#333' }}>
                      📋 Detailed Attack Results
                    </h3>
                    <div style={{ 
                      border: '1px solid #ddd',
                      borderRadius: '8px',
                      overflow: 'hidden'
                    }}>
                      <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: '#ff6600', color: 'white' }}>
                            <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #cc5500' }}>Scenario</th>
                            <th style={{ padding: '12px', textAlign: 'right', borderBottom: '2px solid #cc5500' }}>Original (km)</th>
                            {attackSimResult.defense_method && (
                              <th style={{ padding: '12px', textAlign: 'right', borderBottom: '2px solid #cc5500' }}>Defended (km)</th>
                            )}
                            <th style={{ padding: '12px', textAlign: 'center', borderBottom: '2px solid #cc5500' }}>Status</th>
                            <th style={{ padding: '12px', textAlign: 'left', borderBottom: '2px solid #cc5500' }}>Route</th>
                          </tr>
                        </thead>
                        <tbody>
                          {attackSimResult.attack_results.map((result: any, idx: number) => (
                            <tr key={idx} style={{ borderBottom: '1px solid #eee', background: idx % 2 === 0 ? 'white' : '#f9f9f9' }}>
                              <td style={{ padding: '10px', fontWeight: 'bold' }}>{result.scenario}</td>
                              <td style={{ padding: '10px', textAlign: 'right' }}>
                                {result.original.connected ? (
                                  <span style={{ color: '#ff6600', fontWeight: 'bold' }}>
                                    {result.original.distance_km?.toFixed(2)} km
                                  </span>
                                ) : (
                                  <span style={{ color: 'red', fontWeight: 'bold' }}>DISCONNECTED</span>
                                )}
                              </td>
                              {attackSimResult.defense_method && (
                                <td style={{ padding: '10px', textAlign: 'right' }}>
                                  {result.defended?.connected ? (
                                    <span style={{ color: '#66b3ff', fontWeight: 'bold' }}>
                                      {result.defended.distance_km?.toFixed(2)} km
                                    </span>
                                  ) : (
                                    <span style={{ color: 'red', fontWeight: 'bold' }}>DISCONNECTED</span>
                                  )}
                                </td>
                              )}
                              <td style={{ padding: '10px', textAlign: 'center' }}>
                                <span style={{ color: result.original.connected ? '#00aa00' : 'red', fontSize: '16px', fontWeight: 'bold' }}>
                                  {result.original.connected ? '✓' : '✗'}
                                </span>
                                {attackSimResult.defense_method && (
                                  <span style={{ marginLeft: '8px', color: result.defended?.connected ? '#00aa00' : 'red', fontSize: '16px', fontWeight: 'bold' }}>
                                    {result.defended?.connected ? '✓' : '✗'}
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '10px', fontSize: '11px', color: '#666' }}>
                                {result.original.connected ? (
                                  <span>{result.original.path_iata?.join(' → ') || 'N/A'}</span>
                                ) : (
                                  <span style={{ color: 'red', fontStyle: 'italic' }}>No path</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

      {/* Floating button for removed panel */}
      {!showRemovedPanel && removedItems.length > 0 && (
        <button
          onClick={() => setShowRemovedPanel(true)}
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            background: '#ff0000',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            padding: '12px 18px',
            cursor: 'pointer',
            zIndex: 1500,
            boxShadow: '0 4px 12px rgba(255,0,0,0.3)',
            fontWeight: 'bold',
            fontSize: '14px'
          }}
        >
          Removed ({removedItems.length})
        </button>
      )}

      {/* Chart Zoom Modal */}
      {zoomedChart && (
        <div
          onClick={() => setZoomedChart(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0,0,0,0.7)',
            zIndex: 5000,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            cursor: 'pointer'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              borderRadius: '10px',
              padding: '25px',
              width: '90vw',
              maxWidth: '1200px',
              maxHeight: '90vh',
              boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
              cursor: 'default'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', color: '#0066cc' }}>
                {zoomedChart.title}
              </h3>
              <button
                onClick={() => setZoomedChart(null)}
                style={{
                  background: '#f0f0f0',
                  border: '1px solid #ccc',
                  borderRadius: '5px',
                  padding: '8px 12px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: 'bold'
                }}
              >
                ✕ Close
              </button>
            </div>
            <ResponsiveContainer width="100%" height={600}>
              {zoomedChart.config.chartType === 'bar' ? (
                <BarChart data={zoomedChart.data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey={zoomedChart.config.xKey} 
                    angle={-45}
                    textAnchor="end"
                    height={100}
                    label={{ value: zoomedChart.config.xLabel, position: 'insideBottom', offset: -5 }} 
                  />
                  <YAxis label={{ value: zoomedChart.config.yLabel, angle: -90, position: 'insideLeft' }} />
                  <Tooltip 
                    formatter={(value: any) => {
                      if (value === 99999 || value === null) return 'DISCONNECTED';
                      return `${value?.toFixed(2)} km`;
                    }}
                  />
                  <Legend />
                  {zoomedChart.config.lines.map((line: any) => (
                    <Bar 
                      key={line.key} 
                      dataKey={line.key} 
                      fill={line.stroke} 
                    />
                  ))}
                </BarChart>
              ) : (
                <LineChart data={zoomedChart.data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey={zoomedChart.config.xKey} 
                    label={{ value: zoomedChart.config.xLabel, position: 'insideBottom', offset: -5 }} 
                  />
                  <YAxis 
                    label={{ value: zoomedChart.config.yLabel, angle: -90, position: 'insideLeft' }} 
                  />
                  <Tooltip />
                  <Legend />
                  {zoomedChart.config.lines.map((line: any) => (
                    <Line 
                      key={line.key}
                      type="monotone" 
                      dataKey={line.key} 
                      stroke={line.stroke} 
                      strokeWidth={3} 
                      dot={{ r: 4 }} 
                    />
                  ))}
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  )
}

export default App

