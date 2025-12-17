import { useState, useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import axios from 'axios'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

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

// Chỉ focus vào Đông Nam Á
const REGIONS = {
  'southeast-asia': {
    name: 'Đông Nam Á',
    bbox: { minLat: -10, maxLat: 30, minLon: 90, maxLon: 150 },
    center: [10, 120] as [number, number],
    zoom: 5
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
  
  // Attack strategy parameters
  const [attackStrategy, setAttackStrategy] = useState<string>('degree_targeted_attack')
  const [maxFraction, setMaxFraction] = useState<number>(0.5)
  const [nRuns, setNRuns] = useState<number>(5)
  
  // Defense strategy parameters
  const [kHubs, setKHubs] = useState<number>(10)
  const [maxDistance, setMaxDistance] = useState<number>(2000)
  const [defenseAttackStrategy, setDefenseAttackStrategy] = useState<string>('degree_targeted_attack')
  
  // Top-k impact
  const [topKImpact, setTopKImpact] = useState<any>(null)
  const [topK, setTopK] = useState<number>(10)
  const [topKStrategy, setTopKStrategy] = useState<string>('degree')

  useEffect(() => {
    console.log('=== useEffect: loading initial data ===')
    loadData()
    loadRemovedItems()
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
      let timeoutId: NodeJS.Timeout
      const updateZoom = () => {
        clearTimeout(timeoutId)
        timeoutId = setTimeout(() => {
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
                Đông Nam Á
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
          </div>
        
          {/* Quick Analysis */}
          <div style={{ marginBottom: '15px' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold', color: '#0066cc' }}>Quick Analysis</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
              <button
                onClick={() => runAttackAnalysis()}
                disabled={loadingAnalysis}
                style={{
                  padding: '10px',
                  background: '#ff6600',
                  color: 'white',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: loadingAnalysis ? 'not-allowed' : 'pointer',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                }}
              >
                {loadingAnalysis ? '...' : '3 Strategies'}
              </button>
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
            <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', fontWeight: 'bold', color: '#00cc66' }}>Custom Defense</h3>
            <div style={{ marginBottom: '8px' }}>
              <label style={{ fontSize: '11px', display: 'block', marginBottom: '3px', color: '#666' }}>
                Top K Hubs: {kHubs}
              </label>
              <input
                type="range"
                min="5"
                max="20"
                value={kHubs}
                onChange={(e) => setKHubs(Number(e.target.value))}
                style={{ width: '100%' }}
              />
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
                <option value="betweenness_targeted_attack">Betweenness Targeted</option>
              </select>
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
              Run Custom Defense
            </button>
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
          {showCurvesPanel && robustnessCurves && (
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
                  onClick={() => setShowCurvesPanel(false)}
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
              
              {robustnessCurves.baseline && (
                <div style={{ 
                  fontSize: '12px', 
                  color: '#666', 
                  marginBottom: '20px', 
                  padding: '12px', 
                  background: 'white',
                  borderRadius: '8px',
                  border: '1px solid #e0e0e0',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                }}>
                  <strong style={{ color: '#0066cc' }}>Baseline Metrics:</strong><br/>
                  Nodes: {robustnessCurves.baseline.nodes} | 
                  Edges: {robustnessCurves.baseline.edges} | 
                  LCC: {robustnessCurves.baseline.lcc_norm?.toFixed(3)} | 
                  Diameter: {robustnessCurves.baseline.diameter?.toFixed(1)}
                </div>
              )}

              {/* Chart 1: Fraction Removed vs Relative LCC Size */}
              {robustnessCurves.random_attack && (
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
                  <ResponsiveContainer width="100%" height={280}>
                <LineChart data={robustnessCurves.random_attack.fraction_removed.map((f: number, i: number) => ({
                  fraction: f,
                  'Random Attack': robustnessCurves.random_attack.relative_lcc_size[i],
                  'Degree Targeted': robustnessCurves.degree_targeted_attack?.relative_lcc_size[i] || null,
                  'Betweenness Targeted': robustnessCurves.betweenness_targeted_attack?.relative_lcc_size[i] || null
                }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="fraction" label={{ value: 'Fraction Removed', position: 'insideBottom', offset: -5 }} />
                  <YAxis label={{ value: 'Relative LCC Size', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="Random Attack" stroke="#8884d8" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="Degree Targeted" stroke="#82ca9d" strokeWidth={2} dot={{ r: 3 }} />
                  {robustnessCurves.betweenness_targeted_attack && (
                    <Line type="monotone" dataKey="Betweenness Targeted" stroke="#ff7300" strokeWidth={2} dot={{ r: 3 }} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

              {/* Chart 2: Fraction Removed vs Diameter */}
              {robustnessCurves.random_attack && (
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
                  <ResponsiveContainer width="100%" height={280}>
                <LineChart data={robustnessCurves.random_attack.fraction_removed.map((f: number, i: number) => ({
                  fraction: f,
                  'Random Attack': robustnessCurves.random_attack.diameter[i],
                  'Degree Targeted': robustnessCurves.degree_targeted_attack?.diameter[i] || null,
                  'Betweenness Targeted': robustnessCurves.betweenness_targeted_attack?.diameter[i] || null
                }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="fraction" label={{ value: 'Fraction Removed', position: 'insideBottom', offset: -5 }} />
                  <YAxis label={{ value: 'Diameter', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="Random Attack" stroke="#8884d8" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="Degree Targeted" stroke="#82ca9d" strokeWidth={2} dot={{ r: 3 }} />
                  {robustnessCurves.betweenness_targeted_attack && (
                    <Line type="monotone" dataKey="Betweenness Targeted" stroke="#ff7300" strokeWidth={2} dot={{ r: 3 }} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

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
                    🛡️ Defense: Reinforced vs Original
                  </h4>
                  <div style={{ 
                    fontSize: '12px', 
                    color: '#666', 
                    marginBottom: '15px',
                    padding: '10px',
                    background: '#f0f8f4',
                    borderRadius: '5px'
                  }}>
                    <div><strong>Original:</strong> {robustnessCurves.baseline_original?.edges} edges</div>
                    <div><strong>Reinforced:</strong> {robustnessCurves.baseline_reinforced?.edges} edges (+{robustnessCurves.baseline_reinforced?.edges - robustnessCurves.baseline_original?.edges} backup edges)</div>
                  </div>
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
                    🛡️ Custom Defense: {robustnessCurves.attack_strategy?.replace('_', ' ').replace('attack', '').trim()}
                  </h4>
                  <div style={{ 
                    fontSize: '12px', 
                    color: '#666', 
                    marginBottom: '15px',
                    padding: '10px',
                    background: '#f0f8f4',
                    borderRadius: '5px'
                  }}>
                    <div><strong>Original:</strong> {robustnessCurves.baseline_original?.edges} edges</div>
                    <div><strong>Reinforced:</strong> {robustnessCurves.baseline_reinforced?.edges} edges (+{robustnessCurves.added_edges} backup)</div>
                    <div><strong>Configuration:</strong> Top-{robustnessCurves.k_hubs} hubs, Max distance: {robustnessCurves.max_distance_km}km</div>
                  </div>
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
          )}

              {/* Top-K Impact Analysis */}
              {topKImpact && (
                <div style={{ 
                  marginTop: '30px',
                  marginBottom: '30px',
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
                    marginBottom: '15px', 
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
                  <ResponsiveContainer width="100%" height={280}>
                <LineChart data={topKImpact.impact_curve.map((point: any) => ({
                  step: point.step,
                  'LCC Size': point.lcc_norm,
                  'Diameter': point.diameter / 10, // Scale for visibility
                  'ASPL': point.aspl / 10 // Scale for visibility
                }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="step" label={{ value: 'Hubs Removed', position: 'insideBottom', offset: -5 }} />
                  <YAxis label={{ value: 'Metrics (scaled)', angle: -90, position: 'insideLeft' }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="LCC Size" stroke="#8884d8" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="Diameter" stroke="#82ca9d" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="ASPL" stroke="#ff7300" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
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
            <h3 style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', color: '#00cc66' }}>Where to Add Redundancy?</h3>
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
            <strong>Recommendations:</strong> Top {redundancySuggestions.length} backup routes to improve network robustness
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
    </div>
  )
}

export default App

